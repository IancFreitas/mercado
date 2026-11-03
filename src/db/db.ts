/**
 * Banco local (IndexedDB via Dexie).
 *
 * Estratégia de migração: cada alteração de esquema cria uma nova chamada
 * `this.version(N)` — versões antigas NUNCA são editadas depois de publicadas.
 * Dados que precisarem de transformação usam `.upgrade(tx => ...)`.
 * Os testes em tests/unit/backup-db.test.ts ("migrações do banco local")
 * garantem que um banco v1 abre e é atualizado para a versão atual sem perda.
 */
import Dexie, { type Table } from 'dexie';
import type {
  ConflictRecord,
  EntityMap,
  SyncEntity,
  SyncOp,
} from '../domain/types';

export interface OutboxEntry {
  /** Ordem local de criação (autoincremento) — o envio respeita essa ordem. */
  seqLocal?: number;
  householdId: string;
  op: SyncOp;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

/** Operação recusada de forma permanente pelo servidor (não bloqueia a fila — QA-08). */
export interface RejectedOp {
  id?: number;
  householdId: string;
  op: SyncOp;
  rejectedAt: string;
  reason: string;
}

export interface KV {
  key: string;
  value: unknown;
}

export interface BackupMetadata {
  id: string;
  householdId: string;
  createdAt: string;
  kind: 'export' | 'import';
  checksum: string;
  formatVersion: number;
  records: number;
}

export const DB_SCHEMA_V1: Record<string, string> = {
  // Entidades sincronizáveis — sempre indexadas por householdId.
  households: 'id, householdId',
  stores: 'id, householdId, cnpj',
  products: 'id, householdId, name, category, equivalenceGroup',
  productAliases: 'id, householdId, productId, rawDescription',
  purchases: 'id, householdId, purchasedAt, accessKey, storeId',
  purchaseItems: 'id, householdId, purchaseId, productId',
  inventory: 'id, householdId, productId',
  inventoryMovements: 'id, householdId, productId, at',
  shoppingLists: 'id, householdId',
  shoppingListItems: 'id, householdId, listId, normName',
  priceHistory: 'id, householdId, productId, storeId, at',
  // Controle local (não sincronizado).
  outbox: '++seqLocal, householdId',
  conflicts: 'id, householdId, resolved',
  backups: 'id, householdId, createdAt',
  kv: 'key',
};

/** v2: fila de operações rejeitadas pelo servidor. */
export const DB_SCHEMA_V2: Record<string, string> = {
  rejectedOps: '++id, householdId',
};

export class PantryDB extends Dexie {
  households!: Table<EntityMap['households'], string>;
  stores!: Table<EntityMap['stores'], string>;
  products!: Table<EntityMap['products'], string>;
  productAliases!: Table<EntityMap['productAliases'], string>;
  purchases!: Table<EntityMap['purchases'], string>;
  purchaseItems!: Table<EntityMap['purchaseItems'], string>;
  inventory!: Table<EntityMap['inventory'], string>;
  inventoryMovements!: Table<EntityMap['inventoryMovements'], string>;
  shoppingLists!: Table<EntityMap['shoppingLists'], string>;
  shoppingListItems!: Table<EntityMap['shoppingListItems'], string>;
  priceHistory!: Table<EntityMap['priceHistory'], string>;
  outbox!: Table<OutboxEntry, number>;
  conflicts!: Table<ConflictRecord, string>;
  backups!: Table<BackupMetadata, string>;
  kv!: Table<KV, string>;
  rejectedOps!: Table<RejectedOp, number>;

  constructor(name = 'smart-pantry') {
    super(name);
    this.version(1).stores(DB_SCHEMA_V1);
    this.version(2).stores(DB_SCHEMA_V2);
  }

  entityTable(entity: SyncEntity): Table<Record<string, unknown> & { id: string }, string> {
    return this.table(entity);
  }

  async getKV<T>(key: string): Promise<T | undefined> {
    return (await this.kv.get(key))?.value as T | undefined;
  }

  async setKV(key: string, value: unknown): Promise<void> {
    await this.kv.put({ key, value });
  }
}
