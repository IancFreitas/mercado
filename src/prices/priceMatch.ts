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

/** Token da lista (palavra) casa com token da nota? Prefixo nas duas direções + plural simples (-s). */
function wordMatches(l: string, d: string): boolean {
  const full = ABBREVIATIONS[d];
  const cand = full ?? d;
  if (cand === l) return true;
  // plural simples: "ovo" <-> "ovos"
  if (cand === l + 's' || (l.length > MIN_LEN && l === cand + 's')) return true;
  // abreviação da nota ("acr" para "acrilica")
  if (cand.length >= MIN_LEN && l.startsWith(cand)) return true;
  // nota mais longa que a lista ("lixa" -> "lixadeira"): só com ≥ 4 letras na lista, para "sal" não casar "salsicha"
  return l.length >= MIN_LEN + 1 && cand.startsWith(l);
}

interface ListTokens {
  words: string[];
  nums: string[];
}
function listTokens(listName: string): ListTokens {
  const lt = tokens(listName).filter((t) => !STOPWORDS.has(t));
  return { words: lt.filter((t) => !isNumeric(t) && t.length >= MIN_LEN), nums: lt.filter(isNumeric) };
}

/** Tokens de uma descrição de nota, pré-calculados (para não normalizar a cada item da lista). */
export interface DescTokens {
  all: string[];
  words: string[];
}
export function descTokens(rawDescription: string): DescTokens {
  const all = tokens(rawDescription);
  return { all, words: all.filter((t) => !isNumeric(t) && t.length >= MIN_LEN) };
}

function matchTokens(l: ListTokens, d: DescTokens): boolean {
  if (l.words.length === 0) return false;
  if (!l.words.every((w) => d.words.some((x) => wordMatches(w, x)))) return false;
  return l.nums.every((n) => d.all.includes(n));
}

export function matchesListItem(listName: string, rawDescription: string): boolean {
  return matchTokens(listTokens(listName), descTokens(rawDescription));
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

export interface PreparedEntry {
  entry: PriceEntry;
  tokens: DescTokens;
}

/** Pré-tokeniza as linhas uma vez por mudança dos dados (descrições repetidas são tokenizadas uma só vez). */
export function prepareEntries(entries: PriceEntry[]): PreparedEntry[] {
  const cache = new Map<string, DescTokens>();
  return entries.map((entry) => {
    let tokens = cache.get(entry.rawDescription);
    if (!tokens) cache.set(entry.rawDescription, (tokens = descTokens(entry.rawDescription)));
    return { entry, tokens };
  });
}

const newestFirst = (a: PriceEntry, b: PriceEntry) =>
  a.purchasedAt !== b.purchasedAt ? (a.purchasedAt < b.purchasedAt ? 1 : -1) : a.purchaseId < b.purchaseId ? -1 : a.purchaseId > b.purchaseId ? 1 : 0;

export function priceStatsPrepared(listName: string, prepared: PreparedEntry[]): PriceStats | null {
  const lt = listTokens(listName);
  const matches = prepared.filter((p) => matchTokens(lt, p.tokens)).map((p) => p.entry).sort(newestFirst);
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

export function priceStatsFor(listName: string, entries: PriceEntry[]): PriceStats | null {
  return priceStatsPrepared(listName, prepareEntries(entries));
}
