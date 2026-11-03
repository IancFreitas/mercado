import { useEffect, useState } from 'react';

export type Tab = 'inicio' | 'lista' | 'despensa' | 'casa';
export interface Route {
  tab: Tab;
  params: URLSearchParams;
}

const TABS: Tab[] = ['inicio', 'lista', 'despensa', 'casa'];

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = h.split('?');
  const tab = (TABS as string[]).includes(path) ? (path as Tab) : 'inicio';
  return { tab, params: new URLSearchParams(query) };
}

export function navigate(tab: Tab): void {
  window.location.hash = `#/${tab}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
