import { parsePackage, packageTotal, baseUnitLabel, type BaseUnit } from '../prices/packageSize';
import type { PriceStats } from '../prices/priceMatch';

/**
 * Lógica pura do Modo compras: comparação do preço encontrado com o histórico e
 * total estimado. Tudo em centavos inteiros.
 */

export const NEAR_AVG_PCT = 5;

export type CompareStatus = 'acima' | 'abaixo' | 'media' | 'sem';

export interface PriceComparison {
  status: CompareStatus;
  /** Diferença percentual arredondada (positivo = acima da média). */
  pct: number;
  /** Base da comparação: por kg, por L, por unidade de venda... */
  basis: 'kg' | 'l' | 'un' | 'unit';
  foundCents?: number;
  avgCents?: number;
  icon: string;
  text: string;
  /** Dica quando não há comparação. */
  hint?: string;
}

export interface ListLike {
  name: string;
  unit: string;
  quantity: number;
  checked: boolean;
  foundPriceCents?: number | null;
}

const SEM: PriceComparison = { status: 'sem', pct: 0, basis: 'unit', icon: '–', text: 'sem comparação' };

function build(found: number, avg: number, basis: PriceComparison['basis']): PriceComparison {
  if (!(avg > 0) || !(found >= 0)) return SEM;
  const pct = Math.round(((found - avg) / avg) * 100);
  const base = { pct, basis, foundCents: found, avgCents: avg };
  // Status e texto usam o MESMO valor arredondado (5,4% = "na média").
  if (pct > NEAR_AVG_PCT) return { ...base, status: 'acima', icon: '▲', text: `acima do preço médio (+${pct}%)` };
  if (pct < -NEAR_AVG_PCT) return { ...base, status: 'abaixo', icon: '▼', text: `abaixo do preço médio (${pct}%)` };
  return { ...base, status: 'media', icon: '●', text: `na média (±${NEAR_AVG_PCT}%)` };
}

/**
 * Compara o preço encontrado (por unidade de venda do item) com o histórico.
 * 1) Se o NOME do item traz embalagem ("Sabão líquido 3L") e o histórico tem preço
 *    normalizado na mesma unidade-base, compara por R$/kg|L.
 * 2) Senão, compara o unitário se a unidade do item é a mesma do histórico.
 * 3) Senão: "sem comparação".
 */
export function comparePrice(item: Pick<ListLike, 'name' | 'unit' | 'foundPriceCents'>, stats: PriceStats | null | undefined): PriceComparison {
  const found = item.foundPriceCents;
  if (found == null || !stats) return SEM;
  const pkg = parsePackage(item.name);
  if (pkg && stats.normalizedLast && stats.normalizedAvg !== undefined && stats.normalizedLast.unit === pkg.unit) {
    const total = packageTotal(pkg);
    if (total > 0) return build(found / total, stats.normalizedAvg, pkg.unit);
  }
  // Fallback por unidade de venda: só quando o histórico não mistura tamanhos de embalagem.
  if (item.unit === stats.last.unit) {
    if (historyUniform(stats)) return build(found, stats.avgUnitCents, 'unit');
    return { ...SEM, hint: 'Histórico com embalagens de tamanhos diferentes: inclua o tamanho no nome (ex.: 3L).' };
  }
  return SEM;
}

/** Chave do tamanho de embalagem de uma descrição ('none' se não reconhecida). */
function sizeKey(desc: string): string {
  const p = parsePackage(desc);
  return p ? `${p.unit}:${Math.round(packageTotal(p) * 1e6)}` : 'none';
}

/** Todas as compras (na unidade da última) têm o mesmo tamanho de embalagem? */
export function historyUniform(stats: PriceStats): boolean {
  const keys = new Set(stats.matches.filter((m) => m.unit === stats.last.unit).map((m) => sizeKey(m.rawDescription)));
  return keys.size <= 1;
}

/** Texto do tipo "R$/kg" para a base da comparação. */
export function basisLabel(b: PriceComparison['basis']): string {
  return b === 'unit' ? 'unidade' : baseUnitLabel(b as BaseUnit);
}

export interface TotalEstimate {
  cartCents: number;
  pendingCents: number;
  totalCents: number;
  /** Itens sem preço (nem encontrado, nem histórico comparável). */
  withoutPrice: number;
  cartWithoutPrice: number;
  pendingWithoutPrice: number;
}

/** Preço usado na estimativa: encontrado, ou último pago se a unidade for a mesma do item. */
export function estimatedUnitPrice(item: ListLike, stats: PriceStats | null | undefined): number | null {
  if (item.foundPriceCents != null) return item.foundPriceCents;
  if (!stats) return null;
  // Nome com embalagem ("Sabão 3L"): usa o último R$/kg|L normalizado × tamanho do item.
  const pkg = parsePackage(item.name);
  if (pkg) {
    if (stats.normalizedLast && stats.normalizedLast.unit === pkg.unit) return Math.round(stats.normalizedLast.cents * packageTotal(pkg));
    return null;
  }
  // Sem tamanho no nome: só usa o último preço se o histórico não mistura embalagens.
  if (stats.last.unit === item.unit && historyUniform(stats)) return stats.last.unitPriceCents;
  return null;
}

export function estimateTotal(items: ListLike[], statsOf: (i: ListLike) => PriceStats | null | undefined): TotalEstimate {
  const t: TotalEstimate = { cartCents: 0, pendingCents: 0, totalCents: 0, withoutPrice: 0, cartWithoutPrice: 0, pendingWithoutPrice: 0 };
  for (const i of items) {
    const p = estimatedUnitPrice(i, statsOf(i));
    if (p === null) {
      t.withoutPrice++;
      if (i.checked) t.cartWithoutPrice++;
      else t.pendingWithoutPrice++;
      continue;
    }
    const line = Math.round(p * i.quantity);
    if (i.checked) t.cartCents += line;
    else t.pendingCents += line;
  }
  t.totalCents = t.cartCents + t.pendingCents;
  return t;
}

/** "42,90" / "1.234,56" / "42.9" -> centavos; vazio, zero ou inválido -> null. */
export function parsePriceInput(text: string): number | null {
  if (text.includes('-')) return null;
  let t = text.replace(/[^\d.,]/g, '');
  if (!t) return null;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  const n = Number(t);
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  return Math.round(n * 100);
}

export function centsToInput(c: number): string {
  return (c / 100).toFixed(2).replace('.', ',');
}
