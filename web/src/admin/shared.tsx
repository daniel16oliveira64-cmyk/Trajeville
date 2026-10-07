import { createContext, useContext, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api.ts';

export interface AdminUser { id: number; name: string; email: string; role: 'ADMIN' | 'STAFF' }
export const AdminCtx = createContext<{ user: AdminUser; refresh: () => void }>(null as any);
export const useAdmin = () => useContext(AdminCtx);

/** Executa uma ação do painel mostrando erro/ocupado de forma consistente. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setBusy(true); setError(null); setOk(null);
    try { const r = await fn(); if (success) setOk(success); return r; }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Erro inesperado.'); }
    finally { setBusy(false); }
  };
  return { run, busy, error, ok, clear: () => { setError(null); setOk(null); } };
}

export const Money = ({ children }: { children: ReactNode }) => <>{children}</>;
export const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
