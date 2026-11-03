/**
 * Motor de sincronização local-first.
 *
 * Fluxo:
 * 1. Toda alteração local vira uma SyncOp, aplicada imediatamente no banco
 *    local e gravada na outbox — na MESMA transação (sem estado intermediário).
 * 2. `sync()` envia a outbox em ordem (idempotente por opId) e depois busca as
 *    operações novas do servidor (cursor = último seq visto), aplicando-as com
 *    o merge determinístico de src/sync/merge.ts.
 * 3. Funciona totalmente offline; sem transporte configurado, as operações
 *    apenas acumulam na outbox até a Casa ser conectada.
 */
import type { PantryDB } from '../db/db';
import { SYNC_ENTITIES, type SyncEntity, type SyncOp } from '../domain/types';
import { HlcClock } from './hlc';
import { applyOp, type AnyRecord } from './merge';
import { ForbiddenError, MAX_OPS_PER_PUSH, type SyncTransport } from './transport';
import { validateOp } from './validate';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'forbidden' | 'local-only';

export interface SyncReport {
  pushed: number;
  pulled: number;
  applied: number;
  conflicts: number;
  rejected: number;
}

export interface EngineOptions {
  transport?: SyncTransport | null;
  now?: () => number;
  uuid?: () => string;
  pullLimit?: number;
}

const CLOCK_KEY = 'hlc:last';
const cursorKey = (hid: string) => `cursor:${hid}`;

export class SyncEngine {
  private clock!: HlcClock;
  private transport: SyncTransport | null;
  private readonly now: () => number;
  private readonly uuid: () => string;
  private readonly pullLimit: number;
  private running: Promise<SyncReport> | null = null;
  private listeners = new Set<() => void>();
  status: SyncStatus = 'local-only';
  lastError: string | null = null;
  lastSyncAt: number | null = null;

  private constructor(
    readonly db: PantryDB,
    readonly deviceId: string,
    opts: EngineOptions,
  ) {
    this.transport = opts.transport ?? null;
    this.now = opts.now ?? (() => Date.now());
    this.uuid = opts.uuid ?? (() => crypto.randomUUID());
    this.pullLimit = opts.pullLimit ?? 500;
    this.status = this.transport ? 'idle' : 'local-only';
  }

  static async create(db: PantryDB, deviceId: string, opts: EngineOptions = {}): Promise<SyncEngine> {
    const e = new SyncEngine(db, deviceId, opts);
    const last = await db.getKV<string>(CLOCK_KEY);
    e.clock = new HlcClock(deviceId, e.now, last);
    return e;
  }

  setTransport(t: SyncTransport | null): void {
    this.transport = t;
    this.setStatus(t ? 'idle' : 'local-only');
  }

  hasTransport(): boolean {
    return this.transport !== null;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  private setStatus(s: SyncStatus, err: string | null = null): void {
    this.status = s;
    this.lastError = err;
    this.emit();
  }

  private tables() {
    return [...SYNC_ENTITIES.map((e) => this.db.entityTable(e)), this.db.outbox, this.db.conflicts, this.db.kv];
  }

  /**
   * Altera (ou cria) um registro localmente e enfileira a operação.
   * Retorna o registro resultante.
   */
  async mutate<T = AnyRecord>(
    householdId: string,
    entity: SyncEntity,
    entityId: string,
    fields: Record<string, unknown>,
  ): Promise<T> {
    if (entity === 'households' && entityId !== householdId) throw new Error('Casa inconsistente');
    return this.db.transaction('rw', this.tables(), async () => {
      const table = this.db.entityTable(entity);
      const current = (await table.get(entityId)) as AnyRecord | undefined;
      if (current && current.householdId !== householdId) throw new ForbiddenError('Registro pertence a outra Casa');
      const hlc = this.clock.tick();
      const base: Record<string, string | null> = {};
      for (const f of Object.keys(fields)) base[f] = current?._v?.[f] ?? null;
      const op: SyncOp = validateOp({
        opId: this.uuid(),
        householdId,
        entity,
        entityId,
        hlc,
        deviceId: this.deviceId,
        fields: JSON.parse(JSON.stringify(fields)) as Record<string, unknown>,
        base,
      });
      const { record } = applyOp(current, op, new Date(this.now()).toISOString());
      await table.put(record);
      await this.db.outbox.add({ householdId, op, createdAt: new Date(this.now()).toISOString(), attempts: 0 });
      await this.db.setKV(CLOCK_KEY, this.clock.current());
      this.emit();
      return record as T;
    });
  }

  async pendingCount(householdId: string): Promise<number> {
    return this.db.outbox.where('householdId').equals(householdId).count();
  }

  /** Executa um ciclo push+pull. Chamadas concorrentes reutilizam o ciclo em andamento. */
  sync(householdId: string): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = this.doSync(householdId).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async doSync(householdId: string): Promise<SyncReport> {
    const report: SyncReport = { pushed: 0, pulled: 0, applied: 0, conflicts: 0, rejected: 0 };
    const t = this.transport;
    if (!t) {
      this.setStatus('local-only');
      return report;
    }
    this.setStatus('syncing');
    try {
      await this.pushAll(t, householdId, report);
      await this.pullAll(t, householdId, report);
      this.lastSyncAt = this.now();
      this.setStatus('idle');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof ForbiddenError) this.setStatus('forbidden', msg);
      else if (e instanceof Error && e.name === 'NetworkError') this.setStatus('offline', msg);
      else this.setStatus('error', msg);
    }
    return report;
  }

  private async pushAll(t: SyncTransport, householdId: string, report: SyncReport): Promise<void> {
    for (;;) {
      const batch = await this.db.outbox.where('householdId').equals(householdId).limit(MAX_OPS_PER_PUSH).toArray();
      // Dexie retorna em ordem da chave primária (seqLocal) dentro do índice? Garantimos ordenando.
      batch.sort((a, b) => (a.seqLocal ?? 0) - (b.seqLocal ?? 0));
      if (batch.length === 0) return;
      let accepted: string[];
      try {
        ({ accepted } = await t.push(householdId, batch.map((b) => b.op)));
      } catch (e) {
        await this.db.outbox.bulkUpdate(
          batch.map((b) => ({
            key: b.seqLocal!,
            changes: { attempts: b.attempts + 1, lastError: e instanceof Error ? e.message : String(e) },
          })),
        );
        throw e;
      }
      const ok = new Set(accepted);
      const done = batch.filter((b) => ok.has(b.op.opId)).map((b) => b.seqLocal!);
      await this.db.outbox.bulkDelete(done);
      report.pushed += done.length;
      if (done.length < batch.length) throw new Error('Servidor não aceitou todas as operações');
    }
  }

  private async pullAll(t: SyncTransport, householdId: string, report: SyncReport): Promise<void> {
    for (;;) {
      const since = (await this.db.getKV<number>(cursorKey(householdId))) ?? 0;
      const { ops, hasMore } = await t.pull(householdId, since, this.pullLimit);
      if (ops.length === 0) return;
      report.pulled += ops.length;
      await this.applyRemote(householdId, ops, report);
      if (!hasMore) return;
    }
  }

  /** Aplica operações remotas (já ordenadas por seq) e avança o cursor. Exposto para testes. */
  async applyRemote(householdId: string, rawOps: unknown[], report?: SyncReport): Promise<void> {
    await this.db.transaction('rw', this.tables(), async () => {
      let cursor = (await this.db.getKV<number>(cursorKey(householdId))) ?? 0;
      const nowIso = new Date(this.now()).toISOString();
      for (const raw of rawOps) {
        let op: SyncOp;
        try {
          op = validateOp(raw);
        } catch {
          if (report) report.rejected++;
          const seq = (raw as { seq?: unknown })?.seq;
          if (typeof seq === 'number' && seq > cursor) cursor = seq;
          continue;
        }
        if (typeof op.seq === 'number' && op.seq > cursor) cursor = op.seq;
        if (op.householdId !== householdId) {
          if (report) report.rejected++;
          continue;
        }
        this.clock.receive(op.hlc);
        const table = this.db.entityTable(op.entity);
        const current = (await table.get(op.entityId)) as AnyRecord | undefined;
        if (current && current.householdId !== householdId) {
          if (report) report.rejected++;
          continue;
        }
        const res = applyOp(current, op, nowIso);
        if (res.changed) {
          await table.put(res.record);
          if (report) report.applied++;
        }
        for (const c of res.conflicts) {
          if (!(await this.db.conflicts.get(c.id))) {
            await this.db.conflicts.put(c);
            if (report) report.conflicts++;
          }
        }
      }
      await this.db.setKV(cursorKey(householdId), cursor);
      await this.db.setKV(CLOCK_KEY, this.clock.current());
    });
    this.emit();
  }
}
