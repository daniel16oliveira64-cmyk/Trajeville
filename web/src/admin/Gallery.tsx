import { usePageMeta } from '../lib/router.tsx';
import { api, useFetch } from '../lib/api.ts';
import { Alert, Spinner } from '../components/ui.tsx';
import { useAction } from './shared.tsx';

export function GalleryPage() {
  usePageMeta('Galeria — Painel Trajeville');
  const { data, loading, error, reload } = useFetch<any[]>('/api/admin/gallery');
  const settings = useFetch<any>('/api/admin/settings');
  const act = useAction();
  const upload = async (files: FileList | null) => { if (!files) return; await act.run(async () => { for (const f of Array.from(files)) await api.upload('/api/admin/gallery', f); reload(); }, 'Fotos enviadas.'); };
  const hero = settings.data?.hero_image;
  return (
    <div>
      <div className="page-head"><h1>Galeria</h1></div>
      <p className="muted small" style={{ maxWidth: 720 }}>Use somente fotos reais da Trajeville: trajes, detalhes, clientes usando os trajes, ambiente, eventos e acessórios. Enquanto não houver fotos, a seção da galeria não aparece no site.</p>
      {act.error && <Alert>{act.error}</Alert>}{act.ok && <Alert kind="ok">{act.ok}</Alert>}
      <div className="drop"><label className="btn btn-primary btn-sm" style={{ cursor: 'pointer' }}>Enviar fotos<input type="file" accept="image/jpeg,image/png,image/webp" multiple hidden onChange={(e) => { upload(e.target.files); e.target.value = ''; }} /></label></div>
      {loading && !data ? <Spinner /> : error ? <Alert>{error.message}</Alert> : (
        <div className="img-grid">{data!.map((g) => (
          <div key={g.id} className="img-tile">{hero === g.path && <div className="primary">FOTO DO TOPO</div>}<div className="pic"><img src={g.path} alt={g.caption} /></div>
            <div className="small" style={{ padding: '.3rem .5rem' }}>{g.caption || <span className="muted">Sem legenda</span>}</div>
            <div className="ctl">
              <button onClick={() => { const c = prompt('Legenda da foto:', g.caption); if (c !== null) act.run(async () => { await api.put(`/api/admin/gallery/${g.id}`, { caption: c }); reload(); }); }}>Legenda</button>
              <button onClick={() => act.run(async () => { await api.put('/api/admin/settings', { hero_image: hero === g.path ? '' : g.path }); settings.reload(); }, hero === g.path ? 'Foto do topo removida.' : 'Foto definida no topo do site.')}>{hero === g.path ? 'Tirar do topo' : 'Usar no topo'}</button>
              <button onClick={() => confirm('Excluir esta foto?') && act.run(async () => { await api.del(`/api/admin/gallery/${g.id}`); reload(); settings.reload(); })}>Excluir</button></div></div>))}
          {data!.length === 0 && <p className="muted">Nenhuma foto na galeria.</p>}</div>)}
    </div>
  );
}
