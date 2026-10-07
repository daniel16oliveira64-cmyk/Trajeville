import { useCallback, useEffect, useState } from 'react';
import { Link, matchPath, navigate, usePageMeta, usePath } from '../lib/router.tsx';
import { api, ApiError, useFetch } from '../lib/api.ts';
import { Alert, Diamond, Field, Spinner } from '../components/ui.tsx';
import { AdminCtx, useAction, type AdminUser } from './shared.tsx';
import { Dashboard } from './Dashboard.tsx';
import { ReservationList, ReservationDetail } from './Reservations.tsx';
import { CalendarPage } from './CalendarPage.tsx';
import { ProductList, ProductEdit } from './Products.tsx';
import { StockPage } from './Stock.tsx';
import { CustomersPage } from './Customers.tsx';
import { MaintenancePage } from './Maintenance.tsx';
import { GalleryPage } from './Gallery.tsx';
import { FaqPage } from './Faqs.tsx';
import { SettingsPage } from './Settings.tsx';

function Login({ onDone }: { onDone: () => void }) {
  usePageMeta('Painel — Trajeville');
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const { run, busy, error } = useAction();
  const submit = async (e: React.FormEvent) => { e.preventDefault(); const r = await run(() => api.post('/api/admin/login', { email, password })); if (r) onDone(); };
  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="logo" style={{ marginBottom: '1.5rem' }}><Diamond />Trajeville</div>
        <h1 style={{ fontSize: '1.5rem' }}>Painel administrativo</h1>
        {error && <Alert>{error}</Alert>}
        <Field label="E-mail" htmlFor="le"><input id="le" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
        <Field label="Senha" htmlFor="lp"><input id="lp" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></Field>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Entrando…' : 'Entrar'}</button>
      </form>
    </div>
  );
}

const NAV: Array<[string, string, string?]> = [
  ['/admin', 'Início'], ['/admin/reservas', 'Reservas', 'pending'], ['/admin/calendario', 'Calendário'], ['/admin/trajes', 'Trajes'],
  ['/admin/estoque', 'Estoque'], ['/admin/manutencao', 'Manutenção', 'maint'], ['/admin/clientes', 'Clientes'], ['/admin/galeria', 'Galeria'],
  ['/admin/faq', 'FAQ'], ['/admin/configuracoes', 'Configurações'],
];

export function AdminApp() {
  const [user, setUser] = useState<AdminUser | null | undefined>(undefined);
  const path = usePath();
  const load = useCallback(() => { api.get<{ user: AdminUser }>('/api/admin/me').then((r) => setUser(r.user)).catch(() => setUser(null)); }, []);
  useEffect(load, [load]);
  useEffect(() => { const f = () => setUser(null); window.addEventListener('tjv-unauth', f); return () => window.removeEventListener('tjv-unauth', f); }, []);
  useEffect(() => { const m = document.createElement('meta'); m.name = 'robots'; m.content = 'noindex,nofollow'; document.head.appendChild(m); return () => m.remove(); }, []);

  if (user === undefined) return <Spinner />;
  if (user === null) return <Login onDone={load} />;
  return <AdminCtx.Provider value={{ user, refresh: load }}><Shell user={user} path={path} /></AdminCtx.Provider>;
}

function Shell({ user, path }: { user: AdminUser; path: string }) {
  const dash = useFetch<any>('/api/admin/dashboard');
  const counts: Record<string, number> = { pending: dash.data?.pending ?? 0, maint: dash.data?.maintenanceUnits ?? 0 };
  const logout = async () => { await api.post('/api/admin/logout').catch(() => {}); window.dispatchEvent(new Event('tjv-unauth')); navigate('/admin'); };
  const cur = (p: string) => (p === '/admin' ? path === '/admin' : path.startsWith(p) ? 'page' : undefined);

  let page: React.ReactNode; let m: Record<string, string> | null;
  if (path === '/admin' || path === '/admin/') page = <Dashboard />;
  else if ((m = matchPath('/admin/reservas/:id', path))) page = <ReservationDetail id={Number(m.id)} />;
  else if (path.startsWith('/admin/reservas')) page = <ReservationList />;
  else if (path.startsWith('/admin/calendario')) page = <CalendarPage />;
  else if ((m = matchPath('/admin/trajes/:id', path))) page = <ProductEdit id={m.id === 'novo' ? null : Number(m.id)} />;
  else if (path.startsWith('/admin/trajes')) page = <ProductList />;
  else if (path.startsWith('/admin/estoque')) page = <StockPage />;
  else if (path.startsWith('/admin/manutencao')) page = <MaintenancePage />;
  else if (path.startsWith('/admin/clientes')) page = <CustomersPage />;
  else if (path.startsWith('/admin/galeria')) page = <GalleryPage />;
  else if (path.startsWith('/admin/faq')) page = <FaqPage />;
  else if (path.startsWith('/admin/configuracoes')) page = <SettingsPage />;
  else page = <div><h1>Página não encontrada</h1><Link to="/admin">Voltar ao início</Link></div>;

  return (
    <div className="admin">
      <aside className="admin-side">
        <Link to="/admin" className="logo"><Diamond />Trajeville</Link>
        <nav className="admin-nav" aria-label="Painel">
          {NAV.map(([to, label, key]) => (
            <Link key={to} to={to} aria-current={cur(to) ? 'page' : undefined}>{label}{key && counts[key]! > 0 && <span className="count">{counts[key]}</span>}</Link>
          ))}
        </nav>
        <div className="admin-user"><div>{user.name}</div><div className="small" style={{ opacity: .6 }}>{user.role === 'ADMIN' ? 'Administrador' : 'Equipe'}</div>
          <p style={{ marginTop: '.7rem' }}><a href="/" target="_blank" rel="noopener" style={{ color: 'var(--gold-soft)' }}>Ver site ↗</a><br /><button onClick={logout} style={{ background: 'none', border: 0, color: '#fff', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}>Sair</button></p></div>
      </aside>
      <main className="admin-main">{page}</main>
    </div>
  );
}
