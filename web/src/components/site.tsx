import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Link, usePath } from '../lib/router.tsx';
import { useFetch } from '../lib/api.ts';
import { Diamond, InstagramIcon, TrajesIcon, WhatsAppIcon, CalendarIcon } from './ui.tsx';
import { phoneDisplay, waLink } from '../lib/format.ts';

export interface SiteSettings {
  business_name: string; instagram_url: string; whatsapp_number: string; address: string; opening_hours: string;
  hero_image: string; logo_image: string; policy_fitting: string; policy_pickup: string; policy_return: string;
  policy_reservation: string; policy_cancellation: string;
  _loaded?: boolean;   // false até as configurações chegarem (evita "piscar" entre Instagram e WhatsApp)
}
const empty: SiteSettings = { business_name: 'Trajeville', instagram_url: 'https://www.instagram.com/trajeville/', whatsapp_number: '', address: '', opening_hours: '',
  hero_image: '', logo_image: '', policy_fitting: '', policy_pickup: '', policy_return: '', policy_reservation: '', policy_cancellation: '' };
const Ctx = createContext<SiteSettings>(empty);
export const useSite = () => useContext(Ctx);

export function SiteProvider({ children }: { children: ReactNode }) {
  const { data } = useFetch<SiteSettings>('/api/public/settings');
  return <Ctx.Provider value={data ? { ...data, _loaded: true } : empty}>{children}</Ctx.Provider>;
}

export const Logo = ({ light }: { light?: boolean }) => {
  const s = useSite();
  return (
    <Link to="/" className="logo" aria-label="Trajeville — página inicial" style={light ? { color: '#fff' } : undefined}>
      {s.logo_image ? <img src={s.logo_image} alt="Trajeville" /> : (<><Diamond />Trajeville</>)}
    </Link>
  );
};

export function Header() {
  const s = useSite(); const path = usePath();
  const cur = (p: string) => (path === p || (p !== '/' && path.startsWith(p)) ? 'page' : undefined);
  const wa = s.whatsapp_number ? waLink(s.whatsapp_number) : null;
  return (
    <header className="site-header">
      <div className="container">
        <Logo />
        <nav className="nav" aria-label="Principal">
          <Link to="/trajes" aria-current={cur('/trajes')}>Trajes</Link>
          <Link to="/#como-funciona">Como funciona</Link>
          <Link to="/#faq">Dúvidas</Link>
          <Link to="/reservar" aria-current={cur('/reservar')}>Reservar</Link>
        </nav>
        {!s._loaded ? <span className="header-cta" aria-hidden="true" />
          : wa ? <a className="btn btn-primary btn-sm header-cta" href={wa} target="_blank" rel="noopener">WhatsApp</a>
          : <Link to="/reservar" className="btn btn-primary btn-sm header-cta">Fazer reserva</Link>}
        <a className="header-mobile-ig" href={s.instagram_url} target="_blank" rel="noopener">Instagram</a>
      </div>
    </header>
  );
}

export function BottomBar() {
  const s = useSite(); const path = usePath();
  useEffect(() => { document.body.classList.add('has-bar'); return () => document.body.classList.remove('has-bar'); }, []);
  return (
    <nav className="bottom-bar" aria-label="Atalhos">
      <Link to="/trajes" aria-current={path.startsWith('/trajes') ? 'page' : undefined}><TrajesIcon />Trajes</Link>
      <Link to="/reservar" className="accent" aria-current={path.startsWith('/reservar') ? 'page' : undefined}><CalendarIcon />Reservar</Link>
      {!s._loaded ? <span aria-hidden="true" />
        : s.whatsapp_number
          ? <a href={waLink(s.whatsapp_number)} target="_blank" rel="noopener"><WhatsAppIcon />WhatsApp</a>
          : <a href={s.instagram_url} target="_blank" rel="noopener"><InstagramIcon />Instagram</a>}
    </nav>
  );
}

export function Footer() {
  const s = useSite();
  return (
    <footer className="footer">
      <div className="container">
        <div className="cols">
          <div>
            <Logo light />
            <p style={{ marginTop: '1rem', maxWidth: '36ch' }}>Locação de trajes típicos alemães femininos e masculinos para Oktoberfest, festas e eventos em Joinville.</p>
          </div>
          <div>
            <h4>Navegue</h4>
            <p><Link to="/trajes">Trajes</Link><br /><Link to="/reservar">Fazer reserva</Link><br /><Link to="/#como-funciona">Como funciona</Link><br /><Link to="/#faq">Perguntas frequentes</Link></p>
          </div>
          <div>
            <h4>Contato</h4>
            <p>
              {s.whatsapp_number && <><a href={waLink(s.whatsapp_number)} target="_blank" rel="noopener">WhatsApp {phoneDisplay(s.whatsapp_number)}</a><br /></>}
              <a href={s.instagram_url} target="_blank" rel="noopener">Instagram @trajeville</a>
              {s.address && <><br />{s.address}</>}
              {s.opening_hours && <><br /><span style={{ whiteSpace: 'pre-line' }}>{s.opening_hours}</span></>}
            </p>
          </div>
        </div>
        <div className="legal">© {new Date().getFullYear()} Trajeville. Locação de trajes típicos alemães.</div>
      </div>
    </footer>
  );
}

export const PublicLayout = ({ children }: { children: ReactNode }) => (<><Header /><main id="conteudo">{children}</main><Footer /><BottomBar /></>);
