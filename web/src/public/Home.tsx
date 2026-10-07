import { Link, usePageMeta } from '../lib/router.tsx';
import { useFetch } from '../lib/api.ts';
import { useSite } from '../components/site.tsx';
import { Diamond, Placeholder, Spinner } from '../components/ui.tsx';
import { ProductCard, type PublicProduct } from './ProductCard.tsx';
import { categoryPlural } from '../lib/format.ts';

const STEPS: Array<[string, string]> = [
  ['Escolha seu traje', 'Navegue pelo catálogo feminino e masculino.'],
  ['Confira tamanho e disponibilidade', 'Veja os tamanhos de cada traje e as datas livres.'],
  ['Envie sua solicitação', 'Informe evento, retirada e devolução.'],
  ['Aguarde confirmação', 'A Trajeville analisa e confirma sua reserva.'],
  ['Faça a prova', 'Experimente o traje presencialmente na loja.'],
  ['Faça ajustes se necessário', 'Ajustamos o traje antes da retirada.'],
  ['Retire seu traje', 'Na data combinada, pronto para o evento.'],
  ['Viva o evento', 'Aproveite a festa com o traje certo.'],
  ['Devolva o traje', 'Na data de devolução informada.'],
];

export function Home() {
  usePageMeta('Aluguel de traje alemão em Joinville | Oktoberfest | Trajeville', 'Aluguel de trajes típicos alemães femininos e masculinos para Oktoberfest, festas e eventos em Joinville.');
  const s = useSite();
  const products = useFetch<PublicProduct[]>('/api/public/products');
  const faqs = useFetch<Array<{ id: number; question: string; answer: string }>>('/api/public/faqs');
  const gallery = useFetch<Array<{ id: number; path: string; caption: string }>>('/api/public/gallery');
  const list = products.data ?? [];
  const catPhoto = (cat: string) => list.find((p) => p.category === cat && p.primaryImage && !p.isDemo)?.primaryImage ?? null;
  const policies = [['Prova', s.policy_fitting], ['Retirada', s.policy_pickup], ['Devolução', s.policy_return], ['Reservas', s.policy_reservation], ['Cancelamento', s.policy_cancellation]].filter(([, v]) => v);

  return (
    <>
      <section className={`hero ${s.hero_image ? 'has-photo' : ''}`} style={s.hero_image ? { backgroundImage: `url(${s.hero_image})` } : undefined}>
        <div className="container">
          <div className="brand-line"><Diamond />Trajeville</div>
          <h1>Seu traje típico para viver a festa do jeito certo.</h1>
          <p className="lead">Escolha seu traje, consulte a disponibilidade, faça sua solicitação e venha realizar a prova na Trajeville.</p>
          <div className="actions">
            <Link to="/trajes" className="btn btn-gold">Ver trajes</Link>
            <Link to="/reservar" className="btn btn-ghost-light">Fazer reserva</Link>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="cats">
        <div className="container">
          <div className="section-head"><div className="eyebrow">Coleção</div><h2 id="cats">Trajes para cada estilo</h2></div>
          <div className="cat-grid">
            {(['FEMININO', 'MASCULINO'] as const).map((c) => {
              const img = catPhoto(c);
              return (
                <Link key={c} to={`/trajes?categoria=${c.toLowerCase()}`} className={`cat-tile ${img ? '' : 'no-photo'} ${c === 'MASCULINO' ? 'masc' : ''}`}>
                  {img && <img src={img} alt="" loading="lazy" />}
                  <div className="body"><h3>{categoryPlural(c).toUpperCase()}</h3><span className="go">Ver coleção →</span></div>
                </Link>
              );
            })}
          </div>
        </div>
      </section>

      <section className="section alt" aria-labelledby="destaques">
        <div className="container">
          <div className="section-head"><div className="eyebrow">Catálogo</div><h2 id="destaques">Trajes disponíveis</h2><p>Cada traje mostra apenas os tamanhos que realmente temos.</p></div>
          {products.loading ? <Spinner /> : list.length === 0 ? <p className="muted">Em breve novos trajes no catálogo.</p> : (
            <div className="grid-products">{list.slice(0, 4).map((p) => <ProductCard key={p.id} p={p} />)}</div>
          )}
          {list.length > 4 && <p className="center" style={{ marginTop: '2rem' }}><Link to="/trajes" className="btn btn-ghost">Ver todos os trajes</Link></p>}
        </div>
      </section>

      <section className="section" id="como-funciona" aria-labelledby="como">
        <div className="container">
          <div className="section-head"><div className="eyebrow">Passo a passo</div><h2 id="como">Como funciona</h2><p>Da escolha à devolução, acompanhamos você em cada etapa.</p></div>
          <ol className="steps">{STEPS.map(([t, d]) => <li key={t}><strong>{t}</strong><span>{d}</span></li>)}</ol>
        </div>
      </section>

      <section className="section dark" aria-labelledby="prova">
        <div className="container split">
          <div>
            <div className="eyebrow">Atendimento presencial</div>
            <h2 id="prova">Prova e ajustes na Trajeville</h2>
            <p>A Trajeville trabalha com <strong>locação</strong> e atendimento presencial. Você pode experimentar o traje, e quando necessário os ajustes são realizados antes da retirada.</p>
            <p>Por isso o site é o primeiro passo: aqui você escolhe, consulta a disponibilidade e solicita. O traje certo, no seu corpo, a gente resolve juntos na loja.</p>
          </div>
          <div className="callout">Não é uma compra online de roupa. É uma experiência de locação, com prova, ajuste e cuidado em cada detalhe.</div>
        </div>
      </section>

      {gallery.data && gallery.data.length > 0 && (
        <section className="section" id="galeria" aria-labelledby="gal">
          <div className="container">
            <div className="section-head"><div className="eyebrow">Galeria</div><h2 id="gal">Trajeville em detalhes</h2></div>
            <div className="gallery">{gallery.data.map((g) => (<figure key={g.id}><img src={g.path} alt={g.caption || 'Foto da Trajeville'} loading="lazy" />{g.caption && <figcaption>{g.caption}</figcaption>}</figure>))}</div>
          </div>
        </section>
      )}

      <section className="section alt" id="faq" aria-labelledby="duvidas">
        <div className="container" style={{ maxWidth: 860 }}>
          <div className="section-head"><div className="eyebrow">FAQ</div><h2 id="duvidas">Perguntas frequentes</h2></div>
          <div className="faq">{(faqs.data ?? []).map((f) => (<details key={f.id}><summary>{f.question}</summary><div className="ans">{f.answer}</div></details>))}</div>
          {policies.length > 0 && (
            <div className="box" style={{ marginTop: '2rem' }}><h3>Informações importantes</h3>
              {policies.map(([k, v]) => <p key={k}><strong>{k}:</strong> <span style={{ whiteSpace: 'pre-line' }}>{v}</span></p>)}
            </div>
          )}
        </div>
      </section>

      <section className="section" style={{ textAlign: 'center' }}>
        <div className="container" style={{ maxWidth: 640 }}>
          <h2>Pronto para a festa?</h2>
          <p className="muted">Consulte a disponibilidade para a data do seu evento.</p>
          <Link to="/reservar" className="btn btn-primary">Fazer reserva</Link>
        </div>
      </section>
    </>
  );
}
