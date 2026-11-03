/**
 * Backup e restauração.
 *
 * Formato (documentado em docs/BACKUP_FORMAT.md):
 * {
 *   "format": "smart-pantry-backup",
 *   "formatVersion": 1,
 *   "exportedAt": ISO-8601,
 *   "householdId": uuid,
 *   "tables": { [entidade]: Registro[] },
 *   "checksum": "sha256:<hex>"   // SHA-256 do JSON canônico de {format, formatVersion, householdId, tables}
 * }
 *
 * A restauração mescla campo a campo pela versão HLC (mergeRecords), portanto
 * importar o mesmo backup duas vezes — ou um backup antigo — nunca sobrescreve
 * dados mais novos nem duplica registros.
 */
import type { PantryDB } from '../db/db';
import { SYNC_ENTITIES, type SyncEntity, type SyncOp } from '../domain/types';
import { mergeRecords, type AnyRecord } from '../sync/merge';
import { isUuid } from '../sync/validate';
import { MAX_DRIFT_MS, isValidHlc, parse } from '../sync/hlc';
import { validateOp } from '../sync/validate';

export const BACKUP_FORMAT = 'smart-pantry-backup';
export const BACKUP_VERSION = 1;
const MAX_RECORDS = 200_000;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  exportedAt: string;
  householdId: string;
  tables: Partial<Record<SyncEntity, AnyRecord[]>>;
  checksum: string;
}

/** JSON canônico: chaves ordenadas recursivamente. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
  if (v && typeof v === 'object') {
    const keys = Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((v as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function checksumOf(b: Omit<BackupFile, 'checksum' | 'exportedAt'>): Promise<string> {
  return `sha256:${await sha256Hex(canonicalJson({ format: b.format, formatVersion: b.formatVersion, householdId: b.householdId, tables: b.tables }))}`;
}

export async function exportBackup(db: PantryDB, householdId: string, nowIso = new Date().toISOString()): Promise<BackupFile> {
  const tables: Partial<Record<SyncEntity, AnyRecord[]>> = {};
  let count = 0;
  for (const e of SYNC_ENTITIES) {
    const rows = (await db.entityTable(e).where('householdId').equals(householdId).toArray()) as AnyRecord[];
    rows.sort((a, b) => (a.id < b.id ? -1 : 1));
    tables[e] = rows;
    count += rows.length;
  }
  const partial = { format: BACKUP_FORMAT, formatVersion: BACKUP_VERSION, householdId, tables } as const;
  const checksum = await checksumOf(partial);
  await db.backups.put({ id: crypto.randomUUID(), householdId, createdAt: nowIso, kind: 'export', checksum, formatVersion: BACKUP_VERSION, records: count });
  return { ...partial, exportedAt: nowIso, checksum };
}

export class BackupError extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = 'BackupError';
  }
}

/** Valida estrutura, versão e integridade. Lança BackupError com mensagem amigável. */
export async function verifyBackup(raw: unknown): Promise<BackupFile> {
  if (!raw || typeof raw !== 'object') throw new BackupError('Arquivo não é um backup do Smart Pantry');
  const b = raw as Partial<BackupFile>;
  if (b.format !== BACKUP_FORMAT) throw new BackupError('Arquivo não é um backup do Smart Pantry');
  if (typeof b.formatVersion !== 'number' || b.formatVersion > BACKUP_VERSION) {
    throw new BackupError('Backup criado por uma versão mais nova do app — atualize o app');
  }
  if (!isUuid(b.householdId)) throw new BackupError('Backup sem Casa válida');
  if (!b.tables || typeof b.tables !== 'object') throw new BackupError('Backup sem dados');
  let count = 0;
  const nowMs = Date.now();
  for (const [entity, rows] of Object.entries(b.tables)) {
    if (!(SYNC_ENTITIES as readonly string[]).includes(entity)) throw new BackupError(`Tabela desconhecida: ${entity}`);
    if (!Array.isArray(rows)) throw new BackupError('Backup corrompido');
    for (const r of rows as AnyRecord[]) {
      count++;
      if (!r || !isUuid(r.id) || r.householdId !== b.householdId) throw new BackupError('Registro de outra Casa ou inválido no backup');
      if (!r._v || typeof r._v !== 'object' || !Object.values(r._v).every(isValidHlc)) throw new BackupError('Metadados de versão inválidos');
      validateRecord(entity as SyncEntity, r, b.householdId, nowMs);
    }
  }
  if (count > MAX_RECORDS) throw new BackupError('Backup grande demais');
  const expected = await checksumOf(b as BackupFile);
  if (b.checksum !== expected) throw new BackupError('Falha na verificação de integridade (checksum) — arquivo alterado ou corrompido');
  return b as BackupFile;
}

const FIELD_RE = /^[a-zA-Z][a-zA-Z0-9]{0,40}$/;
const RECORD_KEYS_ALLOWED = new Set(['id', 'householdId', '_v']);

/**
 * O checksum só detecta corrupção — qualquer um pode recalculá-lo. Por isso
 * cada registro é validado como dado não confiável (QA-12).
 */
function validateRecord(entity: SyncEntity, r: AnyRecord, householdId: string, nowMs: number): void {
  if (entity === 'households' && r.id !== householdId) throw new BackupError('Registro de Casa inconsistente no backup');
  for (const k of Object.keys(r)) {
    if (!RECORD_KEYS_ALLOWED.has(k) && !FIELD_RE.test(k)) throw new BackupError(`Campo inválido no backup: ${k.slice(0, 40)}`);
  }
  for (const [k, h] of Object.entries(r._v)) {
    if (!FIELD_RE.test(k) || k === 'id' || k === 'householdId') throw new BackupError('Metadados de versão inválidos');
    // QA-06: versões "do futuro" congelariam o campo — recusa.
    if (parse(h).ms > nowMs + MAX_DRIFT_MS) throw new BackupError('Backup com datas no futuro — relógio do aparelho de origem incorreto?');
  }
  if (JSON.stringify(r).length > 64 * 1024) throw new BackupError('Registro grande demais no backup');
}

/** Gera operações que reproduzem exatamente as versões (HLC) de um registro. */
export function replayOps(entity: SyncEntity, r: AnyRecord): SyncOp[] {
  const byHlc = new Map<string, Record<string, unknown>>();
  for (const [field, hlc] of Object.entries(r._v)) {
    const g = byHlc.get(hlc) ?? {};
    g[field] = r[field];
    byHlc.set(hlc, g);
  }
  return [...byHlc.entries()].map(([hlc, fields]) => ({
    opId: crypto.randomUUID(),
    householdId: r.householdId,
    entity,
    entityId: r.id,
    hlc,
    deviceId: parse(hlc).node,
    fields,
    base: Object.fromEntries(Object.keys(fields).map((k) => [k, hlc])),
  }));
}

export interface RestoreResult {
  householdId: string;
  inserted: number;
  updated: number;
  unchanged: number;
}

/**
 * Restaura um backup verificado. Se `expectHousehold` for informado, recusa
 * backups de outra Casa (proteção contra misturar residências).
 */
export async function restoreBackup(db: PantryDB, raw: unknown, expectHousehold?: string): Promise<RestoreResult> {
  const b = await verifyBackup(raw);
  if (expectHousehold && b.householdId !== expectHousehold) {
    throw new BackupError('Este backup pertence a outra Casa');
  }
  const res: RestoreResult = { householdId: b.householdId, inserted: 0, updated: 0, unchanged: 0 };
  const tables = SYNC_ENTITIES.map((e) => db.entityTable(e));
  await db.transaction('rw', [...tables, db.backups, db.outbox], async () => {
    for (const e of SYNC_ENTITIES) {
      const rows = b.tables[e] ?? [];
      const t = db.entityTable(e);
      for (const r of rows) {
        const cur = (await t.get(r.id)) as AnyRecord | undefined;
        if (cur && cur.householdId !== b.householdId) throw new BackupError('Conflito de Casa ao restaurar');
        const merged = mergeRecords(cur, r);
        if (!cur) res.inserted++;
        else if (canonicalJson(cur) !== canonicalJson(merged)) res.updated++;
        else {
          res.unchanged++;
          continue;
        }
        await t.put(merged);
        // Enfileira "replay" com as versões originais, para que dados restaurados
        // em modo local cheguem ao servidor quando a Casa for conectada.
        for (const raw of replayOps(e, merged)) {
          let op: SyncOp;
          try {
            op = validateOp(raw); // QA-12: nada entra na outbox sem validação
          } catch (err) {
            throw new BackupError(`Backup contém dados inválidos (${(err as Error).message})`);
          }
          await db.outbox.add({ householdId: b.householdId, op, createdAt: new Date().toISOString(), attempts: 0 });
        }
      }
    }
    await db.backups.put({
      id: crypto.randomUUID(),
      householdId: b.householdId,
      createdAt: new Date().toISOString(),
      kind: 'import',
      checksum: b.checksum,
      formatVersion: b.formatVersion,
      records: res.inserted + res.updated + res.unchanged,
    });
  });
  return res;
}
