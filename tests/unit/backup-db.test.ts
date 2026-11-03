import Dexie from 'dexie';
import { describe, expect, it } from 'vitest';
import { exportBackup, restoreBackup, verifyBackup } from '../../src/backup/backup';
import { DB_SCHEMA_V1, PantryDB } from '../../src/db/db';
import { PantryRepo } from '../../src/db/repo';
import { SyncEngine } from '../../src/sync/engine';

let n = 0;
async function setup() {
  const db = new PantryDB(`bk-${++n}`);
  const engine = await SyncEngine.create(db, `dev${n}`);
  const repo = new PantryRepo(engine, () => 'Ian');
  const { household, list } = await repo.createHousehold('Casa');
  await repo.addItem(household.id, list.id, { name: 'Leite', quantity: 2 });
  await repo.addItem(household.id, list.id, { name: 'Pão' });
  return { db, repo, hid: household.id, listId: list.id };
}

describe('backup e restauração', () => {
  it('exporta, verifica integridade e restaura em aparelho novo', async () => {
    const a = await setup();
    const file = await exportBackup(a.db, a.hid);
    const json = JSON.parse(JSON.stringify(file));
    await expect(verifyBackup(json)).resolves.toBeTruthy();
    const fresh = new PantryDB(`bk-fresh-${++n}`);
    const r = await restoreBackup(fresh, json);
    expect(r.inserted).toBe(4); // casa, lista, 2 itens
    expect((await fresh.shoppingListItems.toArray()).map((i) => i.name).sort()).toEqual(['Leite', 'Pão']);
    expect(await fresh.backups.count()).toBe(1);
  });

  it('importar duas vezes não duplica nem altera', async () => {
    const a = await setup();
    const file = JSON.parse(JSON.stringify(await exportBackup(a.db, a.hid)));
    const r = await restoreBackup(a.db, file);
    expect(r).toMatchObject({ inserted: 0, updated: 0, unchanged: 4 });
  });

  it('backup antigo não sobrescreve dados mais novos', async () => {
    const a = await setup();
    const old = JSON.parse(JSON.stringify(await exportBackup(a.db, a.hid)));
    const leite = (await a.repo.listItems(a.hid, a.listId)).find((i) => i.name === 'Leite')!;
    await a.repo.updateItem(a.hid, leite.id, { quantity: 10 });
    await restoreBackup(a.db, old);
    expect((await a.db.shoppingListItems.get(leite.id))!.quantity).toBe(10);
  });

  it('detecta adulteração (checksum)', async () => {
    const a = await setup();
    const file = JSON.parse(JSON.stringify(await exportBackup(a.db, a.hid)));
    file.tables.shoppingListItems[0].name = 'Adulterado';
    await expect(verifyBackup(file)).rejects.toThrow(/integridade/);
  });

  it('recusa backup de outra Casa quando exigido, e registros misturados', async () => {
    const a = await setup();
    const b = await setup();
    const fileB = JSON.parse(JSON.stringify(await exportBackup(b.db, b.hid)));
    await expect(restoreBackup(a.db, fileB, a.hid)).rejects.toThrow(/outra Casa/);
    fileB.tables.shoppingListItems[0].householdId = a.hid;
    await expect(verifyBackup(fileB)).rejects.toThrow(/outra Casa/);
  });

  it('recusa versão futura e arquivos estranhos', async () => {
    await expect(verifyBackup({ format: 'x' })).rejects.toThrow();
    const a = await setup();
    const file = JSON.parse(JSON.stringify(await exportBackup(a.db, a.hid)));
    file.formatVersion = 99;
    await expect(verifyBackup(file)).rejects.toThrow(/versão mais nova/);
  });
});

describe('migrações do banco local', () => {
  it('abre um banco criado na v1 sem perder dados', async () => {
    const name = `mig-${++n}`;
    const legacy = new Dexie(name);
    legacy.version(1).stores(DB_SCHEMA_V1);
    await legacy.open();
    await legacy.table('kv').put({ key: 'x', value: 42 });
    legacy.close();
    const db = new PantryDB(name);
    await db.open();
    expect(db.verno).toBeGreaterThanOrEqual(1);
    expect(await db.getKV('x')).toBe(42);
  });

  it('persiste dados entre reaberturas (offline)', async () => {
    const a = await setup();
    const name = a.db.name;
    a.db.close();
    const again = new PantryDB(name);
    expect(await again.shoppingListItems.count()).toBe(2);
    expect(await again.outbox.count()).toBe(4);
  });
});

describe('restauração + sincronização', () => {
  it('dados restaurados em modo local chegam ao servidor sem falsos conflitos', async () => {
    const { MemorySyncServer } = await import('../../src/sync/memoryServer');
    const a = await setup();
    const file = JSON.parse(JSON.stringify(await exportBackup(a.db, a.hid)));
    // Aparelho novo, modo local: restaura
    const fresh = new PantryDB(`bk-replay-${++n}`);
    const engine = await SyncEngine.create(fresh, 'devNovo');
    await restoreBackup(fresh, file);
    // Conecta: tudo vai para o servidor
    const server = new MemorySyncServer();
    server.createHousehold('u1', a.hid);
    engine.setTransport(server.transportFor('u1'));
    await engine.sync(a.hid);
    expect(await engine.pendingCount(a.hid)).toBe(0);
    // Outro aparelho com os dados originais (aparelho A) sincroniza: sem conflitos
    const engA = await SyncEngine.create(a.db, 'devA-again', { transport: server.transportFor('u1') });
    await a.db.outbox.clear();
    await engA.sync(a.hid);
    expect(await a.db.conflicts.count()).toBe(0);
    const other = await SyncEngine.create(new PantryDB(`bk-other-${++n}`), 'devOutro', { transport: server.transportFor('u1') });
    await other.sync(a.hid);
    expect((await other.db.shoppingListItems.toArray()).map((i) => i.name).sort()).toEqual(['Leite', 'Pão']);
  });
});
