import { useLiveQuery } from 'dexie-react-hooks';
import { useApp } from '../app/AppContext';

const EMPTY = new Map<string, string>();

/** Nomes de loja da Casa, por CNPJ (reativo). */
export function useStoreNames(): Map<string, string> {
  const { s, session } = useApp();
  const hid = session.householdId!;
  return useLiveQuery(() => s.repo.storeNamesByCnpj(hid), [hid], EMPTY);
}
