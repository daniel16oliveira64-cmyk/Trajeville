import { useEffect, type ReactNode } from 'react';
import { SIZES, STATUS_LABEL, type Status } from '../../../server/domain/constants.ts';
import { statusTone } from '../lib/format.ts';

export const Diamond = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M10 1.5 18.5 10 10 18.5 1.5 10z" /></svg>
);
export const WhatsAppIcon = () => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 1.8a8.2 8.2 0 1 1-4.2 15.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 0 1 12 3.8Zm-3 3.9c-.2 0-.5 0-.7.3-.3.3-.9.9-.9 2.1s.9 2.4 1 2.6c.2.2 1.8 2.8 4.4 3.8 2.2.8 2.6.7 3.1.6.5 0 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2l-.5-.3-1.7-.8c-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1-.8-.4-1.6-.8-2.4-1.6-.6-.6-1-1.3-1.2-1.6-.1-.2 0-.3.1-.5l.4-.5.2-.4v-.4l-.8-1.9c-.2-.5-.4-.4-.6-.4Z" /></svg>
);
export const InstagramIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.4" cy="6.6" r=".8" fill="currentColor" /></svg>
);
export const HangerIcon = () => (
  <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true"><path d="M16 9a3 3 0 1 1 3 3c-1.6 0-3 .9-3 2.4V16M16 16 3.5 24.5a1.2 1.2 0 0 0 .7 2.2h23.6a1.2 1.2 0 0 0 .7-2.2z" /></svg>
);
export const TrajesIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3c0 1.7-1.8 3-4 3S8 4.7 8 3Z" /></svg>);
export const CalendarIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>);
export const CheckIcon = () => (<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>);

export const Spinner = ({ label = 'Carregando…' }: { label?: string }) => (<div className="loading" role="status"><div className="spinner" />{label}</div>);
export const Alert = ({ kind = 'error', children }: { kind?: 'error' | 'ok' | 'info' | 'warn'; children: ReactNode }) => (<div className={`alert ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>{children}</div>);

/** Espaço neutro quando NÃO há foto real. Nunca usamos foto genérica como se fosse o produto. */
export const Placeholder = ({ label = 'Foto em breve' }: { label?: string }) => (<div className="ph" aria-label={label}><HangerIcon />{label}</div>);

export function SizeChips({ sizes }: { sizes: Array<{ size: string; inStock?: boolean }> }) {
  const ordered = [...sizes].sort((a, b) => SIZES.indexOf(a.size as any) - SIZES.indexOf(b.size as any));
  return (<div className="sizes" aria-label="Tamanhos">{ordered.map((s) => (<span key={s.size} className={`chip ${s.inStock === false ? 'off' : ''}`}>{s.size}</span>))}</div>);
}

export const StatusBadge = ({ status, overdue }: { status: Status; overdue?: boolean }) => (
  <>
    <span className={`badge ${statusTone(status)}`}>{STATUS_LABEL[status]}</span>{overdue && <> <span className="badge overdue">Devolução atrasada</span></>}
  </>
);

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="page-head" style={{ marginBottom: '.6rem' }}><h2 style={{ margin: 0 }}>{title}</h2><button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar">Fechar</button></div>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, hint, children, htmlFor }: { label: string; hint?: string; children: ReactNode; htmlFor?: string }) => (
  <div className="field"><label htmlFor={htmlFor}>{label}</label>{children}{hint && <span className="hint">{hint}</span>}</div>
);
