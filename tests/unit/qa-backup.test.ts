/**
 * QA (Agente 7) — backups maliciosos/corrompidos.
 * O checksum é só integridade (qualquer um recalcula), então o conteúdo do
 * arquivo é tratado como entrada NÃO confiável.
 * `it.fails` + "BUG:" = defeito demonstrado (deve virar `it` após a correção).
 */
import { describe, expect, it } from 'vitest';
import { canonicalJson, exportBackup, restoreBackup, verifyBackup, type BackupFile } from '../../src/backup/backup';
import { PantryDB } from '../../src/db/db';
import { PantryRepo } from '../../src/db/repo';
import { SyncEngine } from '../../src/sync/engine';
import { serialize } from '../../src/sync/hlc';
import { MemorySyncServer } from '../../src/sync/memoryServer';
import { validateOp } from '../../src/sync/validate';

const T0 = 1_700_000_000_000;
let n = 0;

async function setup(transport?: ReturnType<MemorySyncServer['transportFor']>) {
  const db = new PantryDB(`qa-bk-${++n}`);
  const engine = await SyncEngine.create(db, `qabk${n}`, { now: () => T0, transport: transport ?? null });
  const repo = new PantryRepo(engine, () => 'QA', () => new Date(T0).toISOString());
  const { household, list } = await repo.createHousehold('Casa');
  const { item } = await repo.addItem(household.id, list.id, { name: 'Leite' });
  return { db, engine, repo, hid: household.id, listId: list.id, itemId: item.id };
}

/** Recalcula o checksum como o app faz — prova de que qualquer um forja um backup "íntegro". */
async function seal(b: Omit<BackupFile, 'checksum'>): Promise<BackupFile> {
  const s = canonicalJson({ format: b.format, formatVersion: b.formatVersion, householdId: b.householdId, tables: b.tables });
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  const hex = [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return { ...b, checksum: `sha256:${hex}` };
}

async function exported(db: PantryDB, hid: string): Promise<BackupFile> {
  return JSON.parse(JSON.stringify(await exportBackup(db, hid, new Date(T0).toISOString()))) as BackupFile;
}

const H = (ms: number, node = 'forjado') => serialize({ ms, counter: 0, node });

describe('QA backup malicioso', () => {
  // BUG (QA-12): verifyBackup não exige id === householdId em `households`, nem
  // valida nomes de campo / chaves de _v / tamanho dos valores. restoreBackup gera
  // ops de "replay" (replayOps) que vão para a outbox SEM passar por validateOp.
  it('CORRIGIDO QA-12: toda op que o restore coloca na outbox deve passar em validateOp', async () => {
    const a = await setup();
    const b = await exported(a.db, a.hid);
    const fake = crypto.randomUUID();
    b.tables.households!.push({ id: fake, householdId: a.hid, name: 'Casa fantasma', _v: { name: H(T0) } });
    b.tables.shoppingListItems![0]!._v.householdId = H(T0); // campo proibido no replay
    b.tables.shoppingListItems![0]!.name = 'x'.repeat(20_000); // > MAX_OP_BYTES
    b.tables.shoppingListItems![0]!._v.name = H(T0 + 5);
    const fresh = new PantryDB(`qa-bk-fresh-${++n}`);
    // Correção: o backup forjado é recusado por inteiro (transação) — nada entra na outbox.
    await expect(restoreBackup(fresh, await seal(b))).rejects.toThrow();
    for (const e of await fresh.outbox.toArray()) expect(() => validateOp(e.op)).not.toThrow();
    expect(await fresh.outbox.count()).toBe(0);
  });

  it('CORRIGIDO QA-12: verifyBackup recusa registro de households com id ≠ householdId', async () => {
    const a = await setup();
    const b = await exported(a.db, a.hid);
    b.tables.households!.push({ id: crypto.randomUUID(), householdId: a.hid, name: 'x', _v: { name: H(T0) } });
    await expect(verifyBackup(await seal(b))).rejects.toThrow();
  });

  // Efeito ponta a ponta de QA-12 + QA-08: após restaurar o backup forjado numa
  // Casa compartilhada, o aparelho para de sincronizar (push sempre falha antes do pull).
  it('CORRIGIDO QA-12/QA-08 (efeito): backup forjado não pode travar a sincronização da Casa', async () => {
    const server = new MemorySyncServer(() => T0);
    const ian = await setup(server.transportFor('ian'));
    server.createHousehold('ian', ian.hid);
    await ian.engine.sync(ian.hid);
    const b = await exported(ian.db, ian.hid);
    b.tables.households!.push({ id: crypto.randomUUID(), householdId: ian.hid, name: 'x', _v: { name: H(T0) } });
    await restoreBackup(ian.db, await seal(b), ian.hid).catch(() => undefined); // agora recusado
    await ian.engine.sync(ian.hid);
    expect(ian.engine.status).toBe('idle');
  });

  // QA-06 via backup: HLCs "do futuro" num backup travam o campo localmente.
  it('CORRIGIDO QA-06 (via backup): HLC futuro no backup não pode bloquear edições locais', async () => {
    const a = await setup();
    const b = await exported(a.db, a.hid);
    const it0 = b.tables.shoppingListItems![0]!;
    it0.name = 'Leite (backup)';
    it0._v.name = H(Date.now() + 30 * 24 * 3600_000); // +30 dias em relação ao relógio real
    // Correção: backup com versões no futuro é recusado.
    await expect(restoreBackup(a.db, await seal(b), a.hid)).rejects.toThrow(/futuro/);
    await a.repo.updateItem(a.hid, a.itemId, { name: 'Café' });
    expect((await a.db.shoppingListItems.get(a.itemId))?.name).toBe('Café');
  });

  it('prototype pollution: "__proto__" no backup não contamina Object.prototype', async () => {
    const a = await setup();
    const b = await exported(a.db, a.hid);
    const raw = JSON.stringify(b).replace('"_v":{', '"__proto__":{"polluted":true},"_v":{"__proto__":"' + H(T0) + '",');
    const parsed = JSON.parse(raw) as BackupFile;
    const sealed = await seal(parsed);
    const fresh = new PantryDB(`qa-bk-fresh-${++n}`);
    await restoreBackup(fresh, sealed).catch(() => undefined);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('recusa: checksum adulterado, registro de outra Casa, Casa diferente da esperada, tabela desconhecida', async () => {
    const a = await setup();
    const b = await exported(a.db, a.hid);
    await expect(verifyBackup({ ...b, checksum: 'sha256:00' })).rejects.toThrow(/checksum/);
    const other = structuredClone(b);
    other.tables.shoppingListItems![0]!.householdId = crypto.randomUUID();
    await expect(verifyBackup(await seal(other))).rejects.toThrow(/outra Casa/);
    await expect(restoreBackup(a.db, b, crypto.randomUUID())).rejects.toThrow(/outra Casa/);
    const unk = structuredClone(b) as unknown as { tables: Record<string, unknown> };
    unk.tables.users = [];
    await expect(verifyBackup(await seal(unk as unknown as BackupFile))).rejects.toThrow(/desconhecida/);
    const badV = structuredClone(b);
    badV.tables.shoppingListItems![0]!._v.name = 'not-an-hlc';
    await expect(verifyBackup(await seal(badV))).rejects.toThrow(/versão/);
  });

  it('registro com id já usado por outra Casa local é recusado (sem mistura)', async () => {
    const a = await setup();
    const other = await a.repo.createHousehold('Outra');
    const b = await exported(a.db, a.hid);
    // Forja: a Casa "b" reclama o id da lista da outra Casa
    b.tables.shoppingLists!.push({ id: other.list.id, householdId: a.hid, name: 'roubada', _v: { name: H(T0 + 99) } });
    await expect(restoreBackup(a.db, await seal(b), a.hid)).rejects.toThrow(/Conflito de Casa/);
    expect((await a.db.shoppingLists.get(other.list.id))?.householdId).toBe(other.household.id);
  });
});
