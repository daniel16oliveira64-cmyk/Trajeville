import { useMemo, useState } from 'react';
import { navigate, usePageMeta } from '../lib/router.tsx';
import { useFetch } from '../lib/api.ts';
import { Alert, Spinner } from '../components/ui.tsx';
import { addDays } from '../../../server/domain/dates.ts';
import { STATUSES, STATUS_LABEL } from '../../../server/domain/constants.ts';
import { longDate, monthName, formatBR, capitalize } from '../lib/format.ts';
import { today } from './shared.tsx';

type View = 'month' | 'week' | 'day';
const dow = (iso: string) => new Date(iso + 'T12:00:00').getDay();
const startOfWeek = (iso: string) => addDays(iso, -dow(iso));

export function CalendarPage() {
  usePageMeta('Calendário — Painel Trajeville');
  const [view, setView] = useState<View>('month');
  const [anchor, setAnchor] = useState(today());
  const [status, setStatus] = useState(''); const [productId, setProductId] = useState('');
  const products = useFetch<any[]>('/api/admin/products');

  const { from, to, cells } = useMemo(() => {
    if (view === 'day') return { from: anchor, to: anchor, cells: [anchor] };
    if (view === 'week') { const f = startOfWeek(anchor); return { from: f, to: addDays(f, 6), cells: Array.from({ length: 7 }, (_, i) => addDays(f, i)) }; }
    const first = anchor.slice(0, 8) + '01'; const f = startOfWeek(first);
    return { from: f, to: addDays(f, 41), cells: Array.from({ length: 42 }, (_, i) => addDays(f, i)) };
  }, [view, anchor]);
  const qs = `from=${from}&to=${to}${status ? `&status=${status}` : ''}${productId ? `&productId=${productId}` : ''}`;
  const { data, loading, error } = useFetch<any>(`/api/admin/calendar?${qs}`);

  const byDay = useMemo(() => {
    const m = new Map<string, Array<{ kind: string; e?: any; f?: any }>>();
    const put = (d: string, v: any) => { if (d >= from && d <= to) m.set(d, [...(m.get(d) ?? []), v]); };
    for (const e of data?.entries ?? []) { put(e.pickupDate, { kind: 'pickup', e }); put(e.eventDate, { kind: 'event', e }); put(e.returnDate, { kind: 'return', e }); }
    for (const f of data?.fittings ?? []) put(f.date, { kind: 'fit', f });
    return m;
  }, [data, from, to]);

  const move = (dir: number) => setAnchor(view === 'month' ? (() => { const d = new Date(anchor + 'T12:00:00'); d.setMonth(d.getMonth() + dir, 1); return d.toLocaleDateString('en-CA'); })() : addDays(anchor, dir * (view === 'week' ? 7 : 1)));
  const d = new Date(anchor + 'T12:00:00');
  const title = view === 'month' ? `${capitalize(monthName(d.getMonth()))} de ${d.getFullYear()}` : view === 'week' ? `${formatBR(from)} a ${formatBR(to)}` : capitalize(longDate(anchor));

  const Ev = ({ it }: { it: { kind: string; e?: any; f?: any } }) => {
    if (it.kind === 'fit') return <button className="ev fit" onClick={() => navigate(`/admin/reservas/${it.f.reservationId}`)} title="Prova">Prova {it.f.time} · {it.f.customer}</button>;
    const e = it.e; const label = it.kind === 'pickup' ? 'Retirada' : it.kind === 'event' ? 'Evento' : 'Devolução';
    const cls = it.kind === 'return' && e.overdue ? 'overdue' : it.kind;
    return <button className={`ev ${cls}`} onClick={() => navigate(`/admin/reservas/${e.reservationId}`)} title={`${label} · ${STATUS_LABEL[e.status as keyof typeof STATUS_LABEL]}`}>
      <strong>{label}</strong> {e.customer} · {e.product} {e.size}×{e.quantity}{view !== 'month' && <> · <em>{STATUS_LABEL[e.status as keyof typeof STATUS_LABEL]}</em></>}{e.overdue && it.kind === 'return' && ' · ATRASADA'}</button>;
  };

  return (
    <div>
      <div className="page-head"><h1>Calendário</h1></div>
      <div className="cal-head">
        <div className="actions"><button className="btn btn-ghost btn-sm" onClick={() => move(-1)} aria-label="Anterior">←</button><button className="btn btn-ghost btn-sm" onClick={() => setAnchor(today())}>Hoje</button><button className="btn btn-ghost btn-sm" onClick={() => move(1)} aria-label="Próximo">→</button><h2>{title}</h2></div>
        <div className="seg" role="group" aria-label="Visualização">{(['day', 'week', 'month'] as View[]).map((v) => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'day' ? 'Dia' : v === 'week' ? 'Semana' : 'Mês'}</button>)}</div>
      </div>
      <div className="toolbar">
        <div className="field" style={{ margin: 0 }}><label htmlFor="cs">Status</label><select id="cs" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">Todos</option>{STATUSES.filter((s) => s !== 'CANCELADA').map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select></div>
        <div className="field" style={{ margin: 0 }}><label htmlFor="cp">Traje</label><select id="cp" value={productId} onChange={(e) => setProductId(e.target.value)}><option value="">Todos</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      </div>
      {error && <Alert>{error.message}</Alert>}{loading && !data && <Spinner />}
      {view === 'day' ? (
        <div className="box cal-day">{(byDay.get(anchor) ?? []).length === 0 ? <p className="muted">Nada programado para este dia.</p> : (byDay.get(anchor) ?? []).map((it, i) => <Ev key={i} it={it} />)}</div>
      ) : (
        <div className={`cal ${view}`}>
          {view === 'month' || view === 'week' ? ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'].map((n) => <div key={n} className="dow">{n}</div>) : null}
          {cells.map((day) => (
            <div key={day} className={`day ${view === 'month' && day.slice(0, 7) !== anchor.slice(0, 7) ? 'out' : ''} ${day === today() ? 'today' : ''}`}>
              <span className="dn">{Number(day.slice(8))}</span>
              {(byDay.get(day) ?? []).map((it, i) => <Ev key={i} it={it} />)}
            </div>))}
        </div>)}
      <div className="legend"><span><i style={{ background: 'var(--ok)' }} />Retirada</span><span><i style={{ background: 'var(--gold)' }} />Evento</span><span><i style={{ background: 'var(--info)' }} />Devolução</span><span><i style={{ background: 'var(--danger)' }} />Devolução atrasada</span><span><i style={{ background: 'var(--teal)' }} />Prova</span></div>
    </div>
  );
}
