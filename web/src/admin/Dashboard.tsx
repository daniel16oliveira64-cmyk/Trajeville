import { Link, usePageMeta } from '../lib/router.tsx';
import { useFetch } from '../lib/api.ts';
import { Spinner, Alert, StatusBadge } from '../components/ui.tsx';
import { formatBR } from '../lib/format.ts';

const Stat = ({ n, label, to, tone }: { n: number; label: string; to?: string; tone?: string }) => {
  const inner = <><b>{n}</b><span>{label}</span></>;
  return to ? <Link to={to} className={`stat ${tone ?? ''}`}>{inner}</Link> : <div className={`stat ${tone ?? ''}`}>{inner}</div>;
};

function ResList({ title, rows, empty }: { title: string; rows: any[]; empty: string }) {
  return (
    <div className="box"><h2>{title}</h2>
      {rows.length === 0 ? <p className="muted small">{empty}</p> : rows.map((r) => (
        <Link key={r.id} to={`/admin/reservas/${r.id}`} style={{ display: 'block', padding: '.55rem 0', borderBottom: '1px solid #efe9db', textDecoration: 'none' }}>
          <strong>{r.customer.name}</strong> <span className="muted small">{r.code}</span> <StatusBadge status={r.status} overdue={r.overdue} />
          <div className="small muted">{r.items.map((i: any) => `${i.productName} ${i.size}×${i.quantity}`).join(' · ')} — devolução {formatBR(r.returnDate)}</div>
        </Link>
      ))}
    </div>
  );
}

export function Dashboard() {
  usePageMeta('Início — Painel Trajeville');
  const { data: d, loading, error } = useFetch<any>('/api/admin/dashboard');
  if (loading) return <Spinner />;
  if (error || !d) return <Alert>{error?.message}</Alert>;
  return (
    <div>
      <h1>Visão geral</h1>
      <div className="stats">
        <Stat n={d.pending} label="Solicitações pendentes" to="/admin/reservas?filtro=pendentes" tone={d.pending ? 'warn' : ''} />
        <Stat n={d.confirmed} label="Reservas confirmadas" to="/admin/reservas?filtro=confirmadas" tone="ok" />
        <Stat n={d.upcomingFittings.length} label="Provas nos próximos 7 dias" />
        <Stat n={d.pendingAdjustments} label="Ajustes pendentes" tone={d.pendingAdjustments ? 'warn' : ''} />
        <Stat n={d.ready} label="Trajes prontos" to="/admin/reservas?status=PRONTO_PARA_RETIRADA" tone="ok" />
        <Stat n={d.pickupsToday.length} label="Retiradas hoje" />
        <Stat n={d.returnsToday.length} label="Devoluções hoje" />
        <Stat n={d.overdue.length} label="Devoluções atrasadas" to="/admin/reservas?filtro=atrasadas" tone={d.overdue.length ? 'danger' : ''} />
        <Stat n={d.maintenanceUnits} label="Peças em manutenção" to="/admin/manutencao" tone={d.maintenanceUnits ? 'warn' : ''} />
        <Stat n={d.availableToday} label="Peças disponíveis hoje" to="/admin/estoque" />
      </div>
      <div className="cols-2">
        <ResList title="Devoluções atrasadas" rows={d.overdue} empty="Nenhuma devolução atrasada." />
        <ResList title="Retiradas de hoje" rows={d.pickupsToday} empty="Nenhuma retirada hoje." />
        <ResList title="Devoluções de hoje" rows={d.returnsToday} empty="Nenhuma devolução prevista hoje." />
        <div className="box"><h2>Próximas provas</h2>
          {d.upcomingFittings.length === 0 ? <p className="muted small">Nenhuma prova agendada.</p> : d.upcomingFittings.map((f: any) => (
            <Link key={f.id} to={`/admin/reservas/${f.reservationId}`} style={{ display: 'block', padding: '.5rem 0', borderBottom: '1px solid #efe9db', textDecoration: 'none' }}>
              <strong>{formatBR(f.date)} às {f.time}</strong> — {f.customer} <span className="muted small">{f.code}</span></Link>))}
        </div>
      </div>
    </div>
  );
}
