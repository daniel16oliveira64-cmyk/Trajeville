import { useEffect, useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from 'react';

const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
window.addEventListener('popstate', notify);

export function navigate(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  opts.replace ? history.replaceState(null, '', to) : history.pushState(null, '', to);
  notify();
  const hash = to.includes('#') ? to.split('#')[1] : '';
  if (hash) setTimeout(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }), 80);
  else window.scrollTo(0, 0);
}
const subscribe = (f: () => void) => { subs.add(f); return () => subs.delete(f); };
export const usePath = () => useSyncExternalStore(subscribe, () => location.pathname);
export const useSearch = () => useSyncExternalStore(subscribe, () => location.search);

/** "/trajes/:slug" → { slug } | null */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  const m = re.exec(path);
  return m ? Object.fromEntries(keys.map((k, i) => [k, decodeURIComponent(m[i + 1]!)])) : null;
}

export function Link({ to, onClick, ...rest }: { to: string } & AnchorHTMLAttributes<HTMLAnchorElement>) {
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || rest.target === '_blank') return;
    e.preventDefault(); navigate(to);
  };
  return <a href={to} onClick={handle} {...rest} />;
}

/** Atualiza título/descrição ao navegar (o servidor já entrega os valores corretos no primeiro carregamento). */
export function usePageMeta(title: string, description?: string) {
  useEffect(() => {
    document.title = title;
    if (description) document.querySelector('meta[name="description"]')?.setAttribute('content', description);
  }, [title, description]);
}
