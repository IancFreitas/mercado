import { describe, expect, it } from 'vitest';
import { normalizedUnitPrice, parsePackage } from '../../src/prices/packageSize';
import { priceStatsFor, type PriceEntry } from '../../src/prices/priceMatch';

describe('parsePackage', () => {
  it.each([
    ['SAB LQD OMO 3L', { size: 3, unit: 'l' }],
    ['SABAO LIQUIDO 3 L', { size: 3, unit: 'l' }],
    ['LEITE UHT INTEG 1,5L', { size: 1.5, unit: 'l' }],
    ['SUCO UVA 900ML', { size: 0.9, unit: 'l' }],
    ['ACUCAR REFINADO 500G', { size: 0.5, unit: 'kg' }],
    ['ARROZ TIPO 1 5KG', { size: 5, unit: 'kg' }],
    ['MASSA ACRILICA 55KG SUVINIL', { size: 55, unit: 'kg' }],
    ['AGUA MINERAL 2LT', { size: 2, unit: 'l' }],
    ['REFRI COLA 12X1L', { size: 1, unit: 'l', count: 12 }],
    ['IOGURTE 6X200ML', { size: 0.2, unit: 'l', count: 6 }],
    ['COCA COLA 2L C/6', { size: 2, unit: 'l', count: 6 }],
    ['OVOS BRANCOS C/12', { size: 1, unit: 'un', count: 12 }],
    ['OVOS BRANCOS 12UN', { size: 1, unit: 'un', count: 12 }],
    ['Sabão líquido 3L', { size: 3, unit: 'l' }],
  ])('%s', (d, exp) => expect(parsePackage(d)).toEqual(exp));

  it.each([
    'FITA CREPE BRANCA 48MMx50M TEKBOND',
    'PLASTICO BOLHA 130X50M',
    'SACOLA PLASTICA CINZA 60X70',
    'FOLHA LIXA MASSA G120 A230 ALCAR',
    'ROLO LA SINT ANTIR S SUP 1374 23CM TIGR',
    'TRINCHA SIMPLES PPAREDE 2 COMPEL',
    'FIO CABO 3X2,5MM',
    'PAO FORMA',
    '',
  ])('sem embalagem: %s', (d) => expect(parsePackage(d)).toBeNull());
});

describe('normalizedUnitPrice', () => {
  const n = (unit: PriceEntry['unit'], unitPriceCents: number, rawDescription: string) => normalizedUnitPrice({ unit, unitPriceCents, rawDescription });
  it('a granel já é por kg/l', () => {
    expect(n('kg', 1299, 'BANANA PRATA')).toEqual({ cents: 1299, unit: 'kg' });
    expect(n('g', 2, 'QUEIJO')).toEqual({ cents: 2000, unit: 'kg' });
    expect(n('ml', 1, 'AGUA')).toEqual({ cents: 1000, unit: 'l' });
  });
  it('un com embalagem divide pelo tamanho', () => {
    expect(n('un', 7190, 'MASSA ACRILICA 55KG SUVINIL')).toEqual({ cents: 131, unit: 'kg' });
    expect(n('un', 3290, 'SAB LQD OMO 3L')).toEqual({ cents: 1097, unit: 'l' });
    expect(n('un', 990, 'SAB LQD OMO 900ML')).toEqual({ cents: 1100, unit: 'l' });
    expect(n('un', 1200, 'OVOS C/12')).toEqual({ cents: 100, unit: 'un' });
    expect(n('un', 4800, 'REFRI 12X1L')).toEqual({ cents: 400, unit: 'l' });
  });
  it('sem tamanho -> null', () => {
    expect(n('un', 1290, 'FITA CREPE BRANCA 48MMx50M TEKBOND')).toBeNull();
    expect(n('un', 539, 'TRINCHA SIMPLES')).toBeNull();
  });
});

describe('stats normalizadas', () => {
  const e = (d: string, cents: number, at: string, id: string): PriceEntry => ({
    rawDescription: d, unit: 'un', unitPriceCents: cents, quantity: 1, purchasedAt: at, purchaseId: id,
  });
  it('compara 900ml com 3L pela mesma base', () => {
    const st = priceStatsFor('Sabão líquido', [
      e('SAB LQD OMO 3L', 3300, '2026-09-01T12:00:00Z', 'a'),
      e('SAB LQD OMO 900ML', 1089, '2026-08-01T12:00:00Z', 'b'),
    ])!;
    expect(st.normalizedLast).toEqual({ cents: 1100, unit: 'l' });
    expect(st.normalizedAvg).toBe(1155); // (1100 + 1210) / 2
    expect(st.normalizedCount).toBe(2);
  });
  it('Obramax: massa acrílica 55kg -> R$/kg; fita crepe -> sem normalização', () => {
    const massa = priceStatsFor('Massa acrílica', [e('MASSA ACRILICA 55KG SUVINIL', 7190, '2026-09-19T12:00:00Z', 'x')])!;
    expect(massa.normalizedLast).toEqual({ cents: 131, unit: 'kg' });
    const fita = priceStatsFor('Fita crepe', [e('FITA CREPE BRANCA 48MMx50M TEKBOND', 1290, '2026-09-19T12:00:00Z', 'x')])!;
    expect(fita.normalizedLast).toBeUndefined();
  });
});
