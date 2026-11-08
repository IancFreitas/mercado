/**
 * Operações de domínio da Fase 1 (Casa + lista de compras compartilhada).
 * Toda escrita passa por SyncEngine.mutate → gera operação sincronizável.
 */
import {
  CATEGORIES,
  type Category,
  type Household,
  type Priority,
  type ShoppingList,
  type ShoppingListItem,
  type Unit,
} from '../domain/types';
import { normalizeName, sanitizeText } from '../domain/text';
import type { SyncEngine } from '../sync/engine';
import type { NfceQr } from '../nfce/qrcode';
import type { Purchase, PurchaseItem } from '../domain/types';
import type { ParsedNfce } from '../nfce/parseSefazText';

/**
 * Id determinístico (formato UUID) a partir de Casa + chave de acesso: a mesma
 * nota escaneada em dois aparelhos (mesmo offline) vira o MESMO registro.
 */
export async function purchaseIdFor(householdId: string, accessKey: string): Promise<string> {
  return uuidFromSeed(`purchase|${householdId}|${accessKey}`);
}

/** Id determinístico de um item da nota: mesma nota + mesmo índice = mesmo registro em qualquer aparelho. */
export async function purchaseItemIdFor(householdId: string, purchaseId: string, index: number): Promise<string> {
  return uuidFromSeed(`purchaseItem|${householdId}|${purchaseId}|${index}`);
}

async function uuidFromSeed(seed: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(seed));
  const h = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const UNITS: Unit[] = ['un', 'kg', 'g', 'l', 'ml', 'pct', 'cx', 'dz'];

export interface NewItemInput {
  name: string;
  quantity?: number;
  unit?: Unit;
  category?: Category;
  priority?: Priority;
  source?: ShoppingListItem['source'];
}

export class PantryRepo {
  constructor(
    readonly engine: SyncEngine,
    private readonly actorName: () => string,
    private readonly nowIso: () => string = () => new Date().toISOString(),
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}

  get db() {
    return this.engine.db;
  }

  /** Cria uma Casa local com uma lista padrão. Retorna o id da Casa. */
  async createHousehold(name: string, id = this.uuid()): Promise<{ household: Household; list: ShoppingList }> {
    const clean = sanitizeText(name, 60) || 'Minha Casa';
    const household = await this.engine.mutate<Household>(id, 'households', id, {
      name: clean,
      createdAt: this.nowIso(),
    });
    const list = await this.engine.mutate<ShoppingList>(id, 'shoppingLists', this.uuid(), {
      name: 'Lista de compras',
      createdAt: this.nowIso(),
    });
    return { household, list };
  }

  async renameHousehold(householdId: string, name: string): Promise<void> {
    const clean = sanitizeText(name, 60);
    if (!clean) throw new Error('Nome obrigatório');
    await this.engine.mutate(householdId, 'households', householdId, { name: clean });
  }

  async getDefaultList(householdId: string): Promise<ShoppingList | undefined> {
    const lists = await this.db.shoppingLists.where('householdId').equals(householdId).toArray();
    // Determinístico: se duas listas foram criadas offline, a de menor id é a padrão.
    return lists.filter((l) => !l.deleted).sort((a, b) => (a.id < b.id ? -1 : 1))[0];
  }

  async listItems(householdId: string, listId: string, includeDeleted = false): Promise<ShoppingListItem[]> {
    const items = await this.db.shoppingListItems.where('listId').equals(listId).toArray();
    return items.filter((i) => i.householdId === householdId && (includeDeleted || !i.deleted));
  }

  /**
   * Adiciona item. Se já houver item pendente (não marcado) com o mesmo nome
   * normalizado, soma a quantidade em vez de duplicar.
   */
  async addItem(householdId: string, listId: string, input: NewItemInput): Promise<{ item: ShoppingListItem; merged: boolean }> {
    const name = sanitizeText(input.name, 80);
    if (!name) throw new Error('Informe o nome do item');
    const quantity = clampQty(input.quantity ?? 1);
    const unit = input.unit && UNITS.includes(input.unit) ? input.unit : 'un';
    const category = input.category && CATEGORIES.includes(input.category) ? input.category : 'Outros';
    const priority: Priority = input.priority ?? 'normal';
    const normName = normalizeName(name);
    const existing = (await this.listItems(householdId, listId)).find(
      (i) => i.normName === normName && !i.checked && i.unit === unit,
    );
    if (existing) {
      const item = await this.engine.mutate<ShoppingListItem>(householdId, 'shoppingListItems', existing.id, {
        quantity: clampQty(existing.quantity + quantity),
        updatedBy: this.actorName(),
      });
      return { item, merged: true };
    }
    const item = await this.engine.mutate<ShoppingListItem>(householdId, 'shoppingListItems', this.uuid(), {
      listId,
      name,
      normName,
      quantity,
      unit,
      category,
      priority,
      checked: false,
      source: input.source ?? 'manual',
      createdAt: this.nowIso(),
      createdBy: this.actorName(),
      updatedBy: this.actorName(),
      deleted: false,
    });
    return { item, merged: false };
  }

  async updateItem(
    householdId: string,
    itemId: string,
    changes: Partial<Pick<ShoppingListItem, 'name' | 'quantity' | 'unit' | 'category' | 'priority' | 'checked' | 'foundPriceCents'>>,
  ): Promise<ShoppingListItem> {
    const fields: Record<string, unknown> = { updatedBy: this.actorName() };
    if (changes.name !== undefined) {
      const n = sanitizeText(changes.name, 80);
      if (!n) throw new Error('Nome obrigatório');
      fields.name = n;
      fields.normName = normalizeName(n);
    }
    if (changes.quantity !== undefined) fields.quantity = clampQty(changes.quantity);
    if (changes.unit !== undefined && UNITS.includes(changes.unit)) fields.unit = changes.unit;
    if (changes.category !== undefined && CATEGORIES.includes(changes.category)) fields.category = changes.category;
    if (changes.priority !== undefined) fields.priority = changes.priority;
    if (changes.checked !== undefined) fields.checked = !!changes.checked;
    if (changes.foundPriceCents !== undefined) {
      const c = Math.round(changes.foundPriceCents);
      if (c < 0 || c > 10_000_000) throw new Error('Preço inválido');
      fields.foundPriceCents = c;
    }
    return this.engine.mutate<ShoppingListItem>(householdId, 'shoppingListItems', itemId, fields);
  }

  async removeItem(householdId: string, itemId: string): Promise<void> {
    await this.engine.mutate(householdId, 'shoppingListItems', itemId, { deleted: true, updatedBy: this.actorName() });
  }

  async restoreItem(householdId: string, itemId: string): Promise<void> {
    await this.engine.mutate(householdId, 'shoppingListItems', itemId, { deleted: false, updatedBy: this.actorName() });
  }

  /** Nota já registrada nesta Casa? (bloqueio de importação duplicada) */
  async findPurchaseByKey(householdId: string, accessKey: string): Promise<Purchase | undefined> {
    const p = await this.db.purchases.get(await purchaseIdFor(householdId, accessKey));
    return p && p.householdId === householdId && !p.deleted ? p : undefined;
  }

  /**
   * Registra a nota escaneada como compra PENDENTE (itens são importados depois).
   * Se já existir, não duplica e retorna { existing: true }.
   */
  async savePurchaseFromQr(householdId: string, qr: NfceQr): Promise<{ purchase: Purchase; existing: boolean }> {
    const existing = await this.findPurchaseByKey(householdId, qr.info.key);
    if (existing) return { purchase: existing, existing: true };
    const { info } = qr;
    const day = qr.offline?.day ?? 1;
    const purchasedAt = new Date(Date.UTC(info.year, info.month - 1, day, 12)).toISOString();
    const fields: Record<string, unknown> = {
      accessKey: info.key,
      purchasedAt,
      totalCents: qr.offline?.totalCents ?? 0,
      source: 'nfce_qr',
      status: 'pendente',
      issuerCnpj: info.issuerId,
      docModel: info.model,
      createdBy: this.actorName(),
      deleted: false,
    };
    if (qr.consultUrl) fields.consultUrl = qr.consultUrl;
    const id = await purchaseIdFor(householdId, info.key);
    const purchase = await this.engine.mutate<Purchase>(householdId, 'purchases', id, fields);
    return { purchase, existing: false };
  }

  /**
   * Importa os itens lidos do texto da SEFAZ para uma compra PENDENTE.
   * Ids determinísticos: importar o mesmo texto em dois aparelhos não duplica itens.
   * Os itens são gravados antes da compra virar 'importada', então uma falha no meio
   * deixa a nota pendente e a importação pode ser repetida com segurança.
   *
   * NÃO cria Products, PriceHistory nem estoque: a normalização (descrição → produto)
   * é a próxima etapa; aqui os itens ficam apenas como PurchaseItem "crus".
   */
  async importPurchaseItems(householdId: string, purchaseId: string, parsed: ParsedNfce): Promise<Purchase> {
    const p = await this.db.purchases.get(purchaseId);
    if (!p || p.householdId !== householdId || p.deleted) throw new Error('Nota não encontrada nesta Casa');
    if (p.status === 'importada') throw new Error('Os itens desta nota já foram importados');
    if (parsed.items.length === 0) throw new Error('Nenhum item para importar');
    const key = p.accessKey;
    if (key && key.length === 44) {
      const series = Number(key.slice(22, 25));
      const number = Number(key.slice(25, 34));
      if ((parsed.number !== undefined && parsed.number !== number) || (parsed.series !== undefined && parsed.series !== series)) {
        throw new Error('Este texto é de outra nota');
      }
    }
    for (let i = 0; i < parsed.items.length; i++) {
      const it = parsed.items[i]!;
      const fields: Record<string, unknown> = {
        purchaseId,
        rawDescription: it.description,
        quantity: it.quantity,
        unit: it.unit,
        unitPriceCents: it.unitPriceCents,
        totalCents: it.totalCents,
        position: i,
        deleted: false,
      };
      if (it.code) fields.code = it.code;
      if (it.rawUnit) fields.rawUnit = it.rawUnit;
      await this.engine.mutate<PurchaseItem>(householdId, 'purchaseItems', await purchaseItemIdFor(householdId, purchaseId, i), fields);
    }
    const t = parsed.totals;
    const itemsSum = parsed.items.reduce((s, it) => s + it.totalCents, 0);
    const fields: Record<string, unknown> = {
      status: 'importada',
      totalCents: t.payableCents ?? t.totalCents ?? itemsSum,
      itemsCount: parsed.items.length,
      discountCents: t.discountCents,
      otherCents: t.otherCents,
    };
    if (parsed.emittedAt) fields.purchasedAt = parsed.emittedAt;
    if (parsed.payment) fields.paymentMethod = parsed.payment.method;
    return this.engine.mutate<Purchase>(householdId, 'purchases', purchaseId, fields);
  }

  async listPurchaseItems(householdId: string, purchaseId: string): Promise<PurchaseItem[]> {
    const all = await this.db.purchaseItems.where('purchaseId').equals(purchaseId).toArray();
    return all
      .filter((i) => i.householdId === householdId && !i.deleted)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.id < b.id ? -1 : 1));
  }

  async listPurchases(householdId: string): Promise<Purchase[]> {
    const all = await this.db.purchases.where('householdId').equals(householdId).toArray();
    return all.filter((p) => !p.deleted).sort((a, b) => (a.purchasedAt < b.purchasedAt ? 1 : -1));
  }

  async removePurchase(householdId: string, id: string): Promise<void> {
    await this.engine.mutate(householdId, 'purchases', id, { deleted: true });
  }

  /** Une itens duplicados: mantém o de menor id, soma quantidades e remove os demais. */
  async mergeDuplicates(householdId: string, group: ShoppingListItem[]): Promise<void> {
    if (group.length < 2) return;
    const sorted = [...group].sort((a, b) => (a.id < b.id ? -1 : 1));
    const keep = sorted[0]!;
    const total = sorted.reduce((s, i) => s + i.quantity, 0);
    await this.updateItem(householdId, keep.id, { quantity: total });
    for (const i of sorted.slice(1)) await this.removeItem(householdId, i.id);
  }

  /** Remove (logicamente) todos os itens marcados — "limpar carrinho". */
  async clearChecked(householdId: string, listId: string): Promise<number> {
    const items = (await this.listItems(householdId, listId)).filter((i) => i.checked);
    for (const i of items) await this.removeItem(householdId, i.id);
    return items.length;
  }
}

function clampQty(q: number): number {
  if (!Number.isFinite(q) || q <= 0) return 1;
  return Math.min(Math.round(q * 1000) / 1000, 9999);
}

/** Agrupa possíveis duplicados (mesmo nome normalizado, pendentes) — ex.: criados offline em 2 aparelhos. */
export function findDuplicates(items: ShoppingListItem[]): ShoppingListItem[][] {
  const groups = new Map<string, ShoppingListItem[]>();
  for (const i of items) {
    if (i.deleted || i.checked) continue;
    const g = groups.get(i.normName) ?? [];
    g.push(i);
    groups.set(i.normName, g);
  }
  return [...groups.values()].filter((g) => g.length > 1);
}
