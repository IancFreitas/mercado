/**
 * Modelo de dados do Smart Pantry (lado do dispositivo).
 *
 * Regras gerais:
 * - Toda entidade sincronizável possui `id` (UUID v4) e `householdId`.
 *   O `householdId` é a fronteira de isolamento: nenhuma operação de uma Casa
 *   pode tocar registros de outra (verificado no cliente e, no servidor, por RLS).
 * - Campos de controle de sincronização ficam em `_v` (versão HLC por campo).
 * - Exclusões são lógicas (`deleted: true`) para que possam ser sincronizadas.
 * - Preços são guardados em centavos (inteiros) para evitar erro de ponto flutuante.
 */

export type UUID = string;
/** Carimbo HLC serializado (ver src/sync/hlc.ts). Comparável lexicograficamente. */
export type HlcString = string;

/** Metadados de versão por campo, usados pelo merge LWW. */
export interface SyncMeta {
  _v: Record<string, HlcString>;
}

export interface BaseRecord extends SyncMeta {
  id: UUID;
  householdId: UUID;
  deleted?: boolean;
}

/** Entidades replicadas entre moradores via log de operações. */
export const SYNC_ENTITIES = [
  'households',
  'stores',
  'products',
  'productAliases',
  'purchases',
  'purchaseItems',
  'inventory',
  'inventoryMovements',
  'shoppingLists',
  'shoppingListItems',
  'priceHistory',
] as const;
export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export function isSyncEntity(x: unknown): x is SyncEntity {
  return typeof x === 'string' && (SYNC_ENTITIES as readonly string[]).includes(x);
}

export interface Household extends BaseRecord {
  /** Para a Casa, id === householdId. */
  name: string;
  residents?: number;
  createdAt: string;
}

export type Unit = 'un' | 'kg' | 'g' | 'l' | 'ml' | 'pct' | 'cx' | 'dz';

export const CATEGORIES = [
  'Hortifruti',
  'Padaria',
  'Laticínios',
  'Carnes',
  'Mercearia',
  'Bebidas',
  'Congelados',
  'Limpeza',
  'Higiene',
  'Pet',
  'Outros',
] as const;
export type Category = (typeof CATEGORIES)[number];

export type Priority = 'baixa' | 'normal' | 'alta';

export interface ShoppingList extends BaseRecord {
  name: string;
  createdAt: string;
}

export interface ShoppingListItem extends BaseRecord {
  listId: UUID;
  name: string;
  /** Nome normalizado (minúsculas, sem acentos) usado para detectar duplicidades. */
  normName: string;
  productId?: UUID;
  quantity: number;
  unit: Unit;
  category: Category;
  priority: Priority;
  checked: boolean;
  /** Preço encontrado no Modo Compras (centavos), opcional. */
  foundPriceCents?: number;
  source: 'manual' | 'sugestao' | 'atalho';
  createdAt: string;
  createdBy: string;
  updatedBy: string;
}

export interface Store extends BaseRecord {
  name: string;
  cnpj?: string;
  city?: string;
}

export interface Product extends BaseRecord {
  name: string;
  brand?: string;
  category: Category;
  /** Tamanho da embalagem (ex.: 3) e unidade (ex.: 'l'). */
  packageSize?: number;
  packageUnit?: Unit;
  /** Grupo de equivalência (ex.: "leite integral") para substitutos. */
  equivalenceGroup?: string;
  predictionEnabled: boolean;
  /**
   * true quando o usuário mexeu no interruptor "Prever reposição". Produtos antigos têm
   * `predictionEnabled: false` apenas por padrão; sem este marcador a previsão fica LIGADA.
   */
  predictionSetByUser?: boolean;
  /** Sugestão de reposição adiada até este instante (ISO). */
  snoozedUntil?: string;
  /** Unidade em que o estoque é contado (definida ao criar a partir da nota). */
  unit?: Unit;
}

export interface ProductAlias extends BaseRecord {
  productId: UUID;
  /** Descrição como aparece na nota (ex.: "SAB OMO LQD 3L"), normalizada. */
  rawDescription: string;
  storeId?: UUID;
}

export interface Purchase extends BaseRecord {
  storeId?: UUID;
  /** Chave de acesso NFC-e (44 dígitos) — usada para impedir importação duplicada. */
  accessKey?: string;
  purchasedAt: string;
  totalCents: number;
  paymentMethod?: string;
  source: 'nfce_qr' | 'ocr' | 'manual';
  /** Registro original (HTML/texto) para auditoria — guardado apenas localmente. */
  rawRef?: string;
  /** 'pendente' = nota escaneada, itens ainda não importados. */
  status?: 'pendente' | 'importada';
  /** CNPJ do emitente (da chave). */
  issuerCnpj?: string;
  /** '65' NFC-e, '55' NF-e. */
  docModel?: '65' | '55';
  /** URL (já validada como *.gov.br) para consultar a nota na SEFAZ. */
  consultUrl?: string;
  /** Preenchidos na importação dos itens (texto da SEFAZ). */
  itemsCount?: number;
  discountCents?: number;
  otherCents?: number;
  createdBy?: string;
}

export interface PurchaseItem extends BaseRecord {
  purchaseId: UUID;
  productId?: UUID;
  rawDescription: string;
  quantity: number;
  unit: Unit;
  unitPriceCents: number;
  totalCents: number;
  /** Posição do item na nota (0..n-1), para ordenar. */
  position?: number;
  /** Código do produto no emitente. */
  code?: string;
  /** Unidade original quando não reconhecida. */
  rawUnit?: string;
}

export interface InventoryItem extends BaseRecord {
  productId: UUID;
  quantity: number;
  unit: Unit;
  lastPurchaseAt?: string;
  expiresAt?: string;
  confidence: number;
}

export type MovementKind = 'compra' | 'consumo' | 'ajuste' | 'esgotado' | 'descarte' | 'ainda_tem';

/** Movimentações são apenas anexadas (append-only) — trilha de auditoria. */
export interface InventoryMovement extends BaseRecord {
  productId: UUID;
  kind: MovementKind;
  delta: number;
  unit: Unit;
  at: string;
  purchaseItemId?: UUID;
  note?: string;
  by: string;
}

export interface PriceHistory extends BaseRecord {
  productId: UUID;
  storeId?: UUID;
  purchaseItemId?: UUID;
  at: string;
  unitPriceCents: number;
  /** Preço normalizado por unidade base (R$/kg, R$/l, R$/un), em centavos. */
  normalizedCents?: number;
  normalizedUnit?: 'kg' | 'l' | 'un';
}

/** Mapa entidade → tipo, para tipagem genérica no repositório. */
export interface EntityMap {
  households: Household;
  stores: Store;
  products: Product;
  productAliases: ProductAlias;
  purchases: Purchase;
  purchaseItems: PurchaseItem;
  inventory: InventoryItem;
  inventoryMovements: InventoryMovement;
  shoppingLists: ShoppingList;
  shoppingListItems: ShoppingListItem;
  priceHistory: PriceHistory;
}

/** Operação de sincronização: alteração de um ou mais campos de um registro. */
export interface SyncOp {
  opId: UUID;
  householdId: UUID;
  entity: SyncEntity;
  entityId: UUID;
  hlc: HlcString;
  deviceId: string;
  /** Campos alterados → novo valor. */
  fields: Record<string, unknown>;
  /**
   * Para cada campo alterado, a versão (HLC) que o autor via quando editou.
   * Se, ao aplicar, a versão atual for diferente, houve edição concorrente.
   */
  base: Record<string, HlcString | null>;
  /** Preenchido pelo servidor (sequência total por Casa). */
  seq?: number;
  /** Preenchido pelo servidor (auth.uid()). */
  userId?: string;
}

/** Conflito detectado: valor que perdeu no LWW é preservado para revisão. */
export interface ConflictRecord {
  id: string;
  householdId: UUID;
  entity: SyncEntity;
  entityId: UUID;
  field: string;
  winnerValue: unknown;
  winnerHlc: HlcString;
  loserValue: unknown;
  loserHlc: HlcString;
  detectedAt: string;
  resolved: boolean;
}
