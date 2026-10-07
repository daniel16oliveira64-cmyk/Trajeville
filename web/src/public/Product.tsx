import { useMemo, useState } from 'react';
import { Link, navigate, usePageMeta } from '../lib/router.tsx';
import { useFetch } from '../lib/api.ts';
import { Alert, Placeholder, Spinner } from '../components/ui.tsx';
import { categoryLabel } from '../lib/format.ts';
import { addDays, todayISO } from '../../../server/domain/dates.ts';
import type { PublicProduct } from './ProductCard.tsx';

const lines = (s: string) => s.split(/\n|;/).map((x) => x.trim()).filter(Boolean);

export function Product({ slug }: { slug: string }) {
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [size, setSize] = useState(''); const [img, setImg] = useState(0);
  const periodOk = from && to && to >= from;
  const { data: p, loading, error } = useFetch<PublicProduct>(`/api/public/products/${encodeURIComponent(slug)}${periodOk ? `?from=${from}&to=${to}` : ''}`);
  usePageMeta(p ? `Aluguel ${p.name} | Trajeville` : 'Traje | Trajeville', p?.description || undefined);
  const today = useMemo(() => todayISO(), []);

  if (loading && !p) return <Spinner />;
  if (error || !p) return (
    <div className="container" style={{ padding: '4rem 0', textAlign: 'center' }}>
      <h1>Traje não encontrado</h1><p className="muted">Este traje não está mais disponível no catálogo.</p><Link to="/trajes" className="btn btn-primary">Ver todos os trajes</Link>
    </div>
  );
  const images = p.images;
  const current = images[img] ?? images[0];
  const chosen = p.sizes.find((s) => s.size === size);
  const reserveUrl = `/reservar?traje=${p.slug}${size ? `&tamanho=${size}` : ''}${periodOk ? `&retirada=${from}&devolucao=${to}` : ''}`;
  const pieces = lines(p.includedPieces), acc = lines(p.accessories);

  return (
    <div className="container">
      <nav className="crumbs" aria-label="Você está em"><Link to="/">Início</Link> / <Link to="/trajes">Trajes</Link> / {p.name}</nav>
      <div className="product">
        <div>
          <div className="gallery-main">
            {p.isDemo && <span className="badge-demo">Demonstração</span>}
            {current ? <img src={current.path} alt={current.alt} /> : <Placeholder />}
          </div>
          {images.length > 1 && (
            <div className="thumbs" role="group" aria-label="Fotos do traje">
              {images.map((im, i) => (<button key={im.id} aria-current={i === img} aria-label={`Foto ${i + 1}`} onClick={() => setImg(i)}><img src={im.path} alt="" /></button>))}
            </div>
          )}
        </div>
        <div>
          <div className="eyebrow">{categoryLabel(p.category)}</div>
          <h1>{p.name}</h1>
          {p.description && <p style={{ fontSize: '1.05rem', whiteSpace: 'pre-line' }}>{p.description}</p>}

          <div className="panel" style={{ marginBlock: '1.4rem' }}>
            <h3 style={{ fontSize: '1.05rem' }}>Consulte a disponibilidade</h3>
            <div className="row two">
              <div className="field"><label htmlFor="d1">Retirada</label><input id="d1" type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (to && e.target.value > to) setTo(''); }} /></div>
              <div className="field"><label htmlFor="d2">Devolução</label><input id="d2" type="date" min={from || today} value={to} onChange={(e) => setTo(e.target.value)} /></div>
            </div>
            <div className="label" style={{ marginBottom: '.5rem' }}>Tamanho</div>
            <div className="size-picker" role="group" aria-label="Escolha o tamanho">
              {p.sizes.map((s) => (
                <button key={s.size} className="size-btn" aria-pressed={size === s.size} disabled={!s.inStock || (periodOk && s.available === 0)} onClick={() => setSize(s.size)}>
                  {s.size}{periodOk && s.available !== undefined ? <small>{s.available} disp.</small> : null}
                </button>
              ))}
            </div>
            {!periodOk && <p className="small muted" style={{ marginTop: '.8rem' }}>Informe retirada e devolução para ver a quantidade disponível em cada tamanho.</p>}
            {periodOk && chosen && chosen.available !== undefined && <p className="small" style={{ marginTop: '.8rem' }}><strong>{chosen.available}</strong> unidade(s) no tamanho {chosen.size} para este período.</p>}
            {periodOk && !loading && p.sizes.every((s) => s.available === 0) && <Alert kind="warn">Não há quantidade suficiente disponível para este período.</Alert>}
            <button className="btn btn-primary btn-block" style={{ marginTop: '1rem' }} onClick={() => navigate(reserveUrl)}>Reservar este traje</button>
          </div>

          {pieces.length > 0 && (<><h3>Peças incluídas</h3><ul className="listing">{pieces.map((x) => <li key={x}>{x}</li>)}</ul></>)}
          {acc.length > 0 && (<><h3>Acessórios</h3><ul className="listing">{acc.map((x) => <li key={x}>{x}</li>)}</ul></>)}
          <h3>Informações importantes</h3>
          <ul className="listing">
            <li>Trabalhamos com locação: o traje é seu da retirada até a devolução.</li>
            <li>A prova é presencial e, se necessário, fazemos ajustes antes da retirada.</li>
            <li>Tamanhos deste traje: {p.sizes.map((s) => s.size).join(', ')}.</li>
            {p.notes && <li style={{ whiteSpace: 'pre-line' }}>{p.notes}</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
