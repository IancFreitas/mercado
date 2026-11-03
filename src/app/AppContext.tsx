import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { saveSession, startSyncLoop, refreshTransport, type Services, type Session } from './services';

interface Ctx {
  s: Services;
  session: Session;
  updateSession: (patch: Partial<Session>) => Promise<void>;
  toast: (msg: string) => void;
  toastMsg: string | null;
  syncTick: number;
  online: boolean;
  restartSync: () => Promise<void>;
}

const AppCtx = createContext<Ctx | null>(null);

export function AppProvider({ services, children }: { services: Services; children: ReactNode }) {
  const [session, setSession] = useState<Session>(services.session);
  const [toastMsg, setToast] = useState<string | null>(null);
  const [syncTick, setTick] = useState(0);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [loopKey, setLoopKey] = useState(0);

  useEffect(() => services.engine.subscribe(() => setTick((t) => t + 1)), [services]);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  useEffect(() => startSyncLoop(services), [services, loopKey, session.householdId, session.householdConnected]);

  const updateSession = useCallback(
    async (patch: Partial<Session>) => {
      services.session = { ...services.session, ...patch };
      await saveSession(services.db, services.session);
      setSession(services.session);
    },
    [services],
  );

  const toast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((m) => (m === msg ? null : m)), 2600);
  }, []);

  const restartSync = useCallback(async () => {
    await refreshTransport(services);
    setLoopKey((k) => k + 1);
  }, [services]);

  return (
    <AppCtx.Provider value={{ s: services, session, updateSession, toast, toastMsg, syncTick, online, restartSync }}>
      {children}
    </AppCtx.Provider>
  );
}

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error('AppProvider ausente');
  return c;
}
