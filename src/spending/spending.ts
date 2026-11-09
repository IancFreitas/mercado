/**
 * Gastos: totais por mês, loja e categoria a partir das compras da Casa.
 * Funções puras (exceto `loadCategoryLines`, que lê o banco local).
 * Valores em centavos; meses e datas no fuso America/Sao_Paulo.
 */
import type { Category, Purchase, PurchaseItem } from '../domain/types';
import { normalizeName } from '../domain/text';
import type { PantryRepo } from '../db/repo';
import { productIdFor, productKey } from '../pantry/pantry';

export const TIMEZONE = 'America/Sao_Paulo';
export const NO_CATEGORY = 'Sem categoria';

const MONTH_FMT = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit' });

/** 'YYYY-MM' do instante, no fuso de São Paulo (null se a data for inválida). */
export function monthKey(iso: string | Date): string | null {
  const d = typeof iso === 'string' ? new Date(iso) : iso;
  if (Number.isNaN(d.getTime())) return null;
  const parts = MONTH_FMT.formatToParts(d);
  const y = parts.find((p) => p.type === 'year')?.value;
  const m = parts.find((p) => p.type === 'month')?.value;
  return y && m ? `${y}-${m}` : null;
}

export function currentMonthKey(now: Date = new Date()): string {
  return monthKey(now)!;
}

export function prevMonthKey(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

const MONTH_NAMES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number) as [number, number];
  return `${MONTH_NAMES[m - 1]} de ${y}`;
}

/** Compras que entram nos gastos: da Casa, não excluídas e com total > 0. */
export function spendingPurchases(householdId: string, purchases: Purchase[]): Purchase[] {
  return purchases.filter((p) => p.householdId === householdId && !p.deleted && Number.isFinite(p.totalCents) && p.totalCents > 0);
}

export function inMonth(purchases: Purchase[], month: string): Purchase[] {
  return purchases
    .filter((p) => monthKey(p.purchasedAt) === month)
    .sort((a, b) => (a.purchasedAt < b.purchasedAt ? 1 : a.purchasedAt > b.purchasedAt ? -1 : a.id < b.id ? -1 : 1));
}

export function sumCents(purchases: Purchase[]): number {
  return purchases.reduce((s, p) => s + p.totalCents, 0);
}

/** Meses com compras + o mês atual, do mais novo para o mais antigo. */
export function availableMonths(purchases: Purchase[], current: string): string[] {
  const set = new Set<string>([current]);
  for (const p of purchases) {
    const k = monthKey(p.purchasedAt);
    if (k) set.add(k);
  }
  return [...set].sort().reverse();
}

/** Variação % sobre o mês anterior; só existe se os dois totais forem > 0. */
export function changePct(currentCents: number, previousCents: number): number | null {
  if (!(currentCents > 0) || !(previousCents > 0)) return null;
  return Math.round(((currentCents - previousCents) / previousCents) * 1000) / 10;
}

export interface MonthSummary {
  month: string;
  totalCents: number;
  count: number;
  previousCents: number;
  changePct: number | null;
}

export function summarizeMonth(purchases: Purchase[], month: string): MonthSummary {
  const cur = inMonth(purchases, month);
  const previousCents = sumCents(inMonth(purchases, prevMonthKey(month)));
  const totalCents = sumCents(cur);
  return { month, totalCents, count: cur.length, previousCents, changePct: changePct(totalCents, previousCents) };
}

export interface StoreTotal {
  /** CNPJ só dígitos; null = emitente desconhecido. */
  cnpj: string | null;
  totalCents: number;
  count: number;
}

export function byStore(purchases: Purchase[], month: string): StoreTotal[] {
  const m = new Map<string, StoreTotal>();
  for (const p of inMonth(purchases, month)) {
    const k = p.issuerCnpj || '';
    const cur = m.get(k) ?? { cnpj: k || null, totalCents: 0, count: 0 };
    cur.totalCents += p.totalCents;
    cur.count++;
    m.set(k, cur);
  }
  return [...m.values()].sort((a, b) => b.totalCents - a.totalCents || String(a.cnpj).localeCompare(String(b.cnpj)));
}

/** Linha de item já resolvida para categoria (null = sem produto ligado). */
export interface CategoryLine {
  purchaseId: string;
  totalCents: number;
  category: Category | null;
}

export interface CategoryTotal {
  category: Category | typeof NO_CATEGORY;
  totalCents: number;
}

/** Soma dos itens por categoria nas compras do mês. Descontos/acréscimos da nota NÃO entram aqui. */
export function byCategory(lines: CategoryLine[], monthPurchases: Purchase[]): CategoryTotal[] {
  const ids = new Set(monthPurchases.map((p) => p.id));
  const m = new Map<string, number>();
  for (const l of lines) {
    if (!ids.has(l.purchaseId)) continue;
    const k = l.category ?? NO_CATEGORY;
    m.set(k, (m.get(k) ?? 0) + l.totalCents);
  }
  return [...m.entries()]
    .map(([category, totalCents]) => ({ category: category as CategoryTotal['category'], totalCents }))
    .sort((a, b) => b.totalCents - a.totalCents || a.category.localeCompare(b.category));
}

/**
 * Liga cada item à categoria do produto pela chave da descrição (id determinístico do
 * produto da nota, ou produto cadastrado à mão com o mesmo nome). Sem produto → null.
 */
export async function loadCategoryLines(repo: PantryRepo, householdId: string, purchases: Purchase[]): Promise<CategoryLine[]> {
  const ids = new Set(purchases.map((p) => p.id));
  if (ids.size === 0) return [];
  const [items, products] = await Promise.all([
    repo.db.purchaseItems.where('householdId').equals(householdId).toArray() as Promise<PurchaseItem[]>,
    repo.db.products.where('householdId').equals(householdId).toArray(),
  ]);
  const live = products.filter((p) => !p.deleted);
  const byId = new Map(live.map((p) => [p.id, p.category]));
  const byName = new Map(live.map((p) => [normalizeName(p.name), p.category]));
  const cache = new Map<string, Category | null>();
  const out: CategoryLine[] = [];
  for (const it of items) {
    if (it.deleted || !ids.has(it.purchaseId)) continue;
    const key = productKey(it.rawDescription);
    let cat = cache.get(key);
    if (cat === undefined) {
      cat = (key ? (byId.get(await productIdFor(householdId, key)) ?? byName.get(key)) : undefined) ?? null;
      cache.set(key, cat);
    }
    out.push({ purchaseId: it.purchaseId, totalCents: it.totalCents, category: cat });
  }
  return out;
}
