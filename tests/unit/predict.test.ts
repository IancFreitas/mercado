/**
 * Fase 3: previsão de consumo (funções puras) e sugestões de reposição (ações com fake-indexeddb).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PantryDB } from '../../src/db/db';
import { PantryRepo } from '../../src/db/repo';
import { SyncEngine } from '../../src/sync/engine';
import { MemorySyncServer } from '../../src/sync/memoryServer';
import { PantryService } from '../../src/pantry/pantry';
import { forecastConsumption, type MovementLike } from '../../src/predict/consumption';
import {
  addSuggestion,
  computeSuggestions,
  loadSuggestions,
  setPredictionEnabled,
  snoozeSuggestion,
} from '../../src/predict/suggestions';
import type { InventoryMovement, Product, ShoppingListItem } from '../../src/domain/types';

const D0 = Date.parse('2026-10-01T15:00:00Z');
const day = (n: number) => new Date(D0 + n * 86_400_000).toISOString();
const buy = (n: number, qty: number): MovementLike => ({ kind: 'compra', delta: qty, at: day(n) });
const NOW = (n: number) => D0 + n * 86_400_000;

describe('forecastConsumption', () => {
  it('padrão regular: 12 L a cada 20 dias → 0,6 L/dia e data de esgotamento correta', () => {
    const f = forecastConsumption([buy(0, 12), buy(20, 12), buy(40, 12)], NOW(45), { unit: 'l' });
    expect(f.status).toBe('ok');
    expect(f.ratePerDay).toBeCloseTo(0.6, 3);
    expect(f.typicalQty).toBe(12);
    expect(f.typicalIntervalDays).toBe(20);
    expect(f.depletionDate).toBe(day(60));
    expect(f.daysLeft).toBeCloseTo(15, 0);
    expect(f.stockEstimate).toBeCloseTo(9, 1);
    expect(f.confidence).toBe('media');
    expect(f.explanation).toContain('12 L a cada ~20 dias (0,6 L/dia)');
    expect(f.explanation).toContain('Última compra em 10/11');
    expect(f.explanation).toContain('deve acabar por volta de 30/11');
    expect(f.explanation).toContain('Confiança média (3 compras)');
  });

  it('sem compras → sem_dados; 1 compra → poucos_dados, sem data', () => {
    expect(forecastConsumption([], NOW(1)).status).toBe('sem_dados');
    const f = forecastConsumption([buy(0, 5)], NOW(10));
    expect(f.status).toBe('poucos_dados');
    expect(f.depletionDate).toBeUndefined();
    expect(f.ratePerDay).toBeUndefined();
    expect(f.explanation).toMatch(/Poucos dados/);
  });

  it('compras no mesmo dia somam (intervalo < 1 dia é ignorado)', () => {
    const f = forecastConsumption([buy(0, 6), { kind: 'compra', delta: 6, at: day(0.1) }, buy(20, 12)], NOW(21));
    expect(f.status).toBe('ok');
    expect(f.ratePerDay).toBeCloseTo(0.6, 3);
  });

  it('compra extraordinária é descartada e citada', () => {
    const f = forecastConsumption([buy(0, 4), buy(10, 4), buy(20, 4), buy(30, 40), buy(40, 4)], NOW(41), { unit: 'un' });
    expect(f.typicalQty).toBe(4);
    expect(f.ratePerDay).toBeCloseTo(0.4, 3);
    expect(f.explanation).toMatch(/Ignorei a compra de 40 un/);
  });

  it('taxa atípica (3x) é descartada', () => {
    // intervalos 10,10,2 (taxa 2/dia vs 0,4) → o último período é atípico... aqui 4 compras
    const f = forecastConsumption([buy(0, 4), buy(10, 4), buy(20, 4), buy(22, 4), buy(32, 4)], NOW(33));
    expect(f.ratePerDay).toBeCloseTo(0.4, 3);
    expect(f.explanation).toMatch(/atípico/);
  });

  it('mudança de padrão: as 2 últimas taxas priorizadas', () => {
    // 4 intervalos de 20 dias (0,6) e depois 2 de 10 dias (1,2)
    const buys = [0, 20, 40, 60, 80, 90, 100].map((d) => buy(d, 12));
    const f = forecastConsumption(buys, NOW(101));
    expect(f.ratePerDay).toBeCloseTo(1.2, 3);
    expect(f.explanation).toMatch(/mudou/);
  });

  it('esgotado é observação direta (vale com 1 compra só)', () => {
    const ms: MovementLike[] = [buy(0, 10), { kind: 'esgotado', delta: -10, at: day(10) }];
    const f = forecastConsumption(ms, NOW(12));
    expect(f.status).toBe('ok');
    expect(f.ratePerDay).toBeCloseTo(1, 3);
    expect(f.confidence).toBe('baixa');
    expect(f.stockEstimate).toBe(0);
    expect(f.daysLeft).toBe(0);
  });

  it('consumo registrado entre compras define a taxa e o estoque usa o registro', () => {
    const ms: MovementLike[] = [
      buy(0, 10),
      { kind: 'consumo', delta: -2, at: day(5) },
      { kind: 'consumo', delta: -2, at: day(10) },
      buy(20, 10),
      { kind: 'consumo', delta: -3, at: day(24) },
    ];
    const f = forecastConsumption(ms, NOW(26));
    expect(f.ratePerDay).toBeCloseTo(0.2, 3); // 4 usados em 20 dias
    // estoque após registro: 10 + (10-4 sobra=6)... piso/soma = 13; menos 0,2 × 2 dias
    expect(f.stockEstimate).toBeCloseTo(13 - 0.4, 2);
    expect(f.confidence).toBe('baixa');
  });

  it('"ainda tem" após a data prevista empurra a previsão e é explicado', () => {
    const base = [buy(0, 12), buy(20, 12), buy(40, 12)];
    const ms: MovementLike[] = [...base, { kind: 'ainda_tem', delta: 0, at: day(62) }];
    const f = forecastConsumption(ms, NOW(63), { unit: 'l' });
    const t = Date.parse(day(62));
    expect(Date.parse(f.depletionDate!)).toBeGreaterThanOrEqual(t);
    expect(Date.parse(f.depletionDate!)).toBeCloseTo(t + 5 * 86_400_000, -5);
    expect(f.stockEstimate!).toBeGreaterThan(0);
    expect(f.explanation).toContain('Você informou que ainda tinha em 02/12');
    // sem o "ainda tem", já teria acabado
    expect(forecastConsumption(base, NOW(63)).daysLeft).toBe(0);
  });

  it('confiança: baixa (1 amostra), média (2-3), alta (≥4 com CV baixo e consumo registrado)', () => {
    expect(forecastConsumption([buy(0, 12), buy(20, 12)], NOW(21)).confidence).toBe('baixa');
    expect(forecastConsumption([buy(0, 12), buy(20, 12), buy(40, 12)], NOW(41)).confidence).toBe('media');
    const withUse = (extra: MovementLike[]) => [0, 20, 40, 60, 80].flatMap((d) => [buy(d, 12), ...extra.map((e) => ({ ...e, at: day(d + 5) }))]);
    // sem registro algum: no máximo média
    expect(forecastConsumption([0, 20, 40, 60, 80].map((d) => buy(d, 12)), NOW(81)).confidence).toBe('media');
    // com consumo registrado
    const hi = forecastConsumption(withUse([{ kind: 'consumo', delta: -12, at: '' }]), NOW(81));
    expect(hi.confidence).toBe('alta');
    // variável demais → média
    const wobbly = [0, 5, 30, 35, 70, 75, 125].map((d) => buy(d, 10));
    expect(forecastConsumption(wobbly, NOW(126)).confidence).not.toBe('alta');
  });

  it('datas no fuso de São Paulo (compra às 22:30 do dia 1 em BRT)', () => {
    const ms: MovementLike[] = [
      { kind: 'compra', delta: 10, at: '2026-11-02T01:30:00Z' }, // 01/11 22:30 BRT
      { kind: 'compra', delta: 10, at: '2026-11-22T01:30:00Z' },
    ];
    const f = forecastConsumption(ms, Date.parse('2026-11-23T12:00:00Z'));
    expect(f.explanation).toContain('Última compra em 21/11');
    expect(f.explanation).toContain('deve acabar por volta de 11/12');
  });
});

// ---------- sugestões ----------
const HID = 'h1';
const mkProduct = (id: string, name: string, extra: Partial<Product> = {}): Product =>
  ({ id, householdId: HID, name, category: 'Laticínios', unit: 'l', predictionEnabled: true, deleted: false, _v: {}, ...extra }) as Product;
const mkMov = (productId: string, m: MovementLike): InventoryMovement =>
  ({ id: `${productId}-${m.at}-${m.kind}`, householdId: HID, productId, unit: 'l', by: 't', deleted: false, _v: {}, ...m }) as InventoryMovement;
const buys = (pid: string, days: number[], qty = 12) => days.map((d) => mkMov(pid, buy(d, qty)));
const mkItem = (name: string, extra: Partial<ShoppingListItem> = {}): ShoppingListItem =>
  ({ id: name, householdId: HID, name, normName: name.toLowerCase(), checked: false, deleted: false, _v: {}, ...extra }) as ShoppingListItem;

describe('computeSuggestions', () => {
  const leite = mkProduct('p1', 'Leite');
  const arroz = mkProduct('p2', 'Arroz', { unit: 'kg' });
  const movs = [...buys('p1', [0, 20, 40]), ...buys('p2', [-30, 10, 50], 5)];
  const run = (over: Partial<Parameters<typeof computeSuggestions>[0]> = {}) =>
    computeSuggestions({ householdId: HID, products: [leite, arroz], movements: movs, listItems: [], now: NOW(55), ...over });

  it('sugere o que acaba em até 7 dias, ordenado por daysLeft, com a quantidade típica', () => {
    // leite acaba no dia 60 (5 dias); arroz no dia 90 (35 dias)
    const r = run();
    expect(r.map((s) => s.product.name)).toEqual(['Leite']);
    expect(r[0]!.quantity).toBe(12);
    expect(r[0]!.unit).toBe('l');
    const both = run({ now: NOW(85) });
    expect(both.map((s) => s.product.name)).toEqual(['Leite', 'Arroz']); // leite já passou (0), arroz em 5
    expect(both[0]!.forecast.daysLeft).toBe(0);
  });
  it('não sugere se adiado, desativado, já na lista (id ou nome) ou de outra Casa', () => {
    expect(run({ products: [{ ...leite, snoozedUntil: new Date(NOW(60)).toISOString() }, arroz] })).toHaveLength(0);
    expect(run({ products: [{ ...leite, snoozedUntil: new Date(NOW(50)).toISOString() }, arroz] })).toHaveLength(1); // adiamento vencido
    expect(run({ products: [{ ...leite, predictionEnabled: false, predictionSetByUser: true }, arroz] })).toHaveLength(0);
    expect(run({ products: [{ ...leite, predictionEnabled: false }, arroz] })).toHaveLength(1); // legado: só padrão
    expect(run({ listItems: [mkItem('Leite integral', { productId: 'p1' })] })).toHaveLength(0);
    expect(run({ listItems: [mkItem('leite')] })).toHaveLength(0);
    expect(run({ listItems: [mkItem('leite', { deleted: true })] })).toHaveLength(1);
    expect(run({ products: [{ ...leite, householdId: 'outra' }, arroz] })).toHaveLength(0);
  });
  it('poucos dados não gera sugestão', () => {
    expect(run({ movements: buys('p1', [0]) })).toHaveLength(0);
  });
});

// ---------- ações (Dexie) ----------
let dbN = 0;
let clock = Date.parse('2026-12-01T00:00:00Z');
async function device(server: MemorySyncServer, userId: string, name: string) {
  const db = new PantryDB(`predict-${++dbN}-${name}`);
  const engine = await SyncEngine.create(db, `pdev${dbN}${name}`, { transport: server.transportFor(userId), now: () => clock });
  const repo = new PantryRepo(engine, () => name, () => new Date(++clock).toISOString());
  return { db, engine, repo, svc: new PantryService(repo) };
}

describe('ações de sugestão', () => {
  let server: MemorySyncServer;
  let d: Awaited<ReturnType<typeof device>>;
  let hid: string;
  let pid: string;
  const T = Date.parse('2026-12-01T12:00:00Z');

  async function seed(x: typeof d, h: string, productId: string) {
    await x.engine.mutate(h, 'products', productId, { name: 'Leite', category: 'Laticínios', unit: 'l', predictionEnabled: true, deleted: false });
    let i = 0;
    for (const dd of [-60, -40, -20]) {
      await x.engine.mutate(h, 'inventoryMovements', `0000000${++i}-0000-4000-8000-000000000000`, {
        productId,
        kind: 'compra',
        delta: 12,
        unit: 'l',
        at: new Date(T + dd * 86_400_000).toISOString(),
        by: 'nota',
        deleted: false,
      });
    }
  }

  beforeEach(async () => {
    server = new MemorySyncServer();
    d = await device(server, 'u1', 'Ana');
    hid = (await d.repo.createHousehold('Casa', '11111111-1111-4111-8111-111111111111')).household.id;
    pid = '22222222-2222-4222-8222-222222222222';
    await seed(d, hid, pid);
  });

  it('Adicionar: item com source sugestao, categoria e quantidade típicas; segunda vez não duplica', async () => {
    const [s] = await loadSuggestions(d.repo, hid, T);
    expect(s!.product.id).toBe(pid);
    expect((await addSuggestion(d.repo, hid, pid, s!.quantity)).added).toBe(true);
    expect((await addSuggestion(d.repo, hid, pid, s!.quantity)).added).toBe(false);
    const list = (await d.repo.getDefaultList(hid))!;
    const items = await d.repo.listItems(hid, list.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'sugestao', category: 'Laticínios', quantity: 12, unit: 'l', productId: pid });
    expect(await loadSuggestions(d.repo, hid, T)).toHaveLength(0); // já na lista
  });

  it('Adiar 7 dias esconde e volta depois; Não sugerir mais desativa e é reversível', async () => {
    await snoozeSuggestion(d.repo, hid, pid, 7, T);
    expect(await loadSuggestions(d.repo, hid, T + 86_400_000)).toHaveLength(0);
    expect(await loadSuggestions(d.repo, hid, T + 8 * 86_400_000)).toHaveLength(1);
    await setPredictionEnabled(d.repo, hid, pid, false);
    expect(await loadSuggestions(d.repo, hid, T + 8 * 86_400_000)).toHaveLength(0);
    await setPredictionEnabled(d.repo, hid, pid, true);
    expect(await loadSuggestions(d.repo, hid, T + 8 * 86_400_000)).toHaveLength(1);
  });

  it('produto de outra Casa é recusado', async () => {
    await expect(snoozeSuggestion(d.repo, 'outra-casa', pid)).rejects.toThrow(/não encontrado/);
    await expect(setPredictionEnabled(d.repo, 'outra-casa', pid, false)).rejects.toThrow(/não encontrado/);
  });

});

describe('sugestões em dois aparelhos', () => {
  it('adiar e desativar ao mesmo tempo (offline) convergem sem perder nenhum dos campos', async () => {
    const server = new MemorySyncServer(() => clock);
    const ian = await device(server, 'user-ian', 'Ian');
    const fer = await device(server, 'user-fer', 'Fernanda');
    const hid = (await ian.repo.createHousehold('Casa')).household.id;
    server.createHousehold('user-ian', hid);
    await ian.engine.sync(hid);
    server.createInvite('user-ian', hid, 'CODE-9');
    server.acceptInvite('user-fer', 'CODE-9');
    await fer.engine.sync(hid);
    const pid = '33333333-3333-4333-8333-333333333333';
    await ian.engine.mutate(hid, 'products', pid, { name: 'Leite', category: 'Laticínios', unit: 'l', predictionEnabled: true, deleted: false });
    for (const x of [ian, fer]) await x.engine.sync(hid);
    for (const x of [ian, fer]) await x.engine.sync(hid);

    ian.engine.setTransport(null);
    fer.engine.setTransport(null);
    await snoozeSuggestion(ian.repo, hid, pid, 7, Date.parse('2026-12-01T00:00:00Z'));
    await setPredictionEnabled(fer.repo, hid, pid, false);
    await snoozeSuggestion(fer.repo, hid, pid, 14, Date.parse('2026-12-01T00:00:00Z'));
    ian.engine.setTransport(server.transportFor('user-ian'));
    fer.engine.setTransport(server.transportFor('user-fer'));
    for (let i = 0; i < 3; i++) {
      await ian.engine.sync(hid);
      await fer.engine.sync(hid);
    }
    const a = (await ian.db.products.get(pid))!;
    const b = (await fer.db.products.get(pid))!;
    expect(a.snoozedUntil).toBe(b.snoozedUntil);
    expect(a.snoozedUntil).toBeTruthy(); // um dos adiamentos venceu (LWW), nunca vazio
    expect([a.predictionEnabled, a.predictionSetByUser]).toEqual([false, true]);
    expect([b.predictionEnabled, b.predictionSetByUser]).toEqual([false, true]);
    expect(a.name).toBe('Leite');
  });
});
