/**
 * Despensa: estoque = soma de movimentos append-only; idempotência da compra;
 * consumo concorrente em 2 aparelhos; isolamento por Casa.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PantryDB } from '../../src/db/db';
import { PantryRepo, purchaseIdFor, purchaseItemIdFor } from '../../src/db/repo';
import { SyncEngine } from '../../src/sync/engine';
import { MemorySyncServer } from '../../src/sync/memoryServer';
import { PantryService, computeStock, productIdFor, round3, splitStock, stockOf, titleCase } from '../../src/pantry/pantry';
import { byCategory, inMonth, loadCategoryLines } from '../../src/spending/spending';
import type { Unit } from '../../src/domain/types';

let dbCounter = 0;
let clock = Date.parse("2026-11-01T00:00:00Z");
const now = () => clock;

async function device(server: MemorySyncServer, userId: string, name: string, connected = true) {
  const db = new PantryDB(`pantry-${++dbCounter}-${name}`);
  const engine = await SyncEngine.create(db, `dev${dbCounter}${name}`, { transport: connected ? server.transportFor(userId) : null, now });
  const repo = new PantryRepo(engine, () => name, () => new Date(++clock).toISOString());
  return { db, engine, repo, svc: new PantryService(repo), userId };
}
type Dev = Awaited<ReturnType<typeof device>>;

const KEY = '35260911222333000181650060000123459123456781';
interface Line {
  desc: string;
  qty: number;
  unit?: Unit;
}

/** Nota 'importada' com itens (ids determinísticos, como a importação real). */
async function seedPurchase(d: Dev, hid: string, lines: Line[], key = KEY) {
  const pid = await purchaseIdFor(hid, key);
  await d.engine.mutate(hid, 'purchases', pid, {
    accessKey: key,
    purchasedAt: '2026-09-19T21:15:34.000Z',
    totalCents: 10000,
    source: 'nfce_qr',
    status: 'importada',
    issuerCnpj: '11222333000181',
    deleted: false,
  });
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    await d.engine.mutate(hid, 'purchaseItems', await purchaseItemIdFor(hid, pid, i), {
      purchaseId: pid,
      rawDescription: l.desc,
      quantity: l.qty,
      unit: l.unit ?? 'un',
      unitPriceCents: 500,
      totalCents: Math.round(500 * l.qty),
      position: i,
      deleted: false,
    });
  }
  return pid;
}

describe('funções puras', () => {
  it('stockOf soma sem ruído de ponto flutuante', () => {
    expect(stockOf([{ delta: 0.1 }, { delta: 0.2 }])).toBe(0.3);
    expect(stockOf([{ delta: 1.5 }, { delta: -0.25 }])).toBe(1.25);
    expect(stockOf([{ delta: 3 }, { delta: -1, deleted: true }])).toBe(3);
    expect(round3(1.23456)).toBe(1.235);
    // piso em zero, em ordem (at, id)
    expect(stockOf([{ delta: 5, at: '1' }, { delta: -5, at: '2' }, { delta: -5, at: '3' }, { delta: 2, at: '4' }])).toBe(2);
  });
  it('titleCase deixa nomes legíveis', () => {
    expect(titleCase('ARROZ TIO JOAO 5KG')).toBe('Arroz Tio Joao 5KG');
    expect(titleCase('LEITE DE VACA INTEG')).toBe('Leite de Vaca Integ');
  });
});

describe('Despensa (um aparelho)', () => {
  let server: MemorySyncServer;
  let d: Dev;
  let hid: string;
  beforeEach(async () => {
    server = new MemorySyncServer(now);
    d = await device(server, 'u1', 'Ian', false);
    hid = (await d.repo.createHousehold('Casa')).household.id;
  });

  it('estoque = soma dos movimentos; compra cria produto com nome bonito', async () => {
    const pid = await seedPurchase(d, hid, [{ desc: 'ARROZ TIO JOAO 5KG', qty: 2 }, { desc: 'FEIJAO CARIOCA', qty: 1.5, unit: 'kg' }]);
    const r = await d.svc.addPurchaseToPantry(hid, pid);
    expect(r).toEqual({ products: 2, movements: 2, already: 0, ignored: 0 });
    const rows = await d.svc.stockRows(hid);
    const arroz = rows.find((x) => x.product.name === 'Arroz Tio Joao 5KG')!;
    expect(arroz.quantity).toBe(2);
    expect(arroz.product.category).toBe('Outros');
    expect(arroz.lastPurchaseAt).toBe('2026-09-19T21:15:34.000Z');
    expect(rows.find((x) => x.unit === 'kg')!.quantity).toBe(1.5);
    await d.svc.consume(hid, arroz.product.id);
    await d.svc.discard(hid, arroz.product.id, 0.5);
    expect(await d.svc.currentStock(hid, arroz.product.id)).toBe(0.5);
    const kinds = (await d.svc.movements(hid, arroz.product.id)).map((m) => m.kind).sort();
    expect(kinds).toEqual(['compra', 'consumo', 'descarte']);
  });

  it("'compra' é idempotente: adicionar a mesma nota 2× não duplica", async () => {
    const pid = await seedPurchase(d, hid, [{ desc: 'LEITE INTEGRAL 1L', qty: 6 }]);
    await d.svc.addPurchaseToPantry(hid, pid);
    const again = await d.svc.addPurchaseToPantry(hid, pid);
    expect(again).toMatchObject({ products: 0, movements: 0, already: 1 });
    const rows = await d.svc.stockRows(hid);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBe(6);
    expect(await d.db.inventoryMovements.count()).toBe(1);
  });

  it('esgotado zera; ajuste leva ao valor informado; ainda_tem não altera', async () => {
    const pid = await seedPurchase(d, hid, [{ desc: 'CAFE 500G', qty: 3 }]);
    await d.svc.addPurchaseToPantry(hid, pid);
    const p = (await d.svc.stockRows(hid))[0]!.product;
    await d.svc.stillHave(hid, p.id);
    expect(await d.svc.currentStock(hid, p.id)).toBe(3);
    await d.svc.adjustTo(hid, p.id, 1.25);
    expect(await d.svc.currentStock(hid, p.id)).toBe(1.25);
    expect(await d.svc.adjustTo(hid, p.id, 1.25)).toBeNull();
    await d.svc.adjustTo(hid, p.id, 4);
    expect(await d.svc.currentStock(hid, p.id)).toBe(4);
    await d.svc.markOut(hid, p.id);
    expect(await d.svc.currentStock(hid, p.id)).toBe(0);
    const { inStock, out } = splitStock(await d.svc.stockRows(hid));
    expect(inStock).toHaveLength(0);
    expect(out).toHaveLength(1);
    await expect(d.svc.consume(hid, p.id)).rejects.toThrow('sem estoque');
  });

  it('"Usei 1" não passa do estoque (0,4 kg → 0)', async () => {
    const { product } = await d.svc.addManual(hid, { name: 'Queijo', quantity: 0.4, unit: 'kg', category: 'Laticínios' });
    await d.svc.consume(hid, product.id, 1);
    expect(await d.svc.currentStock(hid, product.id)).toBe(0);
  });

  it('produto manual reaproveita produto de mesmo nome (sem duplicar) e soma', async () => {
    const a = await d.svc.addManual(hid, { name: 'Sal', quantity: 1 });
    const b = await d.svc.addManual(hid, { name: ' sal ', quantity: 2 });
    expect(b.created).toBe(false);
    expect(b.product.id).toBe(a.product.id);
    expect(await d.svc.currentStock(hid, a.product.id)).toBe(3);
    // nota com mesmo nome normalizado reaproveita o produto manual
    const pid = await seedPurchase(d, hid, [{ desc: 'SAL', qty: 1 }]);
    const r = await d.svc.addPurchaseToPantry(hid, pid);
    expect(r.products).toBe(0);
    expect(await d.svc.currentStock(hid, a.product.id)).toBe(4);
  });

  it('unidade diferente da do produto é ignorada e contada (não soma kg com un)', async () => {
    await d.svc.addManual(hid, { name: 'Tomate', quantity: 3, unit: 'un' });
    const pid = await seedPurchase(d, hid, [{ desc: 'TOMATE', qty: 1.2, unit: 'kg' }]);
    const r = await d.svc.addPurchaseToPantry(hid, pid);
    expect(r).toMatchObject({ movements: 0, ignored: 1 });
  });

  it('exige nota importada e valida a Casa', async () => {
    const pid = await purchaseIdFor(hid, KEY);
    await d.engine.mutate(hid, 'purchases', pid, { accessKey: KEY, purchasedAt: '2026-09-19T12:00:00.000Z', totalCents: 0, source: 'nfce_qr', status: 'pendente', deleted: false });
    await expect(d.svc.addPurchaseToPantry(hid, pid)).rejects.toThrow('Importe os itens');
    await expect(d.svc.addPurchaseToPantry(hid, 'x-nao-existe')).rejects.toThrow('não encontrada');
  });

  it('Pôr na lista não duplica', async () => {
    const { product } = await d.svc.addManual(hid, { name: 'Detergente', quantity: 1 });
    await d.svc.markOut(hid, product.id);
    expect((await d.svc.putOnList(hid, product.id)).added).toBe(true);
    expect((await d.svc.putOnList(hid, product.id)).added).toBe(false);
    const list = (await d.repo.getDefaultList(hid))!;
    const items = await d.repo.listItems(hid, list.id);
    expect(items.filter((i) => i.name === 'Detergente')).toHaveLength(1);
    expect(items[0]!.quantity).toBe(1);
  });

  it('editar produto muda nome/categoria sem tocar no estoque', async () => {
    const { product } = await d.svc.addManual(hid, { name: 'Sabao', quantity: 2 });
    await d.svc.editProduct(hid, product.id, { name: 'Sabão em pó', category: 'Limpeza' });
    const row = (await d.svc.stockRows(hid))[0]!;
    expect(row.product.name).toBe('Sabão em pó');
    expect(row.product.category).toBe('Limpeza');
    expect(row.quantity).toBe(2);
  });
});

describe('Gastos por categoria ligados aos produtos', () => {
  it('categoria do produto (nota ou manual) vale para os itens; sem produto → Sem categoria', async () => {
    const server = new MemorySyncServer(now);
    const d = await device(server, 'u1', 'Ian', false);
    const hid = (await d.repo.createHousehold('Casa')).household.id;
    const pid = await seedPurchase(d, hid, [{ desc: 'ARROZ TIO JOAO 5KG', qty: 2 }, { desc: 'DETERGENTE YPE', qty: 1 }, { desc: 'COISA SEM PRODUTO', qty: 1 }]);
    await d.svc.addPurchaseToPantry(hid, pid);
    const rows = await d.svc.stockRows(hid);
    await d.svc.editProduct(hid, rows.find((r) => r.product.name.startsWith('Arroz'))!.product.id, { category: 'Mercearia' });
    await d.svc.editProduct(hid, rows.find((r) => r.product.name.startsWith('Deterg'))!.product.id, { category: 'Limpeza' });
    // apaga o produto "coisa sem produto" para simular item sem produto ligado
    const lone = rows.find((r) => r.product.name.startsWith('Coisa'))!.product;
    await d.engine.mutate(hid, 'products', lone.id, { deleted: true });
    const purchases = await d.repo.listPurchases(hid);
    const lines = await loadCategoryLines(d.repo, hid, purchases);
    const out = byCategory(lines, inMonth(purchases, '2026-09'));
    expect(out.map((o) => o.category).sort()).toEqual(['Limpeza', 'Mercearia', 'Sem categoria']);
    expect(out.find((o) => o.category === 'Mercearia')!.totalCents).toBe(1000);
  });
});

describe('Despensa em dois aparelhos (MemorySyncServer)', () => {
  let server: MemorySyncServer;
  let ian: Dev;
  let fer: Dev;
  let hid: string;
  beforeEach(async () => {
    server = new MemorySyncServer(now);
    ian = await device(server, 'user-ian', 'Ian');
    fer = await device(server, 'user-fer', 'Fernanda');
    hid = (await ian.repo.createHousehold('Casa')).household.id;
    server.createHousehold('user-ian', hid);
    await ian.engine.sync(hid);
    server.createInvite('user-ian', hid, 'CODE-1');
    server.acceptInvite('user-fer', 'CODE-1');
    await fer.engine.sync(hid);
  });
  const syncAll = async () => {
    for (let i = 0; i < 2; i++) {
      await ian.engine.sync(hid);
      await fer.engine.sync(hid);
    }
  };

  it('a mesma nota adicionada nos dois aparelhos (offline) não duplica produtos nem estoque', async () => {
    // Cada aparelho tem a nota localmente (ids determinísticos) e adiciona à despensa sem sincronizar.
    const lines = [{ desc: 'ARROZ TIO JOAO 5KG', qty: 2 }, { desc: 'FEIJAO PRETO 1KG', qty: 3 }];
    ian.engine.setTransport(null);
    fer.engine.setTransport(null);
    const pi = await seedPurchase(ian, hid, lines);
    const pf = await seedPurchase(fer, hid, lines);
    expect(pi).toBe(pf);
    await ian.svc.addPurchaseToPantry(hid, pi);
    await fer.svc.addPurchaseToPantry(hid, pf);
    ian.engine.setTransport(server.transportFor('user-ian'));
    fer.engine.setTransport(server.transportFor('user-fer'));
    await syncAll();
    for (const d of [ian, fer]) {
      const rows = await d.svc.stockRows(hid);
      expect(rows).toHaveLength(2);
      expect(rows.map((r) => r.quantity).sort()).toEqual([2, 3]);
      expect(await d.db.inventoryMovements.count()).toBe(2);
      expect(await d.db.products.count()).toBe(2);
    }
  });

  it('"Usei 1" concorrente offline nos dois aparelhos: estoque cai 2 (sem perda)', async () => {
    const { product } = await ian.svc.addManual(hid, { name: 'Leite', quantity: 5, unit: 'l' });
    await syncAll();
    ian.engine.setTransport(null);
    fer.engine.setTransport(null);
    await ian.svc.consume(hid, product.id, 1);
    await fer.svc.consume(hid, product.id, 1);
    ian.engine.setTransport(server.transportFor('user-ian'));
    fer.engine.setTransport(server.transportFor('user-fer'));
    await syncAll();
    expect(await ian.svc.currentStock(hid, product.id)).toBe(3);
    expect(await fer.svc.currentStock(hid, product.id)).toBe(3);
  });

  it('"Acabou" concorrente nos dois aparelhos: estoque 0 (nunca negativo) e compra futura vale', async () => {
    const { product } = await ian.svc.addManual(hid, { name: 'Leite', quantity: 5, unit: 'l' });
    await syncAll();
    ian.engine.setTransport(null);
    fer.engine.setTransport(null);
    await ian.svc.markOut(hid, product.id);
    await fer.svc.markOut(hid, product.id);
    ian.engine.setTransport(server.transportFor('user-ian'));
    fer.engine.setTransport(server.transportFor('user-fer'));
    await syncAll();
    for (const d of [ian, fer]) expect(await d.svc.currentStock(hid, product.id)).toBe(0);
    await ian.svc.addManual(hid, { name: 'Leite', quantity: 2, unit: 'l' });
    await syncAll();
    for (const d of [ian, fer]) {
      expect(await d.svc.currentStock(hid, product.id)).toBe(2);
      expect(splitStock(await d.svc.stockRows(hid)).inStock).toHaveLength(1);
    }
  });

  it('"Usei 1" concorrente com 1 restante: estoque 0, não negativo', async () => {
    const { product } = await ian.svc.addManual(hid, { name: 'Ovos', quantity: 1 });
    await syncAll();
    ian.engine.setTransport(null);
    fer.engine.setTransport(null);
    await ian.svc.consume(hid, product.id, 1);
    await fer.svc.consume(hid, product.id, 1);
    ian.engine.setTransport(server.transportFor('user-ian'));
    fer.engine.setTransport(server.transportFor('user-fer'));
    await syncAll();
    expect(await ian.svc.currentStock(hid, product.id)).toBe(0);
    expect(await fer.svc.currentStock(hid, product.id)).toBe(0);
  });

  it('mesma nota adicionada por duas pessoas offline: sem conflito espúrio (by)', async () => {
    const lines = [{ desc: 'ARROZ TIO JOAO 5KG', qty: 2 }];
    ian.engine.setTransport(null);
    fer.engine.setTransport(null);
    const pid = await seedPurchase(ian, hid, lines);
    await seedPurchase(fer, hid, lines);
    await ian.svc.addPurchaseToPantry(hid, pid);
    await fer.svc.addPurchaseToPantry(hid, pid);
    ian.engine.setTransport(server.transportFor('user-ian'));
    fer.engine.setTransport(server.transportFor('user-fer'));
    await syncAll();
    for (const d of [ian, fer]) {
      const conflicts = (await d.db.conflicts.toArray()).filter((c) => c.entity === 'inventoryMovements' || c.entity === 'products');
      expect(conflicts.map((c) => `${c.entity}.${c.field}`)).toEqual([]);
    }
  });

  it('produto nasce com o mesmo id nos dois aparelhos', async () => {
    const id = await productIdFor(hid, 'arroz');
    const pid = await seedPurchase(ian, hid, [{ desc: 'Arroz', qty: 1 }]);
    await ian.svc.addPurchaseToPantry(hid, pid);
    await syncAll();
    expect((await fer.db.products.get(id))?.name).toBe('Arroz');
  });
});

describe('isolamento por Casa', () => {
  it('estoque e produtos de uma Casa não aparecem na outra', async () => {
    const server = new MemorySyncServer(now);
    const d = await device(server, 'u1', 'Ian', false);
    const h1 = (await d.repo.createHousehold('A')).household.id;
    const h2 = (await d.repo.createHousehold('B')).household.id;
    const { product } = await d.svc.addManual(h1, { name: 'Arroz', quantity: 2 });
    const pid = await seedPurchase(d, h1, [{ desc: 'FEIJAO', qty: 1 }]);
    await d.svc.addPurchaseToPantry(h1, pid);
    expect(await d.svc.stockRows(h2)).toHaveLength(0);
    expect(await d.svc.stockRows(h1)).toHaveLength(2);
    await expect(d.svc.consume(h2, product.id)).rejects.toThrow('não encontrado');
    await expect(d.svc.addPurchaseToPantry(h2, pid)).rejects.toThrow('não encontrada');
    expect(await d.svc.currentStock(h2, product.id)).toBe(0);
    // produtos de ids determinísticos diferem por Casa
    expect(await productIdFor(h1, 'feijao')).not.toBe(await productIdFor(h2, 'feijao'));
    // computeStock também filtra por Casa
    const all = await d.db.products.toArray();
    const mov = await d.db.inventoryMovements.toArray();
    expect(computeStock(h2, all, mov)).toHaveLength(0);
  });
});
