import { describe, expect, it } from 'vitest';
import { comparePrice, estimateTotal, parsePriceInput, type ListLike } from '../../src/shopping/shopping';
import { reconcile } from '../../src/shopping/reconcile';
import { priceStatsFor, type PriceEntry } from '../../src/prices/priceMatch';

const e = (rawDescription: string, unitPriceCents: number, over: Partial<PriceEntry> = {}): PriceEntry => ({
  rawDescription, unit: 'un', unitPriceCents, quantity: 1, purchasedAt: '2026-09-10T12:00:00Z', purchaseId: 'p1', ...over,
});

describe('comparePrice', () => {
  const sabao = priceStatsFor('Sabão líquido 3L', [e('SAB LQD OMO 3L', 3290)]);
  const item = (name: string, found?: number, unit = 'un') => ({ name, unit, foundPriceCents: found });

  it('exemplo do pedido: médio 32,90, encontrado 42,90 -> acima (+30%)', () => {
    const c = comparePrice(item('Sabão líquido 3L', 4290), sabao);
    expect(c.status).toBe('acima');
    expect(c.text).toBe('acima do preço médio (+30%)');
    expect(c.basis).toBe('l');
  });
  it('abaixo e na média (±5%)', () => {
    expect(comparePrice(item('Sabão líquido 3L', 2500), sabao).status).toBe('abaixo');
    expect(comparePrice(item('Sabão líquido 3L', 3400), sabao).status).toBe('media');
    expect(comparePrice(item('Sabão líquido 3L', 3290), sabao).text).toContain('na média');
  });
  it('normalizado: item 900ml contra histórico de 3L', () => {
    const st = priceStatsFor('Sabão líquido', [e('SAB LQD OMO 3L', 3300)]);
    const c = comparePrice(item('Sabão líquido 900ml', 990), st); // 11,00/L vs 11,00/L
    expect(c.status).toBe('media');
    expect(c.basis).toBe('l');
    expect(comparePrice(item('Sabão líquido 900ml', 1500), st).status).toBe('acima');
  });
  it('sem tamanho no nome: compara unitário se mesma unidade', () => {
    const st = priceStatsFor('Fita crepe', [e('FITA CREPE BRANCA 48MMx50M', 1290)]);
    expect(comparePrice(item('Fita crepe', 1590), st)).toMatchObject({ status: 'acima', basis: 'unit' });
  });
  it('unidades incomparáveis, sem histórico ou sem preço -> sem comparação', () => {
    const kg = priceStatsFor('Banana', [e('BANANA PRATA', 599, { unit: 'kg' })]);
    expect(comparePrice(item('Banana', 500, 'un'), kg).status).toBe('sem');
    expect(comparePrice(item('Banana', 500), null).text).toBe('sem comparação');
    expect(comparePrice(item('Fita crepe'), sabao).status).toBe('sem');
  });
});

describe('estimateTotal', () => {
  const st = priceStatsFor('Leite', [e('LEITE INTEG 1L', 500)]);
  const li = (name: string, quantity: number, checked: boolean, foundPriceCents?: number, unit = 'un'): ListLike => ({ name, quantity, checked, unit, foundPriceCents });
  const statsOf = (i: ListLike) => (i.name === 'Leite' ? st : null);

  it('soma encontrado ou último pago × quantidade, separando carrinho e faltam', () => {
    const t = estimateTotal(
      [li('Leite', 2, true), li('Fita', 3, true, 1590), li('Leite', 1, false), li('Coisa', 1, false, 1000)],
      statsOf,
    );
    expect(t.cartCents).toBe(1000 + 4770);
    expect(t.pendingCents).toBe(500 + 1000);
    expect(t.totalCents).toBe(7270);
    expect(t.withoutPrice).toBe(0);
  });
  it('conta itens sem preço e ignora unidade incompatível', () => {
    const t = estimateTotal([li('Pão', 1, false), li('Leite', 1, true, undefined, 'kg'), li('Leite', 1, true)], statsOf);
    expect(t).toMatchObject({ totalCents: 500, cartCents: 500, withoutPrice: 2, cartWithoutPrice: 1, pendingWithoutPrice: 1 });
  });
});

describe('parsePriceInput', () => {
  it.each([['42,90', 4290], ['42.9', 4290], ['1.234,56', 123456], ['R$ 5', 500]])('%s', (t, c) => expect(parsePriceInput(t)).toBe(c));
  it.each(['', 'abc', '0', '-3'])('inválido: %s', (t) => expect(parsePriceInput(t)).toBeNull());
});

describe('reconcile', () => {
  const note = [
    { id: 'n1', rawDescription: 'FITA CREPE BRANCA 48MMx50M TEKBOND', unitPriceCents: 1290, quantity: 2 },
    { id: 'n2', rawDescription: 'TINTA STD ACR 20L', unitPriceCents: 37990, quantity: 1 },
    { id: 'n3', rawDescription: 'TRINCHA SIMPLES', unitPriceCents: 539, quantity: 1 },
  ];
  it('casa itens marcados, compara encontrado × pago e lista o que sobrou', () => {
    const r = reconcile(
      [
        { id: 'a', name: 'Fita crepe', foundPriceCents: 1590 },
        { id: 'b', name: 'Tinta' },
        { id: 'c', name: 'Leite' },
      ],
      note,
    );
    expect(r.matched.map((m) => m.listItem.id)).toEqual(['a', 'b']);
    expect(r.matched[0]).toMatchObject({ foundCents: 1590, paidCents: 1290, diffCents: -300 });
    expect(r.matched[1]!.diffCents).toBeUndefined();
    expect(r.unmatchedList.map((i) => i.id)).toEqual(['c']);
    expect(r.unmatchedNote.map((n) => n.id)).toEqual(['n3']);
  });
  it('cada item da nota casa uma só vez; nome mais específico tem prioridade', () => {
    const r = reconcile([{ id: 'x', name: 'Fita' }, { id: 'y', name: 'Fita crepe' }], note);
    expect(r.matched.map((m) => m.listItem.id)).toEqual(['x', 'y'].filter((id) => id === 'y'));
    expect(r.unmatchedList.map((i) => i.id)).toEqual(['x']);
  });
});
