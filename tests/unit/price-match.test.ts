import { describe, expect, it } from 'vitest';
import { matchesListItem, priceStatsFor, type PriceEntry } from '../../src/prices/priceMatch';
import { mod11 } from '../../src/nfce/accessKey';
import { parseNfceQr } from '../../src/nfce/qrcode';

const TINTA = 'TINTA STD ACR FSC RD E COBRE BR 20L SV';

describe('matchesListItem', () => {
  it.each([
    ['Tinta', TINTA],
    ['Fita crepe', 'FITA CREPE BRANCA 48MMx50M TEKBOND'],
    ['Fita', 'FITA CREPE BRANCA 48MMx50M TEKBOND'],
    ['Lixa', 'FOLHA LIXA MASSA G120 A230 ALCAR'],
    ['Sabão líquido', 'SAB OMO LQD 3L'],
    ['Tinta 20l', TINTA],
    ['Tinta acrílica', TINTA],
    ['TINTA', 'tinta'],
    ['Pão de forma', 'PAO FORMA PULLMAN 500G'],
  ])('%s casa %s', (l, d) => expect(matchesListItem(l, d)).toBe(true));

  it.each([
    ['Leite', 'MASSA ACRILICA 55KG SUVINIL'],
    ['Pão', 'PLASTICO BOLHA 130X50M'],
    ['Tinta 18l', TINTA],
    ['Ab', 'AB CD AB'],
    ['de da', 'DE DA'],
    ['20l', TINTA],
    ['Sal', 'SALSICHA HOT DOG'],
    ['Sabonete', 'SAB OMO LQD 3L'],
  ])('%s não casa %s', (l, d) => expect(matchesListItem(l, d)).toBe(false));
});

const e = (over: Partial<PriceEntry>): PriceEntry => ({
  rawDescription: 'FITA CREPE BRANCA',
  unit: 'un',
  unitPriceCents: 1000,
  quantity: 1,
  purchasedAt: '2026-01-01T12:00:00.000Z',
  purchaseId: 'p1',
  ...over,
});

describe('priceStatsFor', () => {
  it('último, médio e mínimo; ordena do mais recente', () => {
    const r = priceStatsFor('Fita crepe', [
      e({ purchaseId: 'a', purchasedAt: '2026-01-01T12:00:00.000Z', unitPriceCents: 1290 }),
      e({ purchaseId: 'c', purchasedAt: '2026-03-01T12:00:00.000Z', unitPriceCents: 1100, storeCnpj: '11222333000181' }),
      e({ purchaseId: 'b', purchasedAt: '2026-02-01T12:00:00.000Z', unitPriceCents: 1000 }),
      e({ purchaseId: 'x', rawDescription: 'LEITE INTEGRAL', unitPriceCents: 1 }),
    ])!;
    expect(r.count).toBe(3);
    expect(r.last).toMatchObject({ unitPriceCents: 1100, storeCnpj: '11222333000181' });
    expect(r.avgUnitCents).toBe(1130);
    expect(r.minUnitCents).toBe(1000);
    expect(r.matches.map((m) => m.purchaseId)).toEqual(['c', 'b', 'a']);
  });
  it('não mistura unidades', () => {
    const r = priceStatsFor('Fita', [
      e({ purchaseId: 'a', unit: 'kg', unitPriceCents: 100, purchasedAt: '2026-01-01T12:00:00.000Z' }),
      e({ purchaseId: 'b', unit: 'un', unitPriceCents: 2000, purchasedAt: '2026-02-01T12:00:00.000Z' }),
      e({ purchaseId: 'c', unit: 'un', unitPriceCents: 1000, purchasedAt: '2026-03-01T12:00:00.000Z' }),
    ])!;
    expect(r).toMatchObject({ count: 2, avgUnitCents: 1500, minUnitCents: 1000 });
    expect(r.last.unit).toBe('un');
    expect(r.matches).toHaveLength(3);
  });
  it('vazio ou sem casamento → null', () => {
    expect(priceStatsFor('Fita', [])).toBeNull();
    expect(priceStatsFor('Leite', [e({})])).toBeNull();
  });
});

describe('priceEntries (repo)', async () => {
  const { PantryDB } = await import('../../src/db/db');
  const { PantryRepo } = await import('../../src/db/repo');
  const { SyncEngine } = await import('../../src/sync/engine');
  const { MemorySyncServer } = await import('../../src/sync/memoryServer');
  const { parseSefazText } = await import('../../src/nfce/parseSefazText');
  let n = 0;
  const mk = (body: string) => {
    const k43 = '35' + '2609' + '11222333000181' + '65' + '006' + body + '1' + '12345678';
    return k43 + mod11(k43);
  };
  const TEXT = `FITA CREPE BRANCA 48MMx50M TEKBOND (Código: 89641405 )
Qtde.:2   UN: UN   Vl. Unit.:   12,9 \tVl. Total
25,80
Qtd. total de itens: 1
Valor total R$: 25,80
Valor a pagar R$: 25,80
Forma de pagamento: Valor pago R$:
Cartão de Crédito 25,80
Número: 12345 Série: 6 Emissão: 19/09/2026 18:15:34 - Via Consumidor
`;

  it('ignora pendentes, excluídas e de outra Casa', async () => {
    const engine = await SyncEngine.create(new PantryDB(`price-${++n}`), `devP${n}`, { transport: new MemorySyncServer().transportFor('ian') });
    const repo = new PantryRepo(engine, () => 'ian');
    const { household: h1 } = await repo.createHousehold('Casa 1');
    const { household: h2 } = await repo.createHousehold('Casa 2');
    const okKey = mk('000012345');
    const { purchase: ok } = await repo.savePurchaseFromQr(h1.id, parseNfceQr(okKey));
    await repo.importPurchaseItems(h1.id, ok.id, parseSefazText(TEXT));
    // pendente
    await repo.savePurchaseFromQr(h1.id, parseNfceQr(mk('000099999')));
    // excluída (importada e depois removida)
    const delKey = mk('000011111');
    const { purchase: del } = await repo.savePurchaseFromQr(h1.id, parseNfceQr(delKey));
    await repo.importPurchaseItems(h1.id, del.id, parseSefazText(TEXT.replace('12345', '11111')));
    await repo.removePurchase(h1.id, del.id);
    // outra Casa
    const { purchase: other } = await repo.savePurchaseFromQr(h2.id, parseNfceQr(okKey));
    await repo.importPurchaseItems(h2.id, other.id, parseSefazText(TEXT));

    const r = await repo.priceEntries(h1.id);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ rawDescription: 'FITA CREPE BRANCA 48MMx50M TEKBOND', unitPriceCents: 1290, quantity: 2, storeCnpj: '11222333000181', purchaseId: ok.id });
    expect(await repo.priceEntries(h2.id)).toHaveLength(1);
  });
});
