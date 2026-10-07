import { useMemo, useState } from 'react';
import { Link, navigate, usePageMeta, useSearch } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Field, Spinner, StatusBadge } from '../components/ui.tsx';
import { formatBR, formatTs, waLink, phoneDisplay } from '../lib/format.ts';
import { IN_POSSESSION_STATUSES, PENDING_STATUSES, RESERVED_STATUSES, STATUSES, STATUS_LABEL, TRANSITIONS, type Status } from '../../../server/domain/constants.ts';
import { useAction, useAdmin, today } from './shared.tsx';

const GROUPS: Record<string, { label: string; test: (r: any) => boolean }> = {
  pendentes: { label: 'Pendentes', test: (r) => PENDING_STATUSES.includes(r.status) },
  confirmadas: { label: 'Confirmadas', test: (r) => RESERVED_STATUSES.includes(r.status) },
  emposse: { label: 'Com o cliente', test: (r) => IN_POSSESSION_STATUSES.includes(r.status) },
  atrasadas: { label: 'Atrasadas', test: (r) => r.overdue },
};

export function ReservationList() {
  usePageMeta('Reservas — Painel Trajeville');
  const sp = new URLSearchParams(useSearch());
  const [q, setQ] = useState('');
  const { data, loading, error } = useFetch<any[]>(`/api/admin/reservations${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  const status = sp.get('status') ?? ''; const group = sp.get('filtro') ?? '';
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); if (k === 'status') n.delete('filtro'); if (k === 'filtro') n.delete('status'); navigate('/admin/reservas' + (n.toString() ? '?' + n : '')); };
  const rows = (data ?? []).filter((r) => (!status || r.status === status) && (!group || GROUPS[group]?.test(r)));
  return (
    <div>
      <div className="page-head"><h1>Reservas</h1></div>
      <div className="toolbar">
        <div className="field" style={{ margin: 0 }}><label htmlFor="bq">Buscar</label><input id="bq" type="search" placeholder="Nome, código ou WhatsApp" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="bs">Status</label>
          <select id="bs" value={status} onChange={(e) => set('status', e.target.value)}><option value="">Todos</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="bg">Grupo</label>
          <select id="bg" value={group} onChange={(e) => set('filtro', e.target.value)}><option value="">—</option>{Object.entries(GROUPS).map(([k, g]) => <option key={k} value={k}>{g.label}</option>)}</select></div>
      </div>
      {loading ? <Spinner /> : error ? <Alert>{error.message}</Alert> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Código</th><th>Cliente</th><th>Trajes</th><th>Retirada</th><th>Evento</th><th>Devolução</th><th>Status</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="click" onClick={() => navigate(`/admin/reservas/${r.id}`)}>
                <td><Link to={`/admin/reservas/${r.id}`}>{r.code}</Link></td>
                <td>{r.customer.name}{r.groupName && <div className="small muted">Grupo: {r.groupName}</div>}</td>
                <td className="small">{r.items.map((i: any) => <div key={i.id}>{i.productName} · {i.size} × {i.quantity}</div>)}</td>
                <td>{formatBR(r.pickupDate)}</td><td>{formatBR(r.eventDate)}</td><td>{formatBR(r.returnDate)}</td>
                <td><StatusBadge status={r.status} overdue={r.overdue} /></td>
              </tr>))}
            {rows.length === 0 && <tr><td colSpan={7} className="muted center">Nenhuma reserva encontrada.</td></tr>}
          </tbody></table></div>
      )}
    </div>
  );
}

const ACTION_LABEL: Partial<Record<Status, string>> = {
  EM_ANALISE: 'Colocar em análise', CONFIRMADA: 'Confirmar reserva', PROVA_REALIZADA: 'Marcar prova realizada',
  PRONTO_PARA_RETIRADA: 'Marcar pronto para retirada', RETIRADO: 'Registrar retirada', EM_USO: 'Marcar em uso',
  AGUARDANDO_DEVOLUCAO: 'Aguardando devolução', FINALIZADA: 'Finalizar reserva',
};

export function ReservationDetail({ id }: { id: number }) {
  usePageMeta('Reserva — Painel Trajeville');
  const { user } = useAdmin();
  const { data: r, loading, error, reload } = useFetch<any>(`/api/admin/reservations/${id}`);
  const act = useAction();
  const [fit, setFit] = useState({ date: '', time: '' });
  const [adj, setAdj] = useState({ itemId: 0, description: '' });
  const [cancelReason, setCancelReason] = useState('');
  const [ret, setRet] = useState<Record<number, { on: boolean; condition: 'OK' | 'MANUTENCAO'; reason: string; qty: number }>>({});
  const [retInfo, setRetInfo] = useState({ checkedBy: user.name, actualDate: today(), notes: '' });

  const go = (fn: () => Promise<unknown>, msg?: string) => act.run(async () => { await fn(); reload(); }, msg);
  const next = useMemo(() => (r ? TRANSITIONS[r.status as Status].filter((s) => ACTION_LABEL[s]) : []), [r]);
  if (loading && !r) return <Spinner />;
  if (error || !r) return <Alert>{error?.message ?? 'Reserva não encontrada.'}</Alert>;

  const pendingItems = r.items.filter((i: any) => !i.returnedAt);
  const canFit = ['CONFIRMADA', 'AJUSTE_CONCLUIDO', 'PROVA_AGENDADA'].includes(r.status);
  const canAdj = ['PROVA_REALIZADA', 'AJUSTE_NECESSARIO', 'AJUSTE_CONCLUIDO'].includes(r.status);
  const canReturn = IN_POSSESSION_STATUSES.includes(r.status) && pendingItems.length > 0;
  const canCancel = TRANSITIONS[r.status as Status].includes('CANCELADA');
  const retState = (i: any) => ret[i.id] ?? { on: true, condition: 'OK' as const, reason: '', qty: i.quantity };
  const setRetFor = (i: any, patch: object) => setRet((s) => ({ ...s, [i.id]: { ...retState(i), ...patch } }));

  const submitReturn = () => go(() => api.post(`/api/admin/reservations/${id}/return`, {
    ...retInfo, lines: pendingItems.filter((i: any) => retState(i).on).map((i: any) => { const s = retState(i);
      return { itemId: i.id, condition: s.condition, reason: s.reason, maintenanceQuantity: s.condition === 'MANUTENCAO' ? s.qty : undefined }; }),
  }), 'Devolução registrada.');

  return (
    <div>
      <p className="small"><Link to="/admin/reservas">← Reservas</Link></p>
      <div className="page-head"><h1>{r.code}</h1><div><StatusBadge status={r.status} overdue={r.overdue} /></div></div>
      {act.error && <Alert>{act.error}</Alert>}{act.ok && <Alert kind="ok">{act.ok}</Alert>}
      {r.overdue && <Alert kind="error"><strong>Devolução atrasada.</strong> Prevista para {formatBR(r.returnDate)}. As peças continuam indisponíveis até a devolução real.</Alert>}

      <div className="cols-2">
        <div className="box"><h2>Cliente e período</h2>
          <dl className="kv">
            <dt>Cliente</dt><dd><Link to={`/admin/clientes?abrir=${r.customer.id}`}>{r.customer.name}</Link></dd>
            <dt>WhatsApp</dt><dd><a href={waLink(r.customer.whatsapp)} target="_blank" rel="noopener">{phoneDisplay(r.customer.whatsapp)}</a></dd>
            {r.customer.email && <><dt>E-mail</dt><dd>{r.customer.email}</dd></>}
            {r.groupName && <><dt>Grupo</dt><dd>{r.groupName}</dd></>}
            <dt>Retirada</dt><dd>{formatBR(r.pickupDate)}</dd><dt>Evento</dt><dd>{formatBR(r.eventDate)}</dd><dt>Devolução prevista</dt><dd>{formatBR(r.returnDate)}</dd>
            {r.notes && <><dt>Observações</dt><dd style={{ whiteSpace: 'pre-line' }}>{r.notes}</dd></>}
          </dl></div>
        <div className="box"><h2>Itens</h2>
          <div className="table-wrap"><table><thead><tr><th>Traje</th><th>Tam.</th><th className="num">Qtd.</th><th>Situação</th></tr></thead><tbody>
            {r.items.map((i: any) => (<tr key={i.id}><td>{i.productName}{i.participantName && <div className="small muted">{i.participantName}</div>}</td><td>{i.size}</td><td className="num">{i.quantity}</td>
              <td className="small">{i.returnedAt ? <>Devolvido em {formatBR(i.returnedAt)}{i.returnCondition === 'MANUTENCAO' && <> <span className="badge warn">Manutenção</span></>}</> : '—'}</td></tr>))}
          </tbody></table></div></div>
      </div>

      <div className="box"><h2>Ações</h2>
        <div className="actions">
          {next.map((s) => <button key={s} className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => go(() => api.post(`/api/admin/reservations/${id}/status`, { to: s }), `Status: ${STATUS_LABEL[s]}`)}>{ACTION_LABEL[s]}</button>)}
          {next.length === 0 && !canCancel && !canReturn && !canFit && !canAdj && <span className="muted small">Nenhuma ação disponível neste status.</span>}
        </div>
        {canCancel && (<div className="actions" style={{ marginTop: '1rem' }}>
          <input type="text" placeholder="Motivo do cancelamento (opcional)" style={{ maxWidth: 320 }} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          <button className="btn btn-danger btn-sm" disabled={act.busy} onClick={() => confirm('Cancelar esta reserva? As peças serão liberadas automaticamente.') && go(() => api.post(`/api/admin/reservations/${id}/cancel`, { reason: cancelReason }), 'Reserva cancelada.')}>Cancelar reserva</button></div>)}
      </div>

      {(canFit || r.fittings.length > 0) && (
        <div className="box"><h2>Prova</h2>
          {r.fittings.map((f: any) => (<div key={f.id} className="actions" style={{ padding: '.4rem 0', borderBottom: '1px solid #efe9db' }}>
            <span><strong>{formatBR(f.scheduled_date)} às {f.scheduled_time}</strong> — <span className={`badge ${f.status === 'REALIZADA' ? 'ok' : 'info'}`}>{f.status === 'REALIZADA' ? 'Realizada' : 'Agendada'}</span> {f.result && <span className="small muted">{f.result}</span>}</span>
            {f.status === 'AGENDADA' && <button className="btn btn-ghost btn-sm" disabled={act.busy} onClick={() => { const res = prompt('Resultado da prova (ex.: serviu bem / precisa ajustar a calça):') ?? ''; go(() => api.post(`/api/admin/fittings/${f.id}/complete`, { result: res }), 'Prova registrada.'); }}>Marcar realizada</button>}
          </div>))}
          {canFit && (<div className="toolbar" style={{ marginTop: '.8rem' }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor="fd">Data</label><input id="fd" type="date" value={fit.date} onChange={(e) => setFit({ ...fit, date: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label htmlFor="ft">Horário</label><input id="ft" type="time" value={fit.time} onChange={(e) => setFit({ ...fit, time: e.target.value })} /></div>
            <button className="btn btn-primary btn-sm" disabled={!fit.date || !fit.time || act.busy} onClick={() => go(() => api.post(`/api/admin/reservations/${id}/fittings`, fit), 'Prova agendada.')}>Agendar prova</button></div>)}
        </div>)}

      {(canAdj || r.adjustments.length > 0) && (
        <div className="box"><h2>Ajustes</h2>
          {r.adjustments.map((a: any) => (<div key={a.id} className="actions" style={{ padding: '.4rem 0', borderBottom: '1px solid #efe9db', justifyContent: 'space-between' }}>
            <span>{a.description} <span className="small muted">({a.product_name} {a.size_code})</span></span>
            <select aria-label="Status do ajuste" value={a.status} style={{ width: 'auto', minHeight: 36 }} disabled={act.busy} onChange={(e) => go(() => api.put(`/api/admin/adjustments/${a.id}`, { status: e.target.value }))}>
              <option value="PENDENTE">Pendente</option><option value="EM_AJUSTE">Em ajuste</option><option value="CONCLUIDO">Concluído</option></select></div>))}
          {canAdj && (<div className="toolbar" style={{ marginTop: '.8rem' }}>
            <div className="field" style={{ margin: 0 }}><label htmlFor="ai">Item</label><select id="ai" value={adj.itemId} onChange={(e) => setAdj({ ...adj, itemId: Number(e.target.value) })}><option value={0}>Selecione…</option>{r.items.map((i: any) => <option key={i.id} value={i.id}>{i.productName} {i.size}{i.participantName ? ` — ${i.participantName}` : ''}</option>)}</select></div>
            <div className="field" style={{ margin: 0, flex: '1 1 260px' }}><label htmlFor="ad">Ajuste necessário</label><input id="ad" type="text" placeholder="Ex.: Regular comprimento da calça" value={adj.description} onChange={(e) => setAdj({ ...adj, description: e.target.value })} /></div>
            <button className="btn btn-primary btn-sm" disabled={!adj.itemId || adj.description.trim().length < 3 || act.busy} onClick={() => go(() => api.post(`/api/admin/reservations/${id}/adjustments`, adj).then(() => setAdj({ itemId: 0, description: '' })), 'Ajuste registrado.')}>Adicionar ajuste</button></div>)}
        </div>)}

      {canReturn && (
        <div className="box"><h2>Registrar devolução</h2>
          <p className="small muted">Peças devolvidas em boas condições voltam automaticamente à disponibilidade. Peças que precisam de lavagem, reparo ou costura ficam em manutenção até você liberar para estoque.</p>
          {pendingItems.map((i: any) => { const s = retState(i); return (
            <div key={i.id} className="line-item" style={{ gridTemplateColumns: '1fr' }}>
              <label style={{ display: 'flex', gap: '.6rem', alignItems: 'center' }}><input type="checkbox" checked={s.on} onChange={(e) => setRetFor(i, { on: e.target.checked })} style={{ width: 20, height: 20 }} /><strong>{i.productName}</strong> — {i.size} × {i.quantity}{i.participantName ? ` (${i.participantName})` : ''}</label>
              {s.on && (<div className="row three">
                <Field label="Condição"><select value={s.condition} onChange={(e) => setRetFor(i, { condition: e.target.value })}><option value="OK">Em ordem — voltar ao estoque</option><option value="MANUTENCAO">Precisa de manutenção</option></select></Field>
                {s.condition === 'MANUTENCAO' && <><Field label="Motivo"><input type="text" placeholder="Lavagem, costura, reparo…" value={s.reason} onChange={(e) => setRetFor(i, { reason: e.target.value })} /></Field>
                  {i.quantity > 1 && <Field label="Unidades em manutenção"><input type="number" min={1} max={i.quantity} value={s.qty} onChange={(e) => setRetFor(i, { qty: Number(e.target.value) })} /></Field>}</>}
              </div>)}
            </div>); })}
          <div className="row three">
            <Field label="Conferido por"><input type="text" value={retInfo.checkedBy} onChange={(e) => setRetInfo({ ...retInfo, checkedBy: e.target.value })} /></Field>
            <Field label="Data da devolução"><input type="date" max={today()} value={retInfo.actualDate} onChange={(e) => setRetInfo({ ...retInfo, actualDate: e.target.value })} /></Field>
            <Field label="Observações"><input type="text" value={retInfo.notes} onChange={(e) => setRetInfo({ ...retInfo, notes: e.target.value })} /></Field>
          </div>
          <button className="btn btn-primary" disabled={act.busy || !pendingItems.some((i: any) => retState(i).on)} onClick={submitReturn}>Confirmar devolução</button>
        </div>)}

      {r.maintenance.length > 0 && (<div className="box"><h2>Manutenção desta reserva</h2>
        {r.maintenance.map((m: any) => (<div key={m.id} className="actions" style={{ justifyContent: 'space-between', padding: '.4rem 0' }}>
          <span>{m.quantity} un. — {m.reason} <span className={`badge ${m.status === 'LIBERADO' ? 'ok' : 'warn'}`}>{m.status === 'LIBERADO' ? 'Liberada' : 'Em manutenção'}</span></span>
          {m.status === 'EM_MANUTENCAO' && <button className="btn btn-gold btn-sm" disabled={act.busy} onClick={() => go(() => api.post(`/api/admin/maintenance/${m.id}/release`), 'Peça liberada para estoque.')}>Liberar para estoque</button>}</div>))}</div>)}

      <div className="box"><h2>Histórico</h2>
        <ul className="timeline">{r.events.map((e: any) => (<li key={e.id}><time>{formatTs(e.created_at)}</time>
          {e.type === 'STATUS' ? <>Status: {STATUS_LABEL[e.from_status as Status] ?? '—'} → <strong>{STATUS_LABEL[e.to_status as Status]}</strong></> : e.type === 'DEVOLUCAO_ATRASADA' ? <strong style={{ color: 'var(--danger)' }}>Devolução atrasada</strong> : e.type === 'DEVOLUCAO' ? 'Devolução conferida' : 'Solicitação criada'}
          {e.note && <div className="small muted">{e.note}</div>}</li>))}</ul></div>
    </div>
  );
}
