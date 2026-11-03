import { useEffect, useState } from 'react';

export type Tab = 'inicio' | 'lista' | 'despensa' | 'casa';
export interface Route {
  tab: Tab;
  params: URLSearchParams;
  /** Incrementa a cada navegação — permite tratar o mesmo deep link mais de uma vez. */
  seq: number;
}

const TABS: Tab[] = ['inicio', 'lista', 'despensa', 'casa'];

export function parseHash(hash: string): Route {
  const h = hash.replace(/^#\/?/, '');
  const [path = '', query = ''] = h.split('?');
  const tab = (TABS as string[]).includes(path) ? (path as Tab) : 'inicio';
  return { tab, params: new URLSearchParams(query), seq: 0 };
}

export function navigate(tab: Tab): void {
  window.location.hash = `#/${tab}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => setRoute((prev) => ({ ...parseHash(window.location.hash), seq: prev.seq + 1 }));
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
