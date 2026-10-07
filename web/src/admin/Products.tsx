import { useEffect, useState } from 'react';
import { Link, navigate, usePageMeta } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Field, Placeholder, SizeChips, Spinner } from '../components/ui.tsx';
import { SIZES, type SizeCode } from '../../../server/domain/constants.ts';
import { categoryLabel } from '../lib/format.ts';
import { useAction } from './shared.tsx';

export function ProductList() {
  usePageMeta('Trajes — Painel Trajeville');
  const { data, loading, error } = useFetch<any[]>('/api/admin/products');
  return (
    <div>
      <div className="page-head"><h1>Trajes</h1><Link to="/admin/trajes/novo" className="btn btn-primary btn-sm">Novo traje</Link></div>
      {loading ? <Spinner /> : error ? <Alert>{error.message}</Alert> : (
        <div className="table-wrap"><table><thead><tr><th style={{ width: 70 }}>Foto</th><th>Traje</th><th>Categoria</th><th>Tamanhos</th><th>Status</th></tr></thead><tbody>
          {data!.map((p) => (
            <tr key={p.id} className="click" onClick={() => navigate(`/admin/trajes/${p.id}`)}>
              <td><div style={{ width: 52, height: 68, background: '#ece6d8', overflow: 'hidden', borderRadius: 2 }}>{p.primaryImage ? <img src={p.primaryImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}</div></td>
              <td><Link to={`/admin/trajes/${p.id}`}>{p.name}</Link>{p.isDemo && <> <span className="badge muted">Demonstração</span></>}</td>
              <td>{categoryLabel(p.category)}</td><td><SizeChips sizes={p.sizes.map((s: string) => ({ size: s }))} /></td>
              <td><span className={`badge ${p.status === 'ATIVO' ? 'ok' : p.status === 'INATIVO' ? 'muted' : 'warn'}`}>{p.status === 'ATIVO' ? 'Ativo' : p.status === 'INATIVO' ? 'Inativo' : 'Rascunho'}</span></td></tr>))}
          {data!.length === 0 && <tr><td colSpan={5} className="muted center">Nenhum traje cadastrado.</td></tr>}
        </tbody></table></div>)}
    </div>
  );
}

const blank = { name: '', category: 'MASCULINO', status: 'RASCUNHO', description: '', includedPieces: '', accessories: '', notes: '' };

export function ProductEdit({ id }: { id: number | null }) {
  usePageMeta(id ? 'Editar traje — Painel Trajeville' : 'Novo traje — Painel Trajeville');
  const list = useFetch<any[]>('/api/admin/products');
  const stock = useFetch<any[]>(id ? `/api/admin/stock?date=${new Date().toLocaleDateString('en-CA')}` : null);
  const act = useAction();
  const [f, setF] = useState<any>(blank);
  const [newSizes, setNewSizes] = useState<Record<string, { on: boolean; stock: number }>>({});
  const [edit, setEdit] = useState<Record<string, number>>({});
  const [addSize, setAddSize] = useState({ size: '', stock: 1 });
  const product = id ? list.data?.find((p) => p.id === id) : null;
  useEffect(() => { if (product) setF({ name: product.name, category: product.category, status: product.status, description: product.description, includedPieces: product.includedPieces, accessories: product.accessories, notes: product.notes }); }, [product?.id]);   // eslint-disable-line
  const reloadAll = () => { list.reload(); stock.reload(); };
  if (id && list.loading && !list.data) return <Spinner />;
  if (id && !product) return <Alert>Traje não encontrado.</Alert>;
  const set = (k: string, v: string) => setF((s: any) => ({ ...s, [k]: v }));
  const totals: Record<string, number> = Object.fromEntries((stock.data?.find((p) => p.id === id)?.sizes ?? []).map((s: any) => [s.size, s.total]));
  const missing = SIZES.filter((s) => !product?.sizes.includes(s));

  const create = () => act.run(async () => {
    const sizes = SIZES.filter((s) => newSizes[s]?.on).map((s) => ({ size: s, stock: newSizes[s]!.stock }));
    const r = await api.post<{ id: number }>('/api/admin/products', { ...f, sizes }); navigate(`/admin/trajes/${r.id}`);
  });
  const save = () => act.run(async () => { await api.put(`/api/admin/products/${id}`, f); reloadAll(); }, 'Traje salvo.');
  const upload = async (files: FileList | null) => {
    if (!files) return;
    await act.run(async () => { for (const file of Array.from(files)) await api.upload(`/api/admin/products/${id}/images?alt=${encodeURIComponent(f.name)}`, file); reloadAll(); }, 'Fotos enviadas.');
  };
  const move = (idx: number, dir: number) => {
    const ids = product.images.map((i: any) => i.id); const j = idx + dir; if (j < 0 || j >= ids.length) return;
    [ids[idx], ids[j]] = [ids[j], ids[idx]]; act.run(async () => { await api.put(`/api/admin/products/${id}/images-order`, { ids }); reloadAll(); });
  };

  const form = (
    <div className="box">
      <h2>Dados do traje</h2>
      <div className="row two">
        <Field label="Nome" htmlFor="pn"><input id="pn" type="text" value={f.name} maxLength={120} onChange={(e) => set('name', e.target.value)} /></Field>
        <div className="row two" style={{ gap: '1rem' }}>
          <Field label="Categoria" htmlFor="pc"><select id="pc" value={f.category} onChange={(e) => set('category', e.target.value)}><option value="FEMININO">Feminino</option><option value="MASCULINO">Masculino</option></select></Field>
          <Field label="Status" htmlFor="ps"><select id="ps" value={f.status} onChange={(e) => set('status', e.target.value)}><option value="RASCUNHO">Rascunho</option><option value="ATIVO">Ativo (aparece no site)</option><option value="INATIVO">Inativo</option></select></Field>
        </div>
      </div>
      <Field label="Descrição" htmlFor="pd"><textarea id="pd" value={f.description} onChange={(e) => set('description', e.target.value)} /></Field>
      <div className="row two">
        <Field label="Peças incluídas" hint="Uma por linha" htmlFor="pp"><textarea id="pp" value={f.includedPieces} onChange={(e) => set('includedPieces', e.target.value)} /></Field>
        <Field label="Acessórios" hint="Um por linha" htmlFor="pa"><textarea id="pa" value={f.accessories} onChange={(e) => set('accessories', e.target.value)} /></Field>
      </div>
      <Field label="Observações" htmlFor="po"><textarea id="po" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
    </div>
  );

  if (!id) return (
    <div>
      <p className="small"><Link to="/admin/trajes">← Trajes</Link></p><h1>Novo traje</h1>
      {act.error && <Alert>{act.error}</Alert>}{form}
      <div className="box"><h2>Tamanhos e estoque</h2><p className="small muted">Marque somente os tamanhos que este traje realmente possui, na escala PP → XXG.</p>
        <div className="table-wrap"><table><thead><tr><th>Tamanho</th><th>Possui?</th><th>Estoque total</th></tr></thead><tbody>
          {SIZES.map((s) => { const v = newSizes[s] ?? { on: false, stock: 1 }; return (<tr key={s}><td><strong>{s}</strong></td>
            <td><input type="checkbox" aria-label={`Possui tamanho ${s}`} checked={v.on} style={{ width: 20, height: 20 }} onChange={(e) => setNewSizes({ ...newSizes, [s]: { ...v, on: e.target.checked } })} /></td>
            <td><input type="number" min={0} aria-label={`Estoque ${s}`} disabled={!v.on} value={v.stock} style={{ width: 90, minHeight: 36 }} onChange={(e) => setNewSizes({ ...newSizes, [s]: { ...v, stock: Number(e.target.value) } })} /></td></tr>); })}
        </tbody></table></div></div>
      <button className="btn btn-primary" disabled={act.busy || f.name.trim().length < 3 || !SIZES.some((s) => newSizes[s]?.on)} onClick={create}>Criar traje</button>
      <p className="small muted" style={{ marginTop: '.6rem' }}>Depois de criar, você poderá enviar as fotos reais.</p>
    </div>
  );

  return (
    <div>
      <p className="small"><Link to="/admin/trajes">← Trajes</Link></p>
      <div className="page-head"><h1>{product.name}</h1>{product.status === 'ATIVO' && <a className="btn btn-ghost btn-sm" href={`/trajes/${product.slug}`} target="_blank" rel="noopener">Ver no site ↗</a>}</div>
      {act.error && <Alert>{act.error}</Alert>}{act.ok && <Alert kind="ok">{act.ok}</Alert>}
      {form}<button className="btn btn-primary" disabled={act.busy} onClick={save}>Salvar dados</button>

      <div className="box" style={{ marginTop: '1.4rem' }}>
        <h2>Tamanhos e estoque total</h2>
        <p className="small muted">Edite apenas o estoque total. Disponível, reservado, em uso e manutenção são calculados automaticamente.</p>
        <div className="table-wrap"><table><thead><tr><th>Tamanho</th><th>Estoque total</th><th></th></tr></thead><tbody>
          {product.sizes.map((s: SizeCode) => { const cur = totals[s] ?? 0; const val = edit[s] ?? cur; return (<tr key={s}><td><strong>{s}</strong></td>
            <td><input type="number" min={0} aria-label={`Estoque total ${s}`} value={val} style={{ width: 90, minHeight: 36 }} onChange={(e) => setEdit({ ...edit, [s]: Number(e.target.value) })} /></td>
            <td className="actions"><button className="btn btn-ghost btn-sm" disabled={act.busy || val === cur} onClick={() => act.run(async () => { await api.put(`/api/admin/products/${id}/sizes/${s}`, { stock: val }); setEdit((x) => { const n = { ...x }; delete n[s]; return n; }); reloadAll(); }, `Estoque ${s} atualizado.`)}>Salvar</button>
              <button className="btn btn-danger btn-sm" disabled={act.busy} onClick={() => confirm(`Remover o tamanho ${s}?`) && act.run(async () => { await api.del(`/api/admin/products/${id}/sizes/${s}`); reloadAll(); })}>Remover</button></td></tr>); })}
        </tbody></table></div>
        {missing.length > 0 && (<div className="toolbar" style={{ marginTop: '1rem' }}>
          <div className="field" style={{ margin: 0 }}><label htmlFor="as">Adicionar tamanho</label><select id="as" value={addSize.size} onChange={(e) => setAddSize({ ...addSize, size: e.target.value })}><option value="">Selecione…</option>{missing.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          <div className="field" style={{ margin: 0 }}><label htmlFor="asq">Estoque</label><input id="asq" type="number" min={0} value={addSize.stock} onChange={(e) => setAddSize({ ...addSize, stock: Number(e.target.value) })} style={{ width: 90 }} /></div>
          <button className="btn btn-primary btn-sm" disabled={!addSize.size || act.busy} onClick={() => act.run(async () => { await api.post(`/api/admin/products/${id}/sizes`, addSize); setAddSize({ size: '', stock: 1 }); reloadAll(); }, 'Tamanho adicionado.')}>Adicionar</button></div>)}
      </div>

      <div className="box">
        <h2>Fotos reais do traje</h2>
        <p className="small muted">Envie apenas fotos reais deste traje (JPG, PNG ou WebP, até 10 MB). A primeira foto é a principal. Sem foto, o site mostra um espaço neutro.</p>
        <div className="drop"><label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>Enviar fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label></div>
        {product.images.length === 0 ? <div style={{ maxWidth: 160 }}><Placeholder label="Sem fotos" /></div> : (
          <div className="img-grid">{product.images.map((im: any, i: number) => (
            <div key={im.id} className="img-tile">{im.isPrimary && <div className="primary">PRINCIPAL</div>}<div className="pic"><img src={im.path} alt={im.alt} /></div>
              <div className="ctl"><button onClick={() => move(i, -1)} disabled={i === 0} aria-label="Mover para trás">←</button><button onClick={() => move(i, 1)} disabled={i === product.images.length - 1} aria-label="Mover para frente">→</button>
                {!im.isPrimary && <button onClick={() => act.run(async () => { await api.put(`/api/admin/products/${id}/images/${im.id}/primary`); reloadAll(); })}>Principal</button>}
                <button onClick={() => confirm('Excluir esta foto?') && act.run(async () => { await api.del(`/api/admin/products/${id}/images/${im.id}`); reloadAll(); })}>Excluir</button></div></div>))}</div>)}
      </div>
    </div>
  );
}
