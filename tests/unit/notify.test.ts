import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { updateAppBadge } from '../../src/notify/badge';
import { dayKey, getPrefs, LAST_KEY, maybeNotifyOnOpen, notificationText, NOTIFY_TAG, setPrefs } from '../../src/notify/notify';
import { computeSuggestions } from '../../src/predict/suggestions';
import type { Suggestion } from '../../src/predict/suggestions';
import type { InventoryMovement, Product } from '../../src/domain/types';

function fakeDb() {
  const m = new Map<string, unknown>();
  return { getKV: async <T>(k: string) => m.get(k) as T | undefined, setKV: async (k: string, v: unknown) => void m.set(k, v) };
}
const sug = (...names: string[]) => names.map((name) => ({ product: { name } }) as unknown as Suggestion);

describe('selo', () => {
  it('count>0 usa setAppBadge; 0 usa clearAppBadge; sem API é silencioso', async () => {
    const setAppBadge = vi.fn(async () => {});
    const clearAppBadge = vi.fn(async () => {});
    expect(await updateAppBadge(3, { setAppBadge, clearAppBadge })).toBe(true);
    expect(setAppBadge).toHaveBeenCalledWith(3);
    await updateAppBadge(0, { setAppBadge, clearAppBadge });
    expect(clearAppBadge).toHaveBeenCalled();
    expect(await updateAppBadge(2, {})).toBe(false);
    expect(await updateAppBadge(2, undefined)).toBe(false);
    expect(await updateAppBadge(1, { setAppBadge: async () => { throw new Error('x'); } })).toBe(false);
  });

  it('contagem = sugestões ativas (esgotado ou <=7 dias; fora lista/adiado/desligado)', () => {
    const NOW = Date.parse('2026-10-01T12:00:00Z');
    const day = (n: number) => new Date(NOW + n * 86_400_000).toISOString();
    const mk = (id: string, extra: Partial<Product> = {}) => ({ id, householdId: 'h', name: id, unit: 'un', deleted: false, ...extra }) as unknown as Product;
    const mv = (pid: string, i: number, at: string, delta: number) => ({ id: `${pid}${i}`, householdId: 'h', productId: pid, kind: delta > 0 ? 'compra' : 'consumo', delta, unit: 'un', at, deleted: false }) as unknown as InventoryMovement;
    const buys = (pid: string) => [mv(pid, 1, day(-60), 10), mv(pid, 2, day(-40), 10), mv(pid, 3, day(-20), 10)];
    const products = [mk('a'), mk('b', { snoozedUntil: day(3) }), mk('c', { predictionSetByUser: true, predictionEnabled: false }), mk('d')];
    const movements = ['a', 'b', 'c', 'd'].flatMap(buys);
    const listItems = [{ productId: 'd', normName: 'd', deleted: false }] as never;
    const r = computeSuggestions({ householdId: 'h', products, movements, listItems, now: NOW });
    expect(r.map((s) => s.product.id)).toEqual(['a']);
  });
});

describe('aviso ao abrir', () => {
  const NOW = Date.parse('2026-10-05T10:00:00');
  let shown: { title: string; opts: { tag?: string; body?: string } }[];
  beforeEach(() => {
    shown = [];
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'granted' }));
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: async () => ({ showNotification: async (title: string, opts: object) => void shown.push({ title, opts }) }) } });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('texto lista até 3 nomes', () => {
    expect(notificationText(['A', 'B', 'C']).body).toBe('3 itens estão acabando: A, B, C');
    expect(notificationText(['A', 'B', 'C', 'D', 'E']).body).toBe('5 itens estão acabando: A, B, C e mais 2');
  });

  it('avisa uma vez por dia, com tag fixa; de novo no dia seguinte', async () => {
    const db = fakeDb();
    await setPrefs(db, { enabled: true });
    expect(await maybeNotifyOnOpen(db, sug('Leite', 'Arroz'), NOW)).toBe(true);
    expect(shown[0]!.opts.tag).toBe(NOTIFY_TAG);
    expect(shown[0]!.opts.body).toBe('2 itens estão acabando: Leite, Arroz');
    expect(await db.getKV(LAST_KEY)).toBe(dayKey(NOW));
    expect(await maybeNotifyOnOpen(db, sug('Leite'), NOW + 3600_000)).toBe(false);
    expect(await maybeNotifyOnOpen(db, sug('Leite'), NOW + 86_400_000)).toBe(true);
    expect(shown).toHaveLength(2);
  });

  it('preferência desligada, sem permissão ou sem itens: não avisa', async () => {
    const db = fakeDb();
    expect((await getPrefs(db)).enabled).toBe(false);
    expect(await maybeNotifyOnOpen(db, sug('A'), NOW)).toBe(false);
    await setPrefs(db, { enabled: true });
    expect(await maybeNotifyOnOpen(db, [], NOW)).toBe(false);
    vi.stubGlobal('Notification', Object.assign(function () {}, { permission: 'default' }));
    expect(await maybeNotifyOnOpen(db, sug('A'), NOW)).toBe(false);
    expect(shown).toHaveLength(0);
  });

  it('sem Notification/navigator: silencioso', async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('Notification', undefined);
    const db = fakeDb();
    await setPrefs(db, { enabled: true });
    expect(await maybeNotifyOnOpen(db, sug('A'), NOW)).toBe(false);
  });
});
