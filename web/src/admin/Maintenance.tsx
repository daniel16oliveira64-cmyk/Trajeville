import { useState } from 'react';
import { usePageMeta } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Field, Spinner } from '../components/ui.tsx';
import { formatTs } from '../lib/format.ts';
import { useAction } from './shared.tsx';

export function MaintenancePage() {
  usePageMeta('Manutenção — Painel Trajeville');
  const [tab, setTab] = useState<'EM_MANUTENCAO' | 'LIBERADO'>('EM_MANUTENCAO');
  const { data, loading, error, reload } = useFetch<any[]>(`/api/admin/maintenance?status=${tab}`);
  const products = useFetch<any[]>('/api/admin/products');
  const act = useAction();
  const [f, setF] = useState({ productId: 0, size: '', quantity: 1, reason: '' });
  const prod = products.data?.find((p) => p.id === f.productId);
  return (
    <div>
      <div className="page-head"><h1>Manutenção</h1><div className="seg" role="group"><button aria-pressed={tab === 'EM_MANUTENCAO'} onClick={() => setTab('EM_MANUTENCAO')}>Em manutenção</button><button aria-pressed={tab === 'LIBERADO'} onClick={() => setTab('LIBERADO')}>Liberadas</button></div></div>
      <p className="muted small" style={{ maxWidth: 720 }}>Peças em manutenção <strong>não contam como disponíveis</strong>. Depois do reparo, lavagem ou ajuste, clique em <strong>Liberar para estoque</strong>.</p>
      {act.error && <Alert>{act.error}</Alert>}{act.ok && <Alert kind="ok">{act.ok}</Alert>}
      {loading && !data ? <Spinner /> : error ? <Alert>{error.message}</Alert> : (
        <div className="table-wrap"><table><thead><tr><th>Traje</th><th>Tam.</th><th className="num">Qtd.</th><th>Motivo</th><th>Reserva</th><th>{tab === 'LIBERADO' ? 'Liberada' : 'Entrada'}</th><th></th></tr></thead><tbody>
          {data!.map((m) => (<tr key={m.id}><td>{m.product}</td><td><strong>{m.size}</strong></td><td className="num">{m.quantity}</td><td>{m.reason}</td><td>{m.reservationCode ?? '—'}</td>
            <td className="small">{tab === 'LIBERADO' ? `${formatTs(m.releasedAt)} · ${m.releasedBy}` : formatTs(m.openedAt)}</td>
            <td>{m.status === 'EM_MANUTENCAO' && <button className="btn btn-gold btn-sm" disabled={act.busy} onClick={() => act.run(async () => { await api.post(`/api/admin/maintenance/${m.id}/release`); reload(); }, 'Peça liberada para estoque.')}>Liberar para estoque</button>}</td></tr>))}
          {data!.length === 0 && <tr><td colSpan={7} className="muted center">{tab === 'EM_MANUTENCAO' ? 'Nenhuma peça em manutenção.' : 'Nenhuma peça liberada ainda.'}</td></tr>}</tbody></table></div>)}
      <div className="box" style={{ marginTop: '1.4rem' }}><h2>Enviar peça do estoque para manutenção</h2>
        <div className="row three">
          <Field label="Traje" htmlFor="mp"><select id="mp" value={f.productId} onChange={(e) => setF({ ...f, productId: Number(e.target.value), size: '' })}><option value={0}>Selecione…</option>{(products.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Tamanho" htmlFor="ms"><select id="ms" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}><option value="">Selecione…</option>{(prod?.sizes ?? []).map((s: string) => <option key={s} value={s}>{s}</option>)}</select></Field>
          <Field label="Quantidade" htmlFor="mq"><input id="mq" type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} /></Field>
        </div>
        <Field label="Motivo" htmlFor="mr"><input id="mr" type="text" placeholder="Lavagem especial, costura, reparo…" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        <button className="btn btn-primary btn-sm" disabled={act.busy || !f.productId || !f.size || f.reason.trim().length < 3} onClick={() => act.run(async () => { await api.post('/api/admin/maintenance', f); setF({ productId: 0, size: '', quantity: 1, reason: '' }); reload(); }, 'Peça enviada para manutenção.')}>Enviar para manutenção</button>
      </div>
    </div>
  );
}
