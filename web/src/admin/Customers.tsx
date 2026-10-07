import { useEffect, useState } from 'react';
import { Link, navigate, usePageMeta, useSearch } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Field, Modal, Spinner, StatusBadge } from '../components/ui.tsx';
import { formatBR, phoneDisplay, waLink } from '../lib/format.ts';
import { useAction } from './shared.tsx';

function CustomerModal({ id, onClose, onSaved }: { id: number; onClose: () => void; onSaved: () => void }) {
  const { data: c, loading, reload } = useFetch<any>(`/api/admin/customers/${id}`);
  const [name, setName] = useState(''); const [email, setEmail] = useState(''); const [notes, setNotes] = useState('');
  const act = useAction();
  useEffect(() => { if (c) { setName(c.name); setEmail(c.email ?? ''); setNotes(c.notes ?? ''); } }, [c?.id]);   // eslint-disable-line
  return (
    <Modal title="Cliente" onClose={onClose}>
      {loading && !c ? <Spinner /> : c && (<>
        {act.error && <Alert>{act.error}</Alert>}{act.ok && <Alert kind="ok">{act.ok}</Alert>}
        <Field label="Nome" htmlFor="cn"><input id="cn" type="text" value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <p><a href={waLink(c.whatsapp)} target="_blank" rel="noopener">WhatsApp {phoneDisplay(c.whatsapp)}</a></p>
        <Field label="E-mail" htmlFor="ce"><input id="ce" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Observações" htmlFor="co"><textarea id="co" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <button className="btn btn-primary btn-sm" disabled={act.busy} onClick={() => act.run(async () => { await api.put(`/api/admin/customers/${id}`, { name, email, notes }); reload(); onSaved(); }, 'Cliente salvo.')}>Salvar</button>
        <h3 style={{ marginTop: '1.5rem' }}>Histórico de locações</h3>
        {c.history.length === 0 ? <p className="muted small">Sem reservas.</p> : c.history.map((r: any) => (
          <Link key={r.id} to={`/admin/reservas/${r.id}`} style={{ display: 'block', padding: '.6rem 0', borderBottom: '1px solid var(--line)', textDecoration: 'none' }}>
            <strong>{r.code}</strong> <StatusBadge status={r.status} overdue={r.overdue} />
            <div className="small muted">{formatBR(r.pickupDate)} → {formatBR(r.returnDate)} · evento {formatBR(r.eventDate)}</div>
            <div className="small">{r.items.map((i: any) => `${i.productName} ${i.size}×${i.quantity}`).join(' · ')}</div></Link>))}
      </>)}
    </Modal>
  );
}

export function CustomersPage() {
  usePageMeta('Clientes — Painel Trajeville');
  const [q, setQ] = useState('');
  const sp = new URLSearchParams(useSearch()); const open = Number(sp.get('abrir')) || null;
  const { data, loading, error, reload } = useFetch<any[]>(`/api/admin/customers${q ? `?q=${encodeURIComponent(q)}` : ''}`);
  return (
    <div>
      <div className="page-head"><h1>Clientes</h1></div>
      <div className="toolbar"><div className="field" style={{ margin: 0 }}><label htmlFor="cq">Buscar</label><input id="cq" type="search" placeholder="Nome, WhatsApp ou e-mail" value={q} onChange={(e) => setQ(e.target.value)} /></div></div>
      {loading && !data ? <Spinner /> : error ? <Alert>{error.message}</Alert> : (
        <div className="table-wrap"><table><thead><tr><th>Nome</th><th>WhatsApp</th><th>E-mail</th><th className="num">Reservas</th><th>Última</th></tr></thead><tbody>
          {data!.map((c) => (<tr key={c.id} className="click" onClick={() => navigate(`/admin/clientes?abrir=${c.id}`)}><td><strong>{c.name}</strong>{c.notes && <div className="small muted">{c.notes.slice(0, 60)}</div>}</td><td>{phoneDisplay(c.whatsapp)}</td><td>{c.email ?? '—'}</td><td className="num">{c.reservations}</td><td>{c.lastReservation ? formatBR(c.lastReservation.slice(0, 10)) : '—'}</td></tr>))}
          {data!.length === 0 && <tr><td colSpan={5} className="muted center">Nenhum cliente encontrado.</td></tr>}</tbody></table></div>)}
      {open && <CustomerModal id={open} onClose={() => navigate('/admin/clientes')} onSaved={reload} />}
    </div>
  );
}
