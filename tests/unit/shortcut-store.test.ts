import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { PantryDB } from '../../src/db/db';
import { PantryRepo, storeIdFor } from '../../src/db/repo';
import { SyncEngine } from '../../src/sync/engine';
import { MemorySyncServer } from '../../src/sync/memoryServer';
import { mod11 } from '../../src/nfce/accessKey';
import { evaluateShortcutLink, storeLabel, storeLabelWithCnpj } from '../../src/stores/stores';
import { estimateTotal, comparePrice } from '../../src/shopping/shopping';
import { priceStatsFor } from '../../src/prices/priceMatch';

const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + '000012345' + '9' + '12345678';
const KEY = k43 + mod11(k43);
const QR = `https://www.nfce.fazenda.sp.gov.br/qrcode?p=${KEY}|2|1|19|597.45|6a6f|1|ABCDEF`;
const CNPJ = '11222333000181';
const params = (qr: string | null, colar = '1') => new URLSearchParams(qr === null ? '' : `qr=${encodeURIComponent(qr)}&colar=${colar}`);

let n = 0;
async function device(server: MemorySyncServer, userId: string, name: string) {
  const db = new PantryDB(`sc-${++n}-${name}`);
  const engine = await SyncEngine.create(db, `dev${n}${name}`, { transport: server.transportFor(userId), now: () => 1_700_000_000_000 + n });
  return { db, repo: new PantryRepo(engine, () => name), engine };
}

describe('deep link do Atalho', () => {
  it('QR válido pede confirmação e não grava nada', async () => {
    const server = new MemorySyncServer(() => 1_700_000_000_000);
    const d = await device(server, 'u1', 'Ian');
    const { household } = await d.repo.createHousehold('Casa');
    const ev = evaluateShortcutLink(params(QR));
    expect(ev.kind).toBe('confirm');
    if (ev.kind === 'confirm') {
      expect(ev.paste).toBe(true);
      expect(ev.qr.info.issuerId).toBe(CNPJ);
    }
    expect(await d.repo.listPurchases(household.id)).toHaveLength(0);
    // Só o toque em "Registrar" grava, e sem duplicar.
    if (ev.kind === 'confirm') {
      await d.repo.savePurchaseFromQr(household.id, ev.qr);
      const again = await d.repo.savePurchaseFromQr(household.id, ev.qr);
      expect(again.existing).toBe(true);
      expect(await d.repo.listPurchases(household.id)).toHaveLength(1);
    }
  });
  it('sem qr, inválido e fora de gov.br', () => {
    expect(evaluateShortcutLink(new URLSearchParams('colar=1')).kind).toBe('none');
    expect(evaluateShortcutLink(params('lixo')).kind).toBe('invalid');
    expect(evaluateShortcutLink(params(KEY)).kind).toBe('invalid'); // chave solta não vale no atalho
    expect(evaluateShortcutLink(params(QR.replace('nfce.fazenda.sp.gov.br', 'evil.example.com'))).kind).toBe('invalid');
    expect(evaluateShortcutLink(params(QR.replace('nfce.fazenda.sp.gov.br', 'gov.br.evil.com'))).kind).toBe('invalid');
    expect(evaluateShortcutLink(params(QR.slice(0, 80))).kind).toBe('invalid');
  });
  it('colar=1 ausente não destaca Colar', () => {
    const ev = evaluateShortcutLink(new URLSearchParams(`qr=${encodeURIComponent(QR)}`));
    expect(ev).toMatchObject({ kind: 'confirm', paste: false });
  });
});

describe('nome da loja', () => {
  it('id determinístico por Casa + CNPJ', async () => {
    expect(await storeIdFor('h1', CNPJ)).toBe(await storeIdFor('h1', CNPJ));
    expect(await storeIdFor('h1', CNPJ)).not.toBe(await storeIdFor('h2', CNPJ));
    expect(await storeIdFor('h1', CNPJ)).not.toBe(await storeIdFor('h1', '99888777000166'));
  });
  it('dois aparelhos nomeando a mesma loja convergem em um registro', async () => {
    const server = new MemorySyncServer(() => 1_700_000_000_000);
    const ian = await device(server, 'u1', 'Ian');
    const fer = await device(server, 'u2', 'Fernanda');
    const hid = (await ian.repo.createHousehold('Casa')).household.id;
    server.createHousehold('u1', hid);
    await ian.engine.sync(hid);
    server.createInvite('u1', hid, 'CODE-1234');
    server.acceptInvite('u2', 'CODE-1234');
    await fer.engine.sync(hid);
    // Offline nos dois: cada um dá um nome à mesma loja.
    await ian.repo.setStoreName(hid, CNPJ, 'Mercado A');
    await fer.repo.setStoreName(hid, CNPJ, 'Mercado do Bairro');
    for (let i = 0; i < 2; i++) { await ian.engine.sync(hid); await fer.engine.sync(hid); }
    expect(await ian.db.stores.where('householdId').equals(hid).count()).toBe(1);
    expect(await fer.db.stores.where('householdId').equals(hid).count()).toBe(1);
    const ni = (await ian.repo.storeNamesByCnpj(hid)).get(CNPJ);
    expect(ni).toBeTruthy();
    expect((await fer.repo.storeNamesByCnpj(hid)).get(CNPJ)).toBe(ni);
  });
  it('storeNamesByCnpj é isolado por Casa e valida entrada', async () => {
    const server = new MemorySyncServer(() => 1_700_000_000_000);
    const a = await device(server, 'u1', 'Ian');
    const h1 = (await a.repo.createHousehold('Casa 1')).household.id;
    const h2 = (await a.repo.createHousehold('Casa 2')).household.id;
    await a.repo.setStoreName(h1, CNPJ, 'Loja da Casa 1');
    expect((await a.repo.storeNamesByCnpj(h2)).size).toBe(0);
    expect((await a.repo.storeNamesByCnpj(h1)).get(CNPJ)).toBe('Loja da Casa 1');
    await expect(a.repo.setStoreName(h1, '123', 'x')).rejects.toThrow();
    await expect(a.repo.setStoreName(h1, CNPJ, '   ')).rejects.toThrow();
  });
  it('rótulos: nome quando existir, senão CNPJ', () => {
    const names = new Map([[CNPJ, 'Mercado do Bairro']]);
    expect(storeLabel(CNPJ, names)).toBe('Mercado do Bairro');
    expect(storeLabel(CNPJ, new Map())).toBe('11.222.333/0001-81');
    expect(storeLabel(null, names, 'Loja não identificada')).toBe('Loja não identificada');
    expect(storeLabelWithCnpj(CNPJ, names)).toBe('Mercado do Bairro (11.222.333/0001-81)');
  });
});

describe('limpar preço encontrado', () => {
  it('null apaga, e o total estimado volta a usar o último preço pago', async () => {
    const server = new MemorySyncServer(() => 1_700_000_000_000);
    const a = await device(server, 'u1', 'Ian');
    const { household, list } = await a.repo.createHousehold('Casa');
    const { item } = await a.repo.addItem(household.id, list.id, { name: 'Fita crepe' });
    await a.repo.updateItem(household.id, item.id, { foundPriceCents: 1590 });
    const stats = priceStatsFor('Fita crepe', [
      { rawDescription: 'FITA CREPE BRANCA 48MMx50M', unit: 'un', unitPriceCents: 1290, quantity: 1, purchasedAt: '2026-09-10T12:00:00Z', purchaseId: 'p1' },
    ]);
    const get = async () => (await a.repo.listItems(household.id, list.id))[0]!;
    expect(estimateTotal([await get()], () => stats).totalCents).toBe(1590);
    await a.repo.updateItem(household.id, item.id, { foundPriceCents: null });
    const cleared = await get();
    expect(cleared.foundPriceCents).toBeNull();
    expect(estimateTotal([cleared], () => stats).totalCents).toBe(1290);
    expect(comparePrice(cleared, stats).status).toBe('sem');
    // Sem histórico: fora da conta.
    expect(estimateTotal([cleared], () => null)).toMatchObject({ totalCents: 0, withoutPrice: 1 });
    // Pode gravar de novo depois de limpar.
    await a.repo.updateItem(household.id, item.id, { foundPriceCents: 1000 });
    expect((await get()).foundPriceCents).toBe(1000);
  });
});
