/**
 * Despensa: produtos + estoque derivado de movimentações append-only.
 *
 * Decisão de projeto: o estoque NUNCA é um campo editável. A quantidade de um
 * produto é a SOMA das `inventoryMovements` dele. Assim, dois aparelhos que
 * registram "Usei 1" ao mesmo tempo (offline) geram dois movimentos distintos
 * e o estoque cai 2 — um campo `quantity` com LWW perderia uma das baixas.
 *
 * Estrutura: classe `PantryService` sobre o `PantryRepo` existente (reaproveita
 * engine/ator/relógio/lista padrão) em vez de acrescentar dezenas de métodos ao
 * repo.ts; a lógica de cálculo fica em funções puras exportadas (testáveis).
 */
import { CATEGORIES, type Category, type InventoryMovement, type MovementKind, type Product, type Unit } from '../domain/types';
import { normalizeName, sanitizeText } from '../domain/text';
import { uuidFromSeed, type PantryRepo } from '../db/repo';

const UNITS: Unit[] = ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'dz'];
const MAX_QTY = 99_999;

export const MOVEMENT_LABELS: Record<MovementKind, string> = {
  compra: 'Compra',
  consumo: 'Consumo',
  ajuste: 'Ajuste',
  esgotado: 'Acabou',
  descarte: 'Descarte',
  ainda_tem: 'Ainda tem',
};

/** Arredonda para 3 casas (kg fracionado), sem ruído de ponto flutuante. */
export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Chave de produto: descrição da nota normalizada (minúsculas, sem acento/pontuação). */
export function productKey(description: string): string {
  return normalizeName(description);
}

/** "TINTA STD ACR 20L" → "Tinta Std Acr 20L". Partes com dígitos ficam em maiúsculas. */
export function titleCase(description: string): string {
  const small = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'com', 'sem', 'para']);
  const words = sanitizeText(description, 80)
    .split(' ')
    .filter(Boolean)
    .map((w, i) => {
      if (/\d/.test(w)) return w.toUpperCase();
      const lower = w.toLocaleLowerCase('pt-BR');
      if (i > 0 && small.has(lower)) return lower;
      return lower.charAt(0).toLocaleUpperCase('pt-BR') + lower.slice(1);
    });
  return words.join(' ');
}

/** Id determinístico do produto vindo da nota: dois aparelhos convergem para o mesmo registro. */
export function productIdFor(householdId: string, key: string): Promise<string> {
  return uuidFromSeed(`product|${householdId}|${key}`);
}

/** Id determinístico do movimento 'compra' de um item da nota: repetir/duplicar não soma duas vezes. */
export function purchaseMovementIdFor(householdId: string, purchaseItemId: string): Promise<string> {
  return uuidFromSeed(`movement|compra|${householdId}|${purchaseItemId}`);
}

export interface StockRow {
  product: Product;
  /** Soma dos movimentos (pode ser ≤ 0 = acabou). */
  quantity: number;
  unit: Unit;
  /** Data da última 'compra' (da nota). */
  lastPurchaseAt?: string;
  lastMovementAt?: string;
  movementCount: number;
}

/** Soma dos deltas, em milésimos para não acumular erro de ponto flutuante. */
export function stockOf(movements: Pick<InventoryMovement, 'delta' | 'deleted'>[]): number {
  let milli = 0;
  for (const m of movements) if (!m.deleted && Number.isFinite(m.delta)) milli += Math.round(m.delta * 1000);
  return milli / 1000;
}

/** Estoque por produto da Casa. Só produtos com ao menos um movimento aparecem. Função pura. */
export function computeStock(householdId: string, products: Product[], movements: InventoryMovement[]): StockRow[] {
  const byProduct = new Map<string, InventoryMovement[]>();
  for (const m of movements) {
    if (m.householdId !== householdId || m.deleted) continue;
    const g = byProduct.get(m.productId) ?? [];
    g.push(m);
    byProduct.set(m.productId, g);
  }
  const rows: StockRow[] = [];
  for (const p of products) {
    if (p.householdId !== householdId || p.deleted) continue;
    const ms = byProduct.get(p.id);
    if (!ms || ms.length === 0) continue;
    const purchases = ms.filter((m) => m.kind === 'compra').map((m) => m.at);
    rows.push({
      product: p,
      quantity: stockOf(ms),
      unit: p.unit ?? ms[0]!.unit,
      lastPurchaseAt: purchases.length ? purchases.reduce((a, b) => (a > b ? a : b)) : undefined,
      lastMovementAt: ms.map((m) => m.at).reduce((a, b) => (a > b ? a : b)),
      movementCount: ms.length,
    });
  }
  return rows.sort((a, b) => a.product.name.localeCompare(b.product.name, 'pt-BR'));
}

export function splitStock(rows: StockRow[]): { inStock: StockRow[]; out: StockRow[] } {
  return { inStock: rows.filter((r) => r.quantity > 0), out: rows.filter((r) => r.quantity <= 0) };
}

export function groupByCategory(rows: StockRow[]): { category: Category; rows: StockRow[] }[] {
  return CATEGORIES.map((category) => ({ category, rows: rows.filter((r) => r.product.category === category) })).filter((g) => g.rows.length > 0);
}

export interface PantryAddResult {
  /** Produtos novos criados. */
  products: number;
  /** Movimentos 'compra' novos. */
  movements: number;
  /** Itens que já estavam na despensa (idempotência). */
  already: number;
  /** Itens ignorados (sem descrição, quantidade 0 ou unidade diferente da do produto). */
  ignored: number;
}

export class PantryService {
  constructor(readonly repo: PantryRepo) {}

  private get db() {
    return this.repo.db;
  }

  async listProducts(hid: string): Promise<Product[]> {
    return (await this.db.products.where('householdId').equals(hid).toArray()).filter((p) => !p.deleted);
  }

  async stockRows(hid: string): Promise<StockRow[]> {
    const [products, movements] = await Promise.all([
      this.listProducts(hid),
      this.db.inventoryMovements.where('householdId').equals(hid).toArray(),
    ]);
    return computeStock(hid, products, movements);
  }

  /** Histórico (auditoria): mais recente primeiro. */
  async movements(hid: string, productId: string): Promise<InventoryMovement[]> {
    const all = await this.db.inventoryMovements.where('productId').equals(productId).toArray();
    return all
      .filter((m) => m.householdId === hid && !m.deleted)
      .sort((a, b) => (a.at === b.at ? (a.id < b.id ? 1 : -1) : a.at < b.at ? 1 : -1));
  }

  async currentStock(hid: string, productId: string): Promise<number> {
    return stockOf(await this.movements(hid, productId));
  }

  private async requireProduct(hid: string, productId: string): Promise<Product> {
    const p = await this.db.products.get(productId);
    if (!p || p.householdId !== hid || p.deleted) throw new Error('Produto não encontrado nesta Casa');
    return p;
  }

  /** Produto da Casa para esta chave: o de id determinístico ou um cadastrado à mão com o mesmo nome. */
  async findProduct(hid: string, key: string): Promise<Product | undefined> {
    if (!key) return undefined;
    const det = await this.db.products.get(await productIdFor(hid, key));
    if (det && det.householdId === hid && !det.deleted) return det;
    return (await this.listProducts(hid)).find((p) => normalizeName(p.name) === key);
  }

  private async addMovement(
    hid: string,
    product: Product,
    kind: MovementKind,
    delta: number,
    extra: { id?: string; at?: string; purchaseItemId?: string; note?: string; unit?: Unit } = {},
  ): Promise<InventoryMovement> {
    if (!Number.isFinite(delta) || Math.abs(delta) > MAX_QTY) throw new Error('Quantidade inválida');
    const fields: Record<string, unknown> = {
      productId: product.id,
      kind,
      delta: round3(delta),
      unit: extra.unit ?? product.unit ?? 'un',
      at: extra.at ?? this.repo.nowIso(),
      by: this.repo.actorName(),
      deleted: false,
    };
    if (extra.purchaseItemId) fields.purchaseItemId = extra.purchaseItemId;
    if (extra.note) fields.note = sanitizeText(extra.note, 120);
    return this.repo.engine.mutate<InventoryMovement>(hid, 'inventoryMovements', extra.id ?? this.repo.uuid(), fields);
  }

  /**
   * Põe os produtos de uma nota IMPORTADA na despensa. Idempotente: produtos e movimentos
   * 'compra' têm id determinístico; rodar de novo (ou em outro aparelho) não duplica nada.
   */
  async addPurchaseToPantry(hid: string, purchaseId: string): Promise<PantryAddResult> {
    const purchase = await this.db.purchases.get(purchaseId);
    if (!purchase || purchase.householdId !== hid || purchase.deleted) throw new Error('Nota não encontrada nesta Casa');
    if (purchase.status !== 'importada') throw new Error('Importe os itens da nota antes de adicioná-los à despensa');
    const items = await this.repo.listPurchaseItems(hid, purchaseId);
    const result: PantryAddResult = { products: 0, movements: 0, already: 0, ignored: 0 };
    for (const it of items) {
      const key = productKey(it.rawDescription);
      if (!key || !(it.quantity > 0) || it.quantity > MAX_QTY) {
        result.ignored++;
        continue;
      }
      const movId = await purchaseMovementIdFor(hid, it.id);
      if (await this.db.inventoryMovements.get(movId)) {
        result.already++;
        continue;
      }
      let product = await this.findProduct(hid, key);
      if (product && product.unit && product.unit !== it.unit) {
        // Somar kg com un seria errado; o item fica de fora e é contado em "ignored".
        result.ignored++;
        continue;
      }
      if (!product) {
        product = await this.repo.engine.mutate<Product>(hid, 'products', await productIdFor(hid, key), {
          name: titleCase(it.rawDescription) || it.rawDescription.slice(0, 80),
          category: 'Outros',
          unit: it.unit,
          predictionEnabled: false,
          deleted: false,
        });
        result.products++;
      }
      await this.addMovement(hid, product, 'compra', it.quantity, {
        id: movId,
        at: purchase.purchasedAt,
        purchaseItemId: it.id,
        unit: it.unit,
      });
      result.movements++;
    }
    return result;
  }

  /** Produto manual (id uuid). Se já houver produto com o mesmo nome, soma nele em vez de duplicar. */
  async addManual(
    hid: string,
    input: { name: string; quantity: number; unit?: Unit; category?: Category },
  ): Promise<{ product: Product; created: boolean }> {
    const name = sanitizeText(input.name, 80);
    const key = productKey(name);
    if (!key) throw new Error('Informe o nome do produto');
    if (!(input.quantity > 0) || input.quantity > MAX_QTY) throw new Error('Informe a quantidade');
    let product = await this.findProduct(hid, key);
    let created = false;
    if (!product) {
      const unit = input.unit && UNITS.includes(input.unit) ? input.unit : 'un';
      const category = input.category && CATEGORIES.includes(input.category) ? input.category : 'Outros';
      product = await this.repo.engine.mutate<Product>(hid, 'products', this.repo.uuid(), {
        name,
        category,
        unit,
        predictionEnabled: false,
        deleted: false,
      });
      created = true;
    }
    await this.addMovement(hid, product, 'ajuste', input.quantity, { note: 'Adicionado manualmente' });
    return { product, created };
  }

  /** "Usei 1": baixa até `amount`, sem passar do que há em estoque. */
  async consume(hid: string, productId: string, amount = 1): Promise<InventoryMovement> {
    const p = await this.requireProduct(hid, productId);
    if (!(amount > 0)) throw new Error('Quantidade inválida');
    const have = await this.currentStock(hid, productId);
    const take = Math.min(amount, Math.max(have, 0));
    if (take <= 0) throw new Error('Este produto já está sem estoque');
    return this.addMovement(hid, p, 'consumo', -take);
  }

  /** "Acabou": zera o estoque conhecido (delta = −atual). */
  async markOut(hid: string, productId: string): Promise<InventoryMovement> {
    const p = await this.requireProduct(hid, productId);
    const have = await this.currentStock(hid, productId);
    return this.addMovement(hid, p, 'esgotado', have > 0 ? -have : 0);
  }

  /** "Ainda tem": apenas registra (delta 0) que foi conferido. */
  async stillHave(hid: string, productId: string): Promise<InventoryMovement> {
    const p = await this.requireProduct(hid, productId);
    return this.addMovement(hid, p, 'ainda_tem', 0);
  }

  async discard(hid: string, productId: string, amount = 1, note?: string): Promise<InventoryMovement> {
    const p = await this.requireProduct(hid, productId);
    const have = await this.currentStock(hid, productId);
    const take = Math.min(amount, Math.max(have, 0));
    if (!(take > 0)) throw new Error('Este produto já está sem estoque');
    return this.addMovement(hid, p, 'descarte', -take, { note });
  }

  /** Corrige o estoque até o valor informado (gera 'ajuste' com a diferença). */
  async adjustTo(hid: string, productId: string, target: number): Promise<InventoryMovement | null> {
    const p = await this.requireProduct(hid, productId);
    if (!Number.isFinite(target) || target < 0 || target > MAX_QTY) throw new Error('Quantidade inválida');
    const have = await this.currentStock(hid, productId);
    const delta = round3(round3(target) - have);
    if (delta === 0) return null;
    return this.addMovement(hid, p, 'ajuste', delta, { note: `Ajuste de ${have} para ${round3(target)}` });
  }

  async editProduct(hid: string, productId: string, changes: { name?: string; category?: Category }): Promise<Product> {
    await this.requireProduct(hid, productId);
    const fields: Record<string, unknown> = {};
    if (changes.name !== undefined) {
      const n = sanitizeText(changes.name, 80);
      if (!n) throw new Error('Nome obrigatório');
      fields.name = n;
    }
    if (changes.category !== undefined) {
      if (!CATEGORIES.includes(changes.category)) throw new Error('Categoria inválida');
      fields.category = changes.category;
    }
    if (Object.keys(fields).length === 0) return this.requireProduct(hid, productId);
    return this.repo.engine.mutate<Product>(hid, 'products', productId, fields);
  }

  /** Põe o produto na lista padrão, sem duplicar (já há item pendente com o mesmo nome → não faz nada). */
  async putOnList(hid: string, productId: string): Promise<{ added: boolean }> {
    const p = await this.requireProduct(hid, productId);
    const list = await this.repo.getDefaultList(hid);
    if (!list) throw new Error('Lista de compras não encontrada');
    const key = normalizeName(p.name);
    const dup = (await this.repo.listItems(hid, list.id)).some((i) => !i.checked && i.normName === key);
    if (dup) return { added: false };
    await this.repo.addItem(hid, list.id, { name: p.name, quantity: 1, unit: p.unit ?? 'un', category: p.category, source: 'sugestao' });
    return { added: true };
  }
}

const cache = new WeakMap<PantryRepo, PantryService>();
/** Uma instância por repositório (a UI usa `pantryFor(s.repo)`). */
export function pantryFor(repo: PantryRepo): PantryService {
  let s = cache.get(repo);
  if (!s) {
    s = new PantryService(repo);
    cache.set(repo, s);
  }
  return s;
}
