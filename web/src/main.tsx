import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { matchPath, usePath } from './lib/router.tsx';
import { PublicLayout, SiteProvider } from './components/site.tsx';
import { Home } from './public/Home.tsx';
import { Catalog } from './public/Catalog.tsx';
import { Product } from './public/Product.tsx';
import { Reserve, ReserveSent } from './public/Reserve.tsx';
import { AdminApp } from './admin/AdminApp.tsx';
import { Link } from './lib/router.tsx';

function NotFound() {
  return (<div className="container" style={{ padding: '5rem 0', textAlign: 'center' }}><h1>Página não encontrada</h1><p className="muted">O endereço que você acessou não existe.</p><Link to="/" className="btn btn-primary">Ir para o início</Link></div>);
}

function App() {
  const path = usePath();
  useEffect(() => { document.body.classList.toggle('is-admin', path.startsWith('/admin')); }, [path]);
  if (path.startsWith('/admin')) return <AdminApp />;
  let m: Record<string, string> | null; let page: React.ReactNode;
  if (path === '/') page = <Home />;
  else if (path.replace(/\/$/, '') === '/trajes') page = <Catalog />;
  else if ((m = matchPath('/trajes/:slug', path))) page = <Product key={m.slug} slug={m.slug!} />;
  else if (path.replace(/\/$/, '') === '/reservar') page = <Reserve />;
  else if (path.replace(/\/$/, '') === '/reservar/enviada') page = <ReserveSent />;
  else page = <NotFound />;
  return <SiteProvider><PublicLayout>{page}</PublicLayout></SiteProvider>;
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
