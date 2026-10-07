import { useCallback, useEffect, useState } from 'react';

export class ApiError extends Error {
  constructor(public status: number, message: string, public code?: string, public details?: any) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown, raw?: { file: Blob }): Promise<T> {
  const headers: Record<string, string> = {};
  let payload: BodyInit | undefined;
  if (path.startsWith('/api/admin')) headers['X-Requested-With'] = 'trajeville';
  if (raw) payload = raw.file;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res: Response;
  try { res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' }); }
  catch { throw new ApiError(0, 'Sem conexão com o servidor. Verifique sua internet e tente novamente.', 'NETWORK'); }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = new ApiError(res.status, data?.error?.message ?? 'Algo deu errado. Tente novamente.', data?.error?.code, data?.error?.details);
    if (res.status === 401 && path.startsWith('/api/admin') && path !== '/api/admin/login') window.dispatchEvent(new Event('tjv-unauth'));
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T = any>(p: string) => request<T>('GET', p),
  post: <T = any>(p: string, b?: unknown) => request<T>('POST', p, b ?? {}),
  put: <T = any>(p: string, b?: unknown) => request<T>('PUT', p, b ?? {}),
  del: <T = any>(p: string) => request<T>('DELETE', p),
  upload: <T = any>(p: string, file: File) => request<T>('POST', p, undefined, { file }),
};

/** Carrega dados de um GET e permite recarregar. */
export function useFetch<T = any>(path: string | null) {
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true, error: null }));
    api.get<T>(path).then((data) => alive && setState({ data, error: null, loading: false }))
      .catch((error) => alive && setState({ data: null, error, loading: false }));
    return () => { alive = false; };
  }, [path, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}
