import { useEffect } from 'react';
import { useApp } from '../app/AppContext';
import { loadSuggestions, type Suggestion } from '../predict/suggestions';
import { useSuggestions } from '../ui/ListScreen';
import { updateAppBadge } from './badge';
import { maybeNotifyOnOpen } from './notify';

/** Selo = nº de sugestões ativas; atualiza ao mudar, ao abrir e ao voltar ao primeiro plano. Chamar uma vez (App). */
export function useReplenishmentBadge(): void {
  const { s, session } = useApp();
  const hid = session.householdId!;
  const live = useSuggestions();
  useEffect(() => {
    void updateAppBadge(live.length);
  }, [live.length]);

  useEffect(() => {
    let off = false;
    const refresh = async () => {
      let list: Suggestion[];
      try {
        list = await loadSuggestions(s.repo, hid);
      } catch {
        return;
      }
      if (off) return;
      void updateAppBadge(list.length);
      void maybeNotifyOnOpen(s.db, list);
    };
    void refresh();
    const onVis = () => document.visibilityState === 'visible' && void refresh();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      off = true;
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [s, hid]);
}
