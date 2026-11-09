/**
 * Sugestões de reposição (Fase 3). Parte pura (`computeSuggestions`) + ações sobre o repositório.
 * Tudo local; escritas via engine.mutate (sincronizáveis, LWW por campo).
 */
import type { InventoryMovement, Product, ShoppingListItem, Unit } from '../domain/types';
import { normalizeName } from '../domain/text';
import type { PantryRepo } from '../db/repo';
import { forecastConsumption, type Forecast } from './consumption';

export const SOON_DAYS = 7;
export const SNOOZE_DAYS = 7;

export interface Suggestion {
  product: Product;
  forecast: Forecast;
  quantity: number;
  unit: Unit;
}

/** Previsão ligada? Produtos antigos têm `false` só por padrão; o usuário precisa ter mexido para valer. */
export function predictionOn(p: Pick<Product, 'predictionEnabled' | 'predictionSetByUser'>): boolean {
  return p.predictionSetByUser ? p.predictionEnabled !== false : true;
}

export function isSnoozed(p: Pick<Product, 'snoozedUntil'>, now: number): boolean {
  const t = p.snoozedUntil ? Date.parse(p.snoozedUntil) : NaN;
  return Number.isFinite(t) && t > now;
}

/** Este produto já está na lista (mesmo productId ou mesmo nome normalizado; inclui itens no carrinho)? */
export function onList(p: Product, items: Pick<ShoppingListItem, 'productId' | 'normName' | 'deleted'>[]): boolean {
  const key = normalizeName(p.name);
  return items.some((i) => !i.deleted && (i.productId === p.id || i.normName === key));
}

export function computeSuggestions(input: {
  householdId: string;
  products: Product[];
  movements: InventoryMovement[];
  listItems: ShoppingListItem[];
  now: number;
}): Suggestion[] {
  const { householdId, now } = input;
  const byProduct = new Map<string, InventoryMovement[]>();
  for (const m of input.movements) {
    if (m.householdId !== householdId || m.deleted) continue;
    const g = byProduct.get(m.productId) ?? [];
    g.push(m);
    byProduct.set(m.productId, g);
  }
  const out: Suggestion[] = [];
  for (const p of input.products) {
    if (p.householdId !== householdId || p.deleted || !predictionOn(p) || isSnoozed(p, now)) continue;
    if (onList(p, input.listItems)) continue;
    const ms = byProduct.get(p.id);
    if (!ms) continue;
    const forecast = forecastConsumption(ms, now, { unit: p.unit });
    if (forecast.status !== 'ok') continue;
    if (!((forecast.stockEstimate ?? 1) <= 0 || (forecast.daysLeft ?? Infinity) <= SOON_DAYS)) continue;
    out.push({ product: p, forecast, quantity: forecast.typicalQty && forecast.typicalQty > 0 ? forecast.typicalQty : 1, unit: p.unit ?? ms[0]!.unit });
  }
  return out.sort((a, b) => a.forecast.daysLeft! - b.forecast.daysLeft! || a.product.name.localeCompare(b.product.name, 'pt-BR'));
}

/** Lê os dados da Casa e monta as sugestões atuais. */
export async function loadSuggestions(repo: PantryRepo, hid: string, now = Date.now()): Promise<Suggestion[]> {
  const list = await repo.getDefaultList(hid);
  const [products, movements, listItems] = await Promise.all([
    repo.db.products.where('householdId').equals(hid).toArray(),
    repo.db.inventoryMovements.where('householdId').equals(hid).toArray(),
    list ? repo.listItems(hid, list.id) : Promise.resolve([] as ShoppingListItem[]),
  ]);
  return computeSuggestions({ householdId: hid, products, movements, listItems, now });
}

async function requireProduct(repo: PantryRepo, hid: string, productId: string): Promise<Product> {
  const p = await repo.db.products.get(productId);
  if (!p || p.householdId !== hid || p.deleted) throw new Error('Produto não encontrado nesta Casa');
  return p;
}

/** Previsão de um produto (detalhe da Despensa). */
export async function forecastProduct(repo: PantryRepo, hid: string, productId: string, now = Date.now()): Promise<Forecast> {
  const p = await requireProduct(repo, hid, productId);
  const ms = (await repo.db.inventoryMovements.where('productId').equals(productId).toArray()).filter((m) => m.householdId === hid && !m.deleted);
  return forecastConsumption(ms, now, { unit: p.unit });
}

/** "Adicionar": põe na lista (origem 'sugestao') sem duplicar. */
export async function addSuggestion(repo: PantryRepo, hid: string, productId: string, quantity: number): Promise<{ added: boolean }> {
  const p = await requireProduct(repo, hid, productId);
  const list = await repo.getDefaultList(hid);
  if (!list) throw new Error('Lista de compras não encontrada');
  if (onList(p, await repo.listItems(hid, list.id))) return { added: false };
  await repo.addItem(hid, list.id, { name: p.name, quantity, unit: p.unit ?? 'un', category: p.category, source: 'sugestao', productId: p.id });
  return { added: true };
}

/** "Adiar": some das sugestões por `days` dias. */
export async function snoozeSuggestion(repo: PantryRepo, hid: string, productId: string, days = SNOOZE_DAYS, now = Date.now()): Promise<Product> {
  await requireProduct(repo, hid, productId);
  return repo.engine.mutate<Product>(hid, 'products', productId, { snoozedUntil: new Date(now + days * 86_400_000).toISOString() });
}

/** Liga/desliga a previsão do produto ("Não sugerir mais" = false; reversível). */
export async function setPredictionEnabled(repo: PantryRepo, hid: string, productId: string, enabled: boolean): Promise<Product> {
  await requireProduct(repo, hid, productId);
  const fields: Record<string, unknown> = { predictionEnabled: enabled, predictionSetByUser: true };
  if (enabled) fields.snoozedUntil = '';
  return repo.engine.mutate<Product>(hid, 'products', productId, fields);
}

/** "acaba em ~3 dias" / "provavelmente já acabou" — texto (não depende só de cor). */
export function timingLabel(f: Pick<Forecast, 'stockEstimate' | 'daysLeft'>): string {
  if ((f.stockEstimate ?? 1) <= 0 || (f.daysLeft ?? 1) <= 0) return 'provavelmente já acabou';
  const d = Math.max(1, Math.ceil(f.daysLeft ?? 1));
  return d === 1 ? 'acaba em ~1 dia' : `acaba em ~${d} dias`;
}
