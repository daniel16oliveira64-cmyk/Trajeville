import { Link, navigate, usePageMeta, useSearch } from '../lib/router.tsx';
import { useFetch } from '../lib/api.ts';
import { Spinner, Alert } from '../components/ui.tsx';
import { ProductCard, type PublicProduct } from './ProductCard.tsx';

/** Arquitetura de filtros: cada filtro é uma função pura. Futuros (tamanho, cor, estilo, ocasião, disponibilidade) entram aqui. */
interface Filter { id: string; label: string; test: (p: PublicProduct) => boolean }
const CATEGORY_FILTERS: Filter[] = [
  { id: 'todos', label: 'Todos', test: () => true },
  { id: 'feminino', label: 'Feminino', test: (p) => p.category === 'FEMININO' },
  { id: 'masculino', label: 'Masculino', test: (p) => p.category === 'MASCULINO' },
];

export function Catalog() {
  usePageMeta('Trajes típicos alemães para alugar — feminino e masculino | Trajeville', 'Veja os trajes alemães femininos e masculinos disponíveis para locação na Trajeville, em Joinville. Tamanhos PP a XXG.');
  const { data, loading, error } = useFetch<PublicProduct[]>('/api/public/products');
  const categoria = new URLSearchParams(useSearch()).get('categoria');   // hook chamado UMA vez, fora de qualquer callback
  const active = CATEGORY_FILTERS.find((f) => f.id === categoria) ?? CATEGORY_FILTERS[0]!;
  const shown = (data ?? []).filter(active.test);
  return (
    <div className="container" style={{ paddingBlock: '2.5rem 4rem' }}>
      <div className="section-head"><div className="eyebrow">Catálogo</div><h1 style={{ fontSize: 'clamp(2rem,5vw,3rem)' }}>Trajes para alugar</h1>
        <p>Escolha o traje, confira os tamanhos e envie sua solicitação.</p></div>
      <div className="sizes" role="group" aria-label="Filtrar por categoria" style={{ marginBottom: '2rem', gap: '.5rem' }}>
        {CATEGORY_FILTERS.map((f) => (
          <button key={f.id} className={`btn btn-sm ${f.id === active.id ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={f.id === active.id}
            onClick={() => navigate(f.id === 'todos' ? '/trajes' : `/trajes?categoria=${f.id}`)}>{f.label}</button>
        ))}
      </div>
      {loading && <Spinner />}
      {error && <Alert>{error.message}</Alert>}
      {!loading && !error && shown.length === 0 && <div className="panel"><p>Nenhum traje encontrado nesta categoria por enquanto.</p><Link to="/trajes" className="btn btn-ghost btn-sm">Ver todos</Link></div>}
      <div className="grid-products">{shown.map((p) => <ProductCard key={p.id} p={p} />)}</div>
    </div>
  );
}
