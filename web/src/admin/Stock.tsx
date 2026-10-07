import { useState } from 'react';
import { Link, usePageMeta } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Spinner } from '../components/ui.tsx';
import { categoryLabel } from '../lib/format.ts';
import { useAction, today } from './shared.tsx';

export function StockPage() {
  usePageMeta('Estoque — Painel Trajeville');
  const [date, setDate] = useState(today());
  const { data, loading, error, reload } = useFetch<any[]>(`/api/admin/stock?date=${date}`);
  const act = useAction();
  const [edit, setEdit] = useState<Record<string, number>>({});
  return (
    <div>
      <div className="page-head"><h1>Estoque</h1></div>
      <p className="muted small" style={{ maxWidth: 720 }}>Estoque por <strong>traje + tamanho</strong> na data escolhida. Você edita somente o <strong>total</strong>; os demais números são calculados automaticamente a partir das reservas, devoluções e manutenção.</p>
      <div className="toolbar"><div className="field" style={{ margin: 0 }}><label htmlFor="sd">Situação em</label><input id="sd" type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></div></div>
      {act.error && <Alert>{act.error}</Alert>}{act.ok && <Alert kind="ok">{act.ok}</Alert>}
      {loading && !data ? <Spinner /> : error ? <Alert>{error.message}</Alert> : (
        <div className="table-wrap"><table>
          <thead><tr><th>Traje</th><th>Tam.</th><th className="num">Total</th><th className="num">Reservado</th><th className="num">Em uso</th><th className="num">Aguard. devol.</th><th className="num">Atrasado</th><th className="num">Manutenção</th><th className="num">Disponível</th></tr></thead>
          <tbody>{data!.flatMap((p) => p.sizes.map((s: any, i: number) => {
            const key = `${p.id}|${s.size}`; const val = edit[key] ?? s.total;
            return (<tr key={key}>
              <td>{i === 0 && <><Link to={`/admin/trajes/${p.id}`}><strong>{p.name}</strong></Link><div className="small muted">{categoryLabel(p.category)}{p.isDemo ? ' · demonstração' : ''}</div></>}</td>
              <td><strong>{s.size}</strong></td>
              <td className="num stock-cell"><input type="number" min={0} aria-label={`Total ${p.name} ${s.size}`} value={val} onChange={(e) => setEdit({ ...edit, [key]: Number(e.target.value) })} />
                {val !== s.total && <button className="btn btn-primary btn-sm" style={{ marginLeft: 6 }} disabled={act.busy} onClick={() => act.run(async () => { await api.put(`/api/admin/products/${p.id}/sizes/${s.size}`, { stock: val }); setEdit((x) => { const n = { ...x }; delete n[key]; return n; }); reload(); }, 'Estoque atualizado.')}>Salvar</button>}</td>
              <td className="num">{s.reserved}</td><td className="num">{s.inUse}</td><td className="num">{s.awaitingReturn}</td>
              <td className="num" style={s.overdue ? { color: 'var(--danger)', fontWeight: 700 } : undefined}>{s.overdue}</td><td className="num">{s.maintenance}</td>
              <td className={`num avail-n ${s.available === 0 ? 'zero' : ''}`}>{s.available}</td></tr>);
          }))}</tbody></table></div>)}
    </div>
  );
}
