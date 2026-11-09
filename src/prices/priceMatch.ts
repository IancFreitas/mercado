import { normalizeName } from '../domain/text';
import type { Unit } from '../domain/types';

/**
 * Associação entre itens da lista de compras ("Tinta") e descrições de notas
 * fiscais ("TINTA STD ACR FSC RD E COBRE BR 20L SV"). Funções puras.
 */

const STOPWORDS = new Set(['de', 'da', 'do', 'das', 'dos', 'com', 'sem', 'para', 'e']);

/**
 * Abreviações comuns de NFC-e (mantenha curto). Tokens da nota que aparecem aqui
 * valem SOMENTE pela forma expandida, para "sab" não casar com "sabonete".
 */
const ABBREVIATIONS: Record<string, string> = {
  lqd: 'liquido',
  integ: 'integral',
  sab: 'sabao',
  det: 'detergente',
  amac: 'amaciante',
  refri: 'refrigerante',
  desinf: 'desinfetante',
};

const MIN_LEN = 3;
const isNumeric = (t: string) => /^\d/.test(t);

function tokens(s: string): string[] {
  return normalizeName(s).split(' ').filter(Boolean);
}

/** Token da lista (palavra) casa com token da nota? Prefixo nas duas direções. */
function wordMatches(l: string, d: string): boolean {
  const full = ABBREVIATIONS[d];
  const cand = full ?? d;
  if (cand === l) return true;
  // abreviação da nota ("acr" para "acrilica")
  if (cand.length >= MIN_LEN && l.startsWith(cand)) return true;
  // nota mais longa que a lista ("lixa" -> "lixadeira"): só com ≥ 4 letras na lista, para "sal" não casar "salsicha"
  return l.length >= MIN_LEN + 1 && cand.startsWith(l);
}

export function matchesListItem(listName: string, rawDescription: string): boolean {
  const lt = tokens(listName).filter((t) => !STOPWORDS.has(t));
  const words = lt.filter((t) => !isNumeric(t) && t.length >= MIN_LEN);
  if (words.length === 0) return false;
  const nums = lt.filter(isNumeric);
  const dt = tokens(rawDescription);
  const dWords = dt.filter((t) => !isNumeric(t) && t.length >= MIN_LEN);
  if (!words.every((l) => dWords.some((d) => wordMatches(l, d)))) return false;
  return nums.every((n) => dt.includes(n));
}

export interface PriceEntry {
  rawDescription: string;
  unit: Unit;
  unitPriceCents: number;
  quantity: number;
  purchasedAt: string;
  storeCnpj?: string;
  purchaseId: string;
}

export interface PriceStats {
  /** Quantas compras (com a mesma unidade da última) entram em médio/mínimo. */
  count: number;
  last: Pick<PriceEntry, 'unitPriceCents' | 'unit' | 'purchasedAt' | 'storeCnpj' | 'rawDescription'>;
  avgUnitCents: number;
  minUnitCents: number;
  /** Todas as compras associadas, da mais recente para a mais antiga (unidades podem variar). */
  matches: PriceEntry[];
}

export function priceStatsFor(listName: string, entries: PriceEntry[]): PriceStats | null {
  const matches = entries
    .filter((e) => matchesListItem(listName, e.rawDescription))
    .sort((a, b) => (a.purchasedAt < b.purchasedAt ? 1 : a.purchasedAt > b.purchasedAt ? -1 : a.purchaseId < b.purchaseId ? -1 : 1));
  const first = matches[0];
  if (!first) return null;
  const same = matches.filter((m) => m.unit === first.unit);
  const prices = same.map((m) => m.unitPriceCents);
  return {
    count: same.length,
    last: {
      unitPriceCents: first.unitPriceCents,
      unit: first.unit,
      purchasedAt: first.purchasedAt,
      storeCnpj: first.storeCnpj,
      rawDescription: first.rawDescription,
    },
    avgUnitCents: Math.round(prices.reduce((s, p) => s + p, 0) / prices.length),
    minUnitCents: Math.min(...prices),
    matches,
  };
}
