import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, navigate, usePageMeta, useSearch } from '../lib/router.tsx';
import { api, ApiError, useFetch } from '../lib/api.ts';
import { Alert, CheckIcon, Field, Spinner, WhatsAppIcon } from '../components/ui.tsx';
import { categoryLabel, formatBR, longDate } from '../lib/format.ts';
import { addDays, todayISO } from '../../../server/domain/dates.ts';
import { validateDates } from '../../../server/domain/period.ts';
import { DomainError } from '../../../server/domain/errors.ts';
import type { SizeCode } from '../../../server/domain/constants.ts';
import type { PublicProduct } from './ProductCard.tsx';
import { useSite } from '../components/site.tsx';

interface Line { key: string; productId: number; name: string; size: SizeCode; quantity: number; participantName: string }
interface Result { code: string; summary: any; whatsapp: { configured: boolean; url: string | null; message: string } }
let lastResult: Result | null = null;   // resultado da última solicitação (mostrado na tela de confirmação)

const STEPS = ['Traje e tamanho', 'Datas', 'Seus dados', 'Resumo'];
const uid = () => Math.random().toString(36).slice(2, 9);

export function Reserve() {
  usePageMeta('Reservar traje alemão | Trajeville', 'Envie sua solicitação de locação de traje alemão: escolha o traje, o tamanho e as datas e consulte a disponibilidade.');
  const q = new URLSearchParams(useSearch());
  const { data: products, loading, error } = useFetch<PublicProduct[]>('/api/public/products');
  const today = useMemo(() => todayISO(), []);

  const [step, setStep] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [groupName, setGroupName] = useState('');
  const [eventDate, setEventDate] = useState(''); const [pickupDate, setPickupDate] = useState(q.get('retirada') ?? ''); const [returnDate, setReturnDate] = useState(q.get('devolucao') ?? '');
  const [cust, setCust] = useState({ name: '', whatsapp: '', email: '', notes: '' });
  const [website, setWebsite] = useState('');   // honeypot
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<ApiError | null>(null);

  // seleção em andamento (passo 1)
  const [slug, setSlug] = useState(q.get('traje') ?? ''); const [size, setSize] = useState<string>(q.get('tamanho') ?? '');
  const [qty, setQty] = useState(1); const [who, setWho] = useState('');
  const product = products?.find((p) => p.slug === slug);
  useEffect(() => { if (product && size && !product.sizes.some((s) => s.size === size && s.inStock)) setSize(''); }, [product, size]);
  useEffect(() => { if (q.get('retirada') && q.get('devolucao') && !eventDate) setEventDate(q.get('retirada')!); }, []);   // eslint-disable-line

  const addLine = () => {
    if (!product || !size) return;
    setLines((l) => [...l, { key: uid(), productId: product.id, name: product.name, size: size as SizeCode, quantity: qty, participantName: who.trim() }]);
    setSlug(''); setSize(''); setQty(1); setWho('');
  };

  // ---- datas ----
  const dateError = useMemo(() => {
    if (!eventDate || !pickupDate || !returnDate) return '';
    try { validateDates({ eventDate, pickupDate, returnDate }, today); return ''; } catch (e) { return e instanceof DomainError ? e.message : 'Verifique as datas.'; }
  }, [eventDate, pickupDate, returnDate, today]);
  const datesReady = !!eventDate && !!pickupDate && !!returnDate && !dateError;
  const onEvent = (v: string) => { setEventDate(v); if (v) { if (!pickupDate) setPickupDate(addDays(v, -1) < today ? today : addDays(v, -1)); if (!returnDate) setReturnDate(addDays(v, 2)); } };

  // ---- verificação em tempo real (informativa; o servidor valida de forma definitiva ao enviar) ----
  const [check, setCheck] = useState<{ ok: boolean; lines: Array<{ productId: number; size: string; quantity: number; available: number; ok: boolean }> } | null>(null);
  const [checking, setChecking] = useState(false);
  const seq = useRef(0);
  useEffect(() => {
    if (step < 1 || !datesReady || !lines.length) { setCheck(null); return; }
    const mine = ++seq.current; setChecking(true);
    api.post('/api/public/check', { pickupDate, returnDate, items: lines.map((l) => ({ productId: l.productId, size: l.size, quantity: l.quantity })) })
      .then((r) => mine === seq.current && setCheck(r)).catch(() => mine === seq.current && setCheck(null))
      .finally(() => mine === seq.current && setChecking(false));
  }, [step, datesReady, pickupDate, returnDate, lines]);
  const lineAvail = (l: Line) => check?.lines.find((x) => x.productId === l.productId && x.size === l.size);

  // ---- dados ----
  const custError = useMemo(() => {
    const digits = cust.whatsapp.replace(/\D/g, '');
    if (cust.name.trim().length < 2) return 'Informe seu nome completo.';
    if (digits.length < 10 || digits.length > 13) return 'Informe um WhatsApp válido com DDD.';
    if (cust.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cust.email.trim())) return 'Informe um e-mail válido ou deixe em branco.';
    return '';
  }, [cust]);

  const submit = async () => {
    setSubmitting(true); setServerError(null);
    try {
      const r = await api.post<Result>('/api/public/reservations', {
        customer: cust, eventDate, pickupDate, returnDate, groupName: lines.length > 1 ? groupName : undefined, notes: cust.notes, website,
        items: lines.map((l) => ({ productId: l.productId, size: l.size, quantity: l.quantity, participantName: l.participantName || undefined })),
      });
      lastResult = r; navigate('/reservar/enviada');
    } catch (e) { setServerError(e as ApiError); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    finally { setSubmitting(false); }
  };

  if (loading) return <Spinner />;
  if (error) return <div className="container wizard"><Alert>{error.message}</Alert></div>;

  const next = () => { setStep((s) => s + 1); window.scrollTo(0, 0); };
  const back = () => { setStep((s) => s - 1); window.scrollTo(0, 0); };
  const canStep1 = lines.length > 0;
  const canStep2 = datesReady && !checking && (check?.ok ?? false);

  return (
    <div className="container wizard">
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>Solicitar reserva</h1>
      <p className="muted">Sua solicitação não é uma reserva confirmada: a Trajeville analisa a disponibilidade e entra em contato.</p>
      <ol className="progress" aria-label="Etapas">
        {STEPS.map((s, i) => <li key={s} className={i < step ? 'done' : i === step ? 'now' : ''} aria-current={i === step ? 'step' : undefined}>{i + 1}. {s}</li>)}
      </ol>

      {serverError && (
        <Alert kind="error">
          <strong>{serverError.message}</strong>
          {serverError.code === 'UNAVAILABLE' && Array.isArray(serverError.details) && (
            <ul style={{ margin: '.5rem 0 0', paddingLeft: '1.1rem' }}>
              {serverError.details.map((d: any, i: number) => { const l = lines.find((x) => x.productId === d.productId && x.size === d.size); return <li key={i}>{l?.name ?? 'Traje'} — tamanho {d.size}: você pediu {d.requested}, disponível {d.available}.</li>; })}
            </ul>
          )}
          {serverError.code === 'UNAVAILABLE' && <div style={{ marginTop: '.7rem' }}><button className="btn btn-ghost btn-sm" onClick={() => { setServerError(null); setStep(1); }}>Ajustar datas</button> <button className="btn btn-ghost btn-sm" onClick={() => { setServerError(null); setStep(0); }}>Ajustar itens</button></div>}
        </Alert>
      )}

      {/* ===== 1. TRAJE · TAMANHO · QUANTIDADE ===== */}
      {step === 0 && (
        <section aria-labelledby="s1">
          <h2 id="s1" style={{ fontSize: '1.4rem' }}>Escolha o traje, o tamanho e a quantidade</h2>
          {lines.map((l) => (
            <div className="line-item" key={l.key}>
              <div><div className="t">{l.name}</div><div className="small muted">Tamanho {l.size} · {l.quantity} un.{l.participantName ? ` · ${l.participantName}` : ''}</div></div>
              <button className="btn btn-ghost btn-sm" onClick={() => setLines((x) => x.filter((y) => y.key !== l.key))} aria-label={`Remover ${l.name}`}>Remover</button>
            </div>
          ))}
          <div className="panel" style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: '1.05rem' }}>{lines.length ? 'Adicionar outro traje ou participante' : 'Traje'}</h3>
            <Field label="Traje" htmlFor="prod">
              <select id="prod" value={slug} onChange={(e) => { setSlug(e.target.value); setSize(''); }}>
                <option value="">Selecione…</option>
                {(['FEMININO', 'MASCULINO'] as const).map((c) => (
                  <optgroup key={c} label={categoryLabel(c)}>{products!.filter((p) => p.category === c).map((p) => <option key={p.id} value={p.slug}>{p.name}{p.isDemo ? ' (demonstração)' : ''}</option>)}</optgroup>
                ))}
              </select>
            </Field>
            {product && (
              <>
                <div className="label" style={{ marginBottom: '.5rem' }}>Tamanho</div>
                <div className="size-picker" role="group" aria-label="Tamanho" style={{ marginBottom: '1rem' }}>
                  {product.sizes.map((s) => <button key={s.size} className="size-btn" aria-pressed={size === s.size} disabled={!s.inStock} onClick={() => setSize(s.size)}>{s.size}</button>)}
                </div>
                <div className="row two">
                  <div className="field"><span className="label">Quantidade</span>
                    <div className="qty"><button aria-label="Diminuir" onClick={() => setQty((n) => Math.max(1, n - 1))}>−</button><output aria-live="polite">{qty}</output><button aria-label="Aumentar" onClick={() => setQty((n) => Math.min(20, n + 1))}>+</button></div></div>
                  <Field label="Nome do participante (opcional)" htmlFor="who"><input id="who" type="text" value={who} maxLength={120} onChange={(e) => setWho(e.target.value)} placeholder="Para reservas em grupo" /></Field>
                </div>
              </>
            )}
            <button className="btn btn-primary" disabled={!product || !size} onClick={addLine}>{lines.length ? 'Adicionar à solicitação' : 'Adicionar traje'}</button>
          </div>
          {lines.length > 1 && <div style={{ marginTop: '1rem' }}><Field label="Nome do grupo (opcional)" htmlFor="grp"><input id="grp" type="text" value={groupName} maxLength={120} onChange={(e) => setGroupName(e.target.value)} placeholder="Ex.: Grupo Oktoberfest" /></Field></div>}
          <div className="wizard-nav"><Link to="/trajes" className="btn btn-ghost">Ver catálogo</Link><button className="btn btn-primary" disabled={!canStep1} onClick={next}>Continuar</button></div>
        </section>
      )}

      {/* ===== 2. DATAS ===== */}
      {step === 1 && (
        <section aria-labelledby="s2">
          <h2 id="s2" style={{ fontSize: '1.4rem' }}>Datas do evento e da locação</h2>
          <div className="row three">
            <Field label="Data do evento" htmlFor="ev"><input id="ev" type="date" min={today} value={eventDate} onChange={(e) => onEvent(e.target.value)} /></Field>
            <Field label="Retirada" htmlFor="pk" hint="No dia do evento ou antes."><input id="pk" type="date" min={today} value={pickupDate} onChange={(e) => setPickupDate(e.target.value)} /></Field>
            <Field label="Devolução" htmlFor="rt" hint="No dia do evento ou depois."><input id="rt" type="date" min={pickupDate || today} value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></Field>
          </div>
          {dateError && <Alert kind="error">{dateError}</Alert>}
          {datesReady && (
            <div className="box" aria-live="polite">
              <h3>Disponibilidade para {formatBR(pickupDate)} → {formatBR(returnDate)}</h3>
              {checking && !check && <p className="muted">Consultando…</p>}
              {lines.map((l) => { const a = lineAvail(l); return (
                <div key={l.key} className={`status-line ${a ? (a.ok ? 'ok' : 'bad') : ''}`} style={{ marginBottom: '.4rem' }}>
                  {a ? (a.ok ? <><span style={{ width: 18 }}><CheckIcon /></span>{l.name} — {l.size}: disponível</> : <>✕ {l.name} — {l.size}: não há quantidade suficiente (disponível: {a.available})</>) : <>{l.name} — {l.size}</>}
                </div>); })}
              {check && !check.ok && <Alert kind="warn">Não há quantidade suficiente disponível para este período. Ajuste as datas, o tamanho ou a quantidade.</Alert>}
            </div>
          )}
          <div className="wizard-nav"><button className="btn btn-ghost" onClick={back}>Voltar</button><button className="btn btn-primary" disabled={!canStep2} onClick={next}>Continuar</button></div>
        </section>
      )}

      {/* ===== 3. DADOS ===== */}
      {step === 2 && (
        <section aria-labelledby="s3">
          <h2 id="s3" style={{ fontSize: '1.4rem' }}>Seus dados</h2>
          <Field label="Nome completo" htmlFor="n"><input id="n" type="text" autoComplete="name" value={cust.name} maxLength={120} onChange={(e) => setCust({ ...cust, name: e.target.value })} /></Field>
          <div className="row two">
            <Field label="WhatsApp (com DDD)" htmlFor="w"><input id="w" type="tel" inputMode="tel" autoComplete="tel" placeholder="(47) 99999-9999" value={cust.whatsapp} onChange={(e) => setCust({ ...cust, whatsapp: e.target.value })} /></Field>
            <Field label="E-mail (opcional)" htmlFor="e"><input id="e" type="email" autoComplete="email" value={cust.email} onChange={(e) => setCust({ ...cust, email: e.target.value })} /></Field>
          </div>
          <Field label="Observações (opcional)" htmlFor="o"><textarea id="o" maxLength={1000} value={cust.notes} onChange={(e) => setCust({ ...cust, notes: e.target.value })} placeholder="Alguma dúvida ou pedido especial?" /></Field>
          <div className="hp" aria-hidden="true"><label>Não preencha<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label></div>
          {custError && cust.name && <p className="small" style={{ color: 'var(--danger)' }}>{custError}</p>}
          <div className="wizard-nav"><button className="btn btn-ghost" onClick={back}>Voltar</button><button className="btn btn-primary" disabled={!!custError} onClick={next}>Continuar</button></div>
        </section>
      )}

      {/* ===== 4. RESUMO E ENVIO ===== */}
      {step === 3 && (
        <section aria-labelledby="s4">
          <h2 id="s4" style={{ fontSize: '1.4rem' }}>Confira sua solicitação</h2>
          <div className="box summary">
            <dl>
              <dt>Evento</dt><dd>{longDate(eventDate)} ({formatBR(eventDate)})</dd>
              <dt>Retirada</dt><dd>{formatBR(pickupDate)}</dd>
              <dt>Devolução</dt><dd>{formatBR(returnDate)}</dd>
              {groupName && <><dt>Grupo</dt><dd>{groupName}</dd></>}
              <dt>Nome</dt><dd>{cust.name}</dd><dt>WhatsApp</dt><dd>{cust.whatsapp}</dd>
              {cust.email && <><dt>E-mail</dt><dd>{cust.email}</dd></>}
            </dl>
          </div>
          <div className="box"><h3>Trajes</h3>
            {lines.map((l) => <div key={l.key} style={{ padding: '.4rem 0', borderBottom: '1px solid var(--line)' }}><strong>{l.name}</strong> — tamanho {l.size} · {l.quantity} un.{l.participantName ? ` · ${l.participantName}` : ''}</div>)}
          </div>
          <Alert kind="info">Ao enviar, a Trajeville analisa a disponibilidade e confirma pelo WhatsApp. Depois fazemos a prova presencial.</Alert>
          <div className="wizard-nav"><button className="btn btn-ghost" onClick={back} disabled={submitting}>Voltar</button><button className="btn btn-primary" onClick={submit} disabled={submitting}>{submitting ? 'Enviando…' : 'Enviar solicitação'}</button></div>
        </section>
      )}
    </div>
  );
}

export function ReserveSent() {
  usePageMeta('Solicitação enviada | Trajeville');
  const site = useSite();
  useEffect(() => { if (!lastResult) navigate('/reservar', { replace: true }); }, []);
  const r = lastResult; if (!r) return null;
  const copy = () => navigator.clipboard?.writeText(r.whatsapp.message).catch(() => {});
  return (
    <div className="container success fade-in">
      <div className="seal"><CheckIcon /></div>
      <h1 style={{ fontSize: 'clamp(1.8rem,5vw,2.6rem)' }}>Solicitação enviada!</h1>
      <p>Recebemos o seu pedido. Ele ainda <strong>não é uma reserva confirmada</strong>: a Trajeville vai analisar a disponibilidade e entrar em contato.</p>
      <div className="code" aria-label="Código da solicitação">{r.code}</div>
      <div className="box summary" style={{ textAlign: 'left' }}>
        <dl><dt>Retirada</dt><dd>{formatBR(r.summary.pickupDate)}</dd><dt>Evento</dt><dd>{formatBR(r.summary.eventDate)}</dd><dt>Devolução</dt><dd>{formatBR(r.summary.returnDate)}</dd></dl>
        {r.summary.items.map((i: any, k: number) => <p key={k} style={{ margin: '.6rem 0 0' }}><strong>{i.productName}</strong> — {i.size} · {i.quantity} un.{i.participantName ? ` · ${i.participantName}` : ''}</p>)}
      </div>
      {r.whatsapp.url ? (
        <a className="btn btn-primary btn-block" href={r.whatsapp.url} target="_blank" rel="noopener"><span style={{ width: 20, height: 20, display: 'inline-flex' }}><WhatsAppIcon /></span> Falar com a Trajeville</a>
      ) : (
        <Alert kind="info">O WhatsApp da Trajeville ainda não foi configurado no site. Guarde seu código e fale conosco pelo <a href={site.instagram_url} target="_blank" rel="noopener">Instagram</a>.
          <div style={{ marginTop: '.6rem' }}><button className="btn btn-ghost btn-sm" onClick={copy}>Copiar mensagem pronta</button></div></Alert>
      )}
      <p style={{ marginTop: '1.5rem' }}><Link to="/trajes">Voltar ao catálogo</Link></p>
    </div>
  );
}
