/**
 * Inicialização do app: banco, identidade do aparelho, motor de sync,
 * configuração do backend e laço de sincronização.
 */
import { PantryDB } from '../db/db';
import { PantryRepo } from '../db/repo';
import { SyncEngine } from '../sync/engine';
import { SupabaseBackend, validateConfig, type SupabaseConfig } from '../sync/supabase';

export interface Session {
  householdId: string | null;
  listId: string | null;
  displayName: string;
  /** Casa registrada no servidor (compartilhamento ativo). */
  householdConnected: boolean;
}

export interface Services {
  db: PantryDB;
  engine: SyncEngine;
  repo: PantryRepo;
  deviceId: string;
  backend: SupabaseBackend | null;
  config: SupabaseConfig | null;
  session: Session;
}

const SESSION_KEY = 'session';
const CONFIG_KEY = 'supabase:config';

function newDeviceId(): string {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 20);
}

export async function loadConfig(db: PantryDB): Promise<SupabaseConfig | null> {
  const fromEnv = validateConfig({
    url: import.meta.env.VITE_SUPABASE_URL as string | undefined,
    anonKey: import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined,
  });
  if (fromEnv) return fromEnv;
  return validateConfig((await db.getKV<SupabaseConfig>(CONFIG_KEY)) ?? {});
}

export async function saveConfig(db: PantryDB, cfg: SupabaseConfig | null): Promise<void> {
  if (cfg) await db.setKV(CONFIG_KEY, cfg);
  else await db.kv.delete(CONFIG_KEY);
}

export async function saveSession(db: PantryDB, s: Session): Promise<void> {
  await db.setKV(SESSION_KEY, s);
}

export async function bootstrap(): Promise<Services> {
  const db = new PantryDB();
  await db.open();
  // Pede armazenamento persistente (reduz risco de o iOS apagar dados por falta de espaço).
  try {
    await navigator.storage?.persist?.();
  } catch {
    /* sem suporte */
  }
  let deviceId = await db.getKV<string>('deviceId');
  if (!deviceId) {
    deviceId = newDeviceId();
    await db.setKV('deviceId', deviceId);
  }
  const session: Session = (await db.getKV<Session>(SESSION_KEY)) ?? {
    householdId: null,
    listId: null,
    displayName: '',
    householdConnected: false,
  };
  const config = await loadConfig(db);
  const backend = config ? new SupabaseBackend(config) : null;
  const engine = await SyncEngine.create(db, deviceId);
  const services: Services = {
    db,
    engine,
    deviceId,
    backend,
    config,
    session,
    repo: new PantryRepo(engine, () => services.session.displayName || 'Eu'),
  };
  await refreshTransport(services);
  return services;
}

/** Ativa o transporte somente se houver backend, usuário autenticado e Casa conectada. */
export async function refreshTransport(s: Services): Promise<void> {
  if (s.backend && s.session.householdConnected && (await s.backend.currentUser())) {
    s.engine.setTransport(s.backend.transport());
  } else {
    s.engine.setTransport(null);
  }
}

/** Laço de sincronização: ao abrir, ao voltar ao app, ao reconectar, periodicamente e após alterações. */
export function startSyncLoop(s: Services): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopWatch: (() => void) | null = null;
  const run = () => {
    const hid = s.session.householdId;
    if (!hid || !s.engine.hasTransport()) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      s.engine.status = 'offline';
      return;
    }
    void s.engine.sync(hid);
  };
  const soon = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(run, 600);
  };
  const onVisible = () => document.visibilityState === 'visible' && run();
  window.addEventListener('online', run);
  window.addEventListener('focus', run);
  document.addEventListener('visibilitychange', onVisible);
  const interval = setInterval(() => document.visibilityState === 'visible' && run(), 20_000);
  // Alterações locais disparam envio rápido.
  let lastPending = -1;
  const unsub = s.engine.subscribe(async () => {
    const hid = s.session.householdId;
    if (!hid) return;
    const p = await s.engine.pendingCount(hid);
    if (p > 0 && p !== lastPending && s.engine.status !== 'syncing') soon();
    lastPending = p;
  });
  const watch = () => {
    stopWatch?.();
    stopWatch = null;
    if (s.backend && s.session.householdId && s.session.householdConnected) {
      stopWatch = s.backend.watch(s.session.householdId, soon);
    }
  };
  watch();
  run();
  return () => {
    window.removeEventListener('online', run);
    window.removeEventListener('focus', run);
    document.removeEventListener('visibilitychange', onVisible);
    clearInterval(interval);
    unsub();
    stopWatch?.();
    if (timer) clearTimeout(timer);
  };
}
