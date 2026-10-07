import type { DB } from '../db/connection.ts';
import { getProductBySlug, listProducts } from '../services/catalog.ts';
import { getSetting } from '../services/settings.ts';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);

export interface Meta { title: string; description: string; canonical: string; image?: string; noindex?: boolean; jsonLd?: object[]; status?: number }

export function metaFor(db: DB, pathname: string, origin: string): Meta {
  const name = getSetting(db, 'business_name') || 'Trajeville';
  const abs = (p: string) => (p.startsWith('http') ? p : origin + p);
  const instagram = getSetting(db, 'instagram_url');
  const address = getSetting(db, 'address');
  const base = { canonical: origin + (pathname === '/' ? '/' : pathname.replace(/\/$/, '')) };

  if (pathname.startsWith('/admin')) return { ...base, title: `Painel — ${name}`, description: 'Painel administrativo.', noindex: true };

  if (pathname === '/') {
    const business: Record<string, unknown> = {
      '@context': 'https://schema.org', '@type': 'ClothingStore', name, url: origin + '/',
      description: 'Aluguel de trajes típicos alemães para Oktoberfest, festas alemãs e eventos em Joinville.',
      areaServed: 'Joinville, SC', sameAs: instagram ? [instagram] : undefined,
    };
    if (address) business.address = { '@type': 'PostalAddress', streetAddress: address, addressLocality: 'Joinville', addressRegion: 'SC', addressCountry: 'BR' };
    return { ...base, title: `Aluguel de traje alemão em Joinville | Oktoberfest | ${name}`,
      description: 'Aluguel de trajes típicos alemães femininos e masculinos para Oktoberfest, festas e eventos em Joinville. Escolha, consulte a disponibilidade, faça a prova e retire na Trajeville.',
      jsonLd: [business] };
  }
  if (pathname === '/trajes')
    return { ...base, title: `Trajes típicos alemães para alugar — feminino e masculino | ${name}`,
      description: 'Veja os trajes alemães femininos e masculinos disponíveis para locação na Trajeville, em Joinville. Tamanhos PP a XXG.' };
  if (pathname === '/reservar')
    return { ...base, title: `Reservar traje alemão | ${name}`, description: 'Envie sua solicitação de locação de traje alemão: escolha o traje, o tamanho e as datas e consulte a disponibilidade.' };

  if (pathname === '/reservar/enviada')
    return { ...base, title: `Solicitação enviada | ${name}`, description: 'Solicitação de locação enviada.', noindex: true };

  const m = pathname.match(/^\/trajes\/([a-z0-9-]+)\/?$/);
  if (m) {
    const p = getProductBySlug(db, m[1]!);
    if (!p || p.status !== 'ATIVO') return { ...base, title: `Traje não encontrado | ${name}`, description: 'Traje não encontrado.', noindex: true, status: 404 };
    const cat = p.category === 'FEMININO' ? 'feminino' : 'masculino';
    const desc = clip(p.description || `Aluguel do ${p.name.toLowerCase()}, traje alemão ${cat}, na Trajeville em Joinville. Tamanhos: ${p.sizes.join(', ')}.`, 158);
    const image = p.primaryImage ? abs(p.primaryImage) : undefined;
    return { ...base, title: `Aluguel ${p.name} — traje alemão ${cat} | ${name}`, description: desc, image,
      noindex: p.isDemo,   // dados de demonstração nunca devem ser indexados
      jsonLd: [{ '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: desc, image: image ? [image] : undefined, brand: { '@type': 'Brand', name } }] };
  }
  return { ...base, title: `Página não encontrada | ${name}`, description: 'Página não encontrada.', noindex: true, status: pathname.startsWith('/reserva') ? 200 : 404 };
}

export function renderHead(m: Meta): string {
  const t = [
    `<title>${esc(m.title)}</title>`, `<meta name="description" content="${esc(m.description)}">`,
    `<link rel="canonical" href="${esc(m.canonical)}">`,
    m.noindex ? '<meta name="robots" content="noindex,nofollow">' : '<meta name="robots" content="index,follow">',
    '<meta property="og:type" content="website">', `<meta property="og:site_name" content="Trajeville">`,
    '<meta property="og:locale" content="pt_BR">', `<meta property="og:title" content="${esc(m.title)}">`,
    `<meta property="og:description" content="${esc(m.description)}">`, `<meta property="og:url" content="${esc(m.canonical)}">`,
    m.image ? `<meta property="og:image" content="${esc(m.image)}">` : '',
    `<meta name="twitter:card" content="${m.image ? 'summary_large_image' : 'summary'}">`,
  ];
  for (const j of m.jsonLd ?? []) t.push(`<script type="application/ld+json">${JSON.stringify(j).replace(/</g, '\\u003c')}</script>`);
  return t.filter(Boolean).join('\n    ');
}

export function sitemap(db: DB, origin: string): string {
  const urls = ['/', '/trajes', '/reservar', ...listProducts(db, { onlyActive: true }).filter((p) => !p.isDemo).map((p) => `/trajes/${p.slug}`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${origin}${u}</loc></url>`).join('\n')}\n</urlset>\n`;
}
export const robots = (origin: string) => `User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: ${origin}/sitemap.xml\n`;
