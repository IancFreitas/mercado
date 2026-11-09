/**
 * Aviso ao abrir o app (sem servidor). Preferência e data do último aviso ficam no kv local
 * (por aparelho, nunca sincronizados).
 */
import type { PantryDB } from '../db/db';
import type { Suggestion } from '../predict/suggestions';

export const PREFS_KEY = 'notify:prefs';
export const LAST_KEY = 'notify:last';
export const NOTIFY_TAG = 'smart-pantry-acabando';

export interface NotifyPrefs {
  enabled: boolean;
}

export const notifySupported = (): boolean => typeof Notification !== 'undefined';
export const notifyPermission = (): NotificationPermission | 'unsupported' => (notifySupported() ? Notification.permission : 'unsupported');

export async function getPrefs(db: Pick<PantryDB, 'getKV'>): Promise<NotifyPrefs> {
  const v = await db.getKV<NotifyPrefs>(PREFS_KEY);
  return { enabled: v?.enabled === true };
}

export async function setPrefs(db: Pick<PantryDB, 'setKV'>, prefs: NotifyPrefs): Promise<void> {
  await db.setKV(PREFS_KEY, prefs);
}

/** Dia local AAAA-MM-DD. */
export function dayKey(now: number): string {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function notificationText(names: string[]): { title: string; body: string } {
  const n = names.length;
  const shown = names.slice(0, 3).join(', ');
  const more = n > 3 ? ` e mais ${n - 3}` : '';
  return { title: 'Smart Pantry', body: `${n === 1 ? '1 item está acabando' : `${n} itens estão acabando`}: ${shown}${more}` };
}

async function show(title: string, body: string): Promise<void> {
  const opts = { body, tag: NOTIFY_TAG, icon: 'icon-192.png' } as NotificationOptions;
  try {
    const reg = typeof navigator !== 'undefined' && navigator.serviceWorker ? await navigator.serviceWorker.getRegistration() : undefined;
    if (reg && typeof reg.showNotification === 'function') {
      await reg.showNotification(title, opts);
      return;
    }
  } catch {
    /* cai no fallback */
  }
  new Notification(title, opts);
}

/** Mostra o aviso se: preferência ligada, permissão concedida, há itens e ainda não avisou hoje. */
export async function maybeNotifyOnOpen(db: Pick<PantryDB, 'getKV' | 'setKV'>, suggestions: Suggestion[], now = Date.now()): Promise<boolean> {
  try {
    if (!notifySupported() || Notification.permission !== 'granted') return false;
    if (suggestions.length === 0 || !(await getPrefs(db)).enabled) return false;
    const today = dayKey(now);
    if ((await db.getKV<string>(LAST_KEY)) === today) return false;
    const { title, body } = notificationText(suggestions.map((s) => s.product.name));
    await db.setKV(LAST_KEY, today); // grava antes: evita duplicar se abrir/voltar em paralelo
    await show(title, body);
    return true;
  } catch {
    return false;
  }
}
