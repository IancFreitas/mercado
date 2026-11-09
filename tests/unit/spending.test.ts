import { describe, expect, it } from 'vitest';
import type { Category, Purchase } from '../../src/domain/types';
import {
  availableMonths,
  byCategory,
  byStore,
  changePct,
  currentMonthKey,
  inMonth,
  monthKey,
  prevMonthKey,
  spendingPurchases,
  summarizeMonth,
} from '../../src/spending/spending';

const H = '11111111-1111-4111-8111-111111111111';
let n = 0;
function pur(over: Partial<Purchase>): Purchase {
  return {
    id: `p${++n}`,
    householdId: H,
    _v: {},
    purchasedAt: '2026-09-10T15:00:00.000Z',
    totalCents: 10000,
    source: 'nfce_qr',
    status: 'importada',
    issuerCnpj: '11222333000181',
    ...over,
  };
}

describe('meses no fuso de São Paulo', () => {
  it('01:00 UTC do dia 1º ainda é o mês anterior em SP (UTC−3)', () => {
    expect(monthKey('2026-10-01T01:00:00.000Z')).toBe('2026-09');
    expect(monthKey('2026-10-01T03:00:00.000Z')).toBe('2026-10');
    expect(monthKey('2026-01-01T02:59:59.000Z')).toBe('2025-12');
    expect(monthKey('lixo')).toBeNull();
  });
  it('mês atual segue o fuso e mês anterior vira o ano', () => {
    expect(currentMonthKey(new Date('2026-11-01T02:00:00Z'))).toBe('2026-10');
    expect(prevMonthKey('2026-01')).toBe('2025-12');
    expect(prevMonthKey('2026-03')).toBe('2026-02');
  });
});

describe('totais', () => {
  const ps = spendingPurchases(H, [
    pur({ totalCents: 10000 }),
    pur({ totalCents: 5000, issuerCnpj: '99888777000166' }),
    pur({ totalCents: 2500, purchasedAt: '2026-08-20T15:00:00.000Z' }),
    pur({ totalCents: 0 }), // pendente sem total: fora
    pur({ totalCents: 7000, deleted: true }), // excluída: fora
    pur({ totalCents: 9999, householdId: '22222222-2222-4222-8222-222222222222' }), // outra Casa: fora
  ]);

  it('só entram compras da Casa, não excluídas e com total > 0', () => {
    expect(ps).toHaveLength(3);
  });
  it('total por mês e comparação', () => {
    const s = summarizeMonth(ps, '2026-09');
    expect(s).toMatchObject({ totalCents: 15000, count: 2, previousCents: 2500, changePct: 500 });
  });
  it('% só quando os dois meses têm gasto', () => {
    expect(changePct(100, 0)).toBeNull();
    expect(changePct(0, 100)).toBeNull();
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(75, 100)).toBe(-25);
    expect(summarizeMonth(ps, '2026-08').changePct).toBeNull(); // julho sem compras
  });
  it('mês sem compras', () => {
    const s = summarizeMonth(ps, '2026-05');
    expect(s).toMatchObject({ totalCents: 0, count: 0, changePct: null });
    expect(byStore(ps, '2026-05')).toEqual([]);
    expect(inMonth(ps, '2026-05')).toEqual([]);
  });
  it('por loja, em ordem decrescente', () => {
    expect(byStore(ps, '2026-09')).toEqual([
      { cnpj: '11222333000181', totalCents: 10000, count: 1 },
      { cnpj: '99888777000166', totalCents: 5000, count: 1 },
    ]);
  });
  it('loja sem CNPJ vira null', () => {
    expect(byStore([pur({ issuerCnpj: undefined, totalCents: 100 })], '2026-09')[0]!.cnpj).toBeNull();
  });
  it('meses disponíveis incluem o atual', () => {
    expect(availableMonths(ps, '2026-11')).toEqual(['2026-11', '2026-09', '2026-08']);
  });
  it('compra perto da virada do mês cai no mês de SP', () => {
    const p = pur({ purchasedAt: '2026-10-01T01:30:00.000Z', totalCents: 4000 });
    expect(summarizeMonth([p], '2026-09').totalCents).toBe(4000);
    expect(summarizeMonth([p], '2026-10').totalCents).toBe(0);
  });
});

describe('por categoria', () => {
  it('soma itens por categoria; sem produto → "Sem categoria"; ignora compras de outro mês', () => {
    const a = pur({});
    const b = pur({ purchasedAt: '2026-08-01T15:00:00.000Z' });
    const line = (purchaseId: string, totalCents: number, category: Category | null) => ({ purchaseId, totalCents, category });
    const out = byCategory(
      [line(a.id, 1000, 'Mercearia'), line(a.id, 500, 'Mercearia'), line(a.id, 700, null), line(a.id, 300, 'Limpeza'), line(b.id, 9999, 'Pet')],
      inMonth([a, b], '2026-09'),
    );
    expect(out).toEqual([
      { category: 'Mercearia', totalCents: 1500 },
      { category: 'Sem categoria', totalCents: 700 },
      { category: 'Limpeza', totalCents: 300 },
    ]);
  });
});
