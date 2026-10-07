import { Link } from '../lib/router.tsx';
import { Placeholder, SizeChips } from '../components/ui.tsx';
import { categoryLabel } from '../lib/format.ts';

export interface PublicProduct {
  id: number; slug: string; name: string; category: 'FEMININO' | 'MASCULINO'; description: string; includedPieces: string;
  accessories: string; notes: string; isDemo: boolean; primaryImage: string | null;
  images: Array<{ id: number; path: string; alt: string }>;
  sizes: Array<{ size: string; inStock: boolean; available?: number }>;
}

export function ProductCard({ p }: { p: PublicProduct }) {
  const anyStock = p.sizes.some((s) => s.inStock);
  return (
    <article className="card fade-in">
      <Link to={`/trajes/${p.slug}`} className="media" aria-label={`Ver ${p.name}`}>
        {p.isDemo && <span className="badge-demo">Demonstração</span>}
        {p.primaryImage ? <img src={p.primaryImage} alt={p.name} loading="lazy" /> : <Placeholder />}
      </Link>
      <div className="info">
        <span className="cat">{categoryLabel(p.category)}</span>
        <h3><Link to={`/trajes/${p.slug}`}>{p.name}</Link></h3>
        <SizeChips sizes={p.sizes} />
        <span className={`avail ${anyStock ? '' : 'none'}`}>{anyStock ? 'Disponível para locação' : 'Sem estoque no momento'}</span>
        <div className="btns">
          <Link to={`/trajes/${p.slug}`} className="btn btn-ghost">Ver traje</Link>
          <Link to={`/reservar?traje=${p.slug}`} className="btn btn-primary">Reservar</Link>
        </div>
      </div>
    </article>
  );
}
