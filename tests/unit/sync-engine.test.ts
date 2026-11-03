/**
 * Prova de conceito automatizada da sincronização (itens 2–10 do roteiro):
 * dois "aparelhos" (bancos IndexedDB independentes) + servidor em memória
 * com as mesmas regras de autorização do Supabase.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { PantryDB } from '../../src/db/db';
import { PantryRepo, findDuplicates } from '../../src/db/repo';
import { SyncEngine } from '../../src/sync/engine';
import { MemorySyncServer } from '../../src/sync/memoryServer';
import { ForbiddenError } from '../../src/sync/transport';

let dbCounter = 0;
let clock = 1_700_000_000_000;
const now = () => clock;

async function device(server: MemorySyncServer, userId: string, name: string, opts: { connected?: boolean } = {}) {
  const db = new PantryDB(`test-${++dbCounter}-${name}`);
  const deviceId = `dev${dbCounter}${name}`;
  const engine = await SyncEngine.create(db, deviceId, {
    transport: opts.connected === false ? null : server.transportFor(userId),
    now,
  });
  const repo = new PantryRepo(engine, () => name, () => new Date(clock).toISOString());
  return { db, engine, repo, userId, name };
}

type Dev = Awaited<ReturnType<typeof device>>;

async function snapshot(d: Dev, householdId: string) {
  const items = await d.db.shoppingListItems.where('householdId').equals(householdId).toArray();
  return items
    .map(({ _v, ...rest }) => rest)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

describe('sincronização entre dois aparelhos (Ian e Fernanda)', () => {
  let server: MemorySyncServer;
  let ian: Dev;
  let fer: Dev;
  let hid: string;
  let listId: string;

  beforeEach(async () => {
    server = new MemorySyncServer(now);
    ian = await device(server, 'user-ian', 'Ian');
    fer = await device(server, 'user-fer', 'Fernanda');
    // 2. Criação da Casa (local) + registro no servidor
    const { household, list } = await ian.repo.createHousehold('Casa Ian & Fernanda');
    hid = household.id;
    listId = list.id;
    server.createHousehold('user-ian', hid);
    await ian.engine.sync(hid);
    // 3. Convite do segundo usuário
    server.createInvite('user-ian', hid, 'CODE-1234');
    expect(server.acceptInvite('user-fer', 'CODE-1234')).toBe(hid);
    await fer.engine.sync(hid);
  });

  it('o segundo aparelho recebe a Casa e a lista ao entrar', async () => {
    expect((await fer.db.households.get(hid))?.name).toBe('Casa Ian & Fernanda');
    expect((await fer.repo.getDefaultList(hid))?.id).toBe(listId);
  });

  it('4–6. inclusão nos dois aparelhos e atualização sincronizada', async () => {
    await ian.repo.addItem(hid, listId, { name: 'Leite', quantity: 2, unit: 'l', category: 'Laticínios' });
    await fer.repo.addItem(hid, listId, { name: 'Pão', category: 'Padaria' });
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);
    const a = await snapshot(ian, hid);
    const b = await snapshot(fer, hid);
    expect(a).toEqual(b);
    expect(a.map((i) => i.name).sort()).toEqual(['Leite', 'Pão']);
    expect(a.find((i) => i.name === 'Pão')?.createdBy).toBe('Fernanda');
  });

  it('7–8. alterações offline são enviadas após reconexão', async () => {
    server.online = false;
    await ian.repo.addItem(hid, listId, { name: 'Arroz' });
    await fer.repo.addItem(hid, listId, { name: 'Feijão' });
    await ian.engine.sync(hid);
    expect(ian.engine.status).toBe('offline');
    expect(await ian.engine.pendingCount(hid)).toBe(1);
    // Dados continuam disponíveis localmente offline
    expect((await ian.repo.listItems(hid, listId)).map((i) => i.name)).toEqual(['Arroz']);

    server.online = true;
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);
    expect(await ian.engine.pendingCount(hid)).toBe(0);
    expect(await snapshot(ian, hid)).toEqual(await snapshot(fer, hid));
    expect((await snapshot(ian, hid)).map((i) => i.name).sort()).toEqual(['Arroz', 'Feijão']);
  });

  it('9. alterações simultâneas convergem e o valor perdedor é preservado', async () => {
    const { item } = await ian.repo.addItem(hid, listId, { name: 'Ovos', quantity: 12 });
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);

    server.online = false;
    clock += 1000;
    await ian.repo.updateItem(hid, item.id, { quantity: 6 });
    clock += 1000;
    await fer.repo.updateItem(hid, item.id, { quantity: 24 });
    await ian.repo.updateItem(hid, item.id, { checked: true }); // campo diferente: sem conflito
    server.online = true;

    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);

    const a = await snapshot(ian, hid);
    const b = await snapshot(fer, hid);
    expect(a).toEqual(b);
    expect(a[0]).toMatchObject({ quantity: 24, checked: true });

    const ca = await ian.db.conflicts.toArray();
    const cb = await fer.db.conflicts.toArray();
    expect(ca).toHaveLength(1);
    expect(cb.map((c) => c.id)).toEqual(ca.map((c) => c.id));
    expect(ca[0]).toMatchObject({ field: 'quantity', loserValue: 6, winnerValue: 24 });
  });

  it('itens duplicados criados offline são detectados e podem ser unidos', async () => {
    server.online = false;
    await ian.repo.addItem(hid, listId, { name: 'Café' });
    await fer.repo.addItem(hid, listId, { name: 'café ' });
    server.online = true;
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);
    const dups = findDuplicates(await ian.repo.listItems(hid, listId));
    expect(dups).toHaveLength(1);
    await ian.repo.mergeDuplicates(hid, dups[0]!);
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    const items = await fer.repo.listItems(hid, listId);
    expect(items).toHaveLength(1);
    expect(items[0]!.quantity).toBe(2);
  });

  it('adicionar item já existente soma a quantidade (sem duplicar)', async () => {
    await ian.repo.addItem(hid, listId, { name: 'Leite', quantity: 1, unit: 'l' });
    const r = await ian.repo.addItem(hid, listId, { name: 'LEITE', quantity: 2, unit: 'l' });
    expect(r.merged).toBe(true);
    expect((await ian.repo.listItems(hid, listId))).toHaveLength(1);
    expect(r.item.quantity).toBe(3);
  });

  it('exclusão é reversível e sincroniza', async () => {
    const { item } = await ian.repo.addItem(hid, listId, { name: 'Sabão' });
    await ian.repo.removeItem(hid, item.id);
    await ian.engine.sync(hid);
    await fer.engine.sync(hid);
    expect(await fer.repo.listItems(hid, listId)).toHaveLength(0);
    await fer.repo.restoreItem(hid, item.id);
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);
    expect((await ian.repo.listItems(hid, listId)).map((i) => i.name)).toEqual(['Sabão']);
  });

  it('push é idempotente (reenvio após falha não duplica)', async () => {
    await ian.repo.addItem(hid, listId, { name: 'Açúcar' });
    const before = server.countOps(hid);
    const pending = await ian.db.outbox.toArray();
    server.push('user-ian', hid, pending.map((p) => p.op)); // simula envio cuja resposta se perdeu
    await ian.engine.sync(hid);
    expect(server.countOps(hid)).toBe(before + pending.length);
  });

  it('paginação do pull aplica todas as operações', async () => {
    const small = await SyncEngine.create(new PantryDB(`test-${++dbCounter}-pg`), 'devPg', {
      transport: server.transportFor('user-fer'),
      now,
      pullLimit: 3,
    });
    for (let i = 0; i < 10; i++) await ian.repo.addItem(hid, listId, { name: `Item ${i}` });
    await ian.engine.sync(hid);
    await small.sync(hid);
    expect(await small.db.shoppingListItems.where('householdId').equals(hid).count()).toBe(10);
  });

  it('10. uma segunda Casa independente fica isolada', async () => {
    const amigo = await device(server, 'user-amigo', 'Amigo');
    const { household: h2, list: l2 } = await amigo.repo.createHousehold('Casa do Amigo');
    server.createHousehold('user-amigo', h2.id);
    await amigo.repo.addItem(h2.id, l2.id, { name: 'Cerveja' });
    await amigo.engine.sync(h2.id);
    await ian.repo.addItem(hid, listId, { name: 'Leite' });
    await ian.engine.sync(hid);

    // Amigo não consegue ler nem escrever na Casa do Ian
    await expect(server.transportFor('user-amigo').pull(hid, 0, 100)).rejects.toBeInstanceOf(ForbiddenError);
    const ianOps = (await ian.db.outbox.toArray()).map((o) => o.op);
    await ian.repo.addItem(hid, listId, { name: 'Segredo' });
    const stolen = (await ian.db.outbox.toArray()).map((o) => o.op);
    await expect(server.transportFor('user-amigo').push(hid, stolen)).rejects.toBeInstanceOf(ForbiddenError);
    expect(ianOps).toHaveLength(0);

    // Nem disfarçando a operação como sendo da própria Casa
    const disguised = stolen.map((o) => ({ ...o, householdId: h2.id }));
    await expect(server.transportFor('user-amigo').push(hid, disguised)).rejects.toBeInstanceOf(ForbiddenError);

    // E o aparelho do Ian nunca recebe dados do Amigo
    await ian.engine.sync(hid);
    expect(await ian.db.shoppingListItems.where('householdId').equals(h2.id).count()).toBe(0);
    expect(await amigo.db.shoppingListItems.where('householdId').equals(hid).count()).toBe(0);
  });

  it('cliente descarta operações de outra Casa mesmo se o servidor as entregar', async () => {
    const foreign = {
      opId: '33333333-3333-4333-8333-333333333333',
      householdId: '44444444-4444-4444-8444-444444444444',
      entity: 'shoppingListItems',
      entityId: '55555555-5555-4555-8555-555555555555',
      hlc: '000000000000001:000000:x',
      deviceId: 'x',
      fields: { name: 'intruso' },
      base: { name: null },
      seq: 999,
    };
    await ian.engine.applyRemote(hid, [foreign, { garbage: true, seq: 1000 }]);
    expect(await ian.db.shoppingListItems.get(foreign.entityId)).toBeUndefined();
  });

  it('membro removido perde acesso', async () => {
    server.removeMember(hid, 'user-fer');
    await fer.repo.addItem(hid, listId, { name: 'X' });
    await fer.engine.sync(hid);
    expect(fer.engine.status).toBe('forbidden');
    expect(await fer.engine.pendingCount(hid)).toBe(1); // nada é perdido localmente
  });

  it('convite não pode ser reutilizado nem usado após expirar', async () => {
    const outro = 'user-x';
    expect(() => server.acceptInvite(outro, 'CODE-1234')).toThrow(ForbiddenError);
    server.createInvite('user-ian', hid, 'CODE-EXP', 1000);
    clock += 2000;
    expect(() => server.acceptInvite(outro, 'CODE-EXP')).toThrow(ForbiddenError);
  });
});

describe('modo individual (sem servidor)', () => {
  it('funciona totalmente local e acumula operações para sincronizar depois', async () => {
    const server = new MemorySyncServer(now);
    const solo = await device(server, 'user-solo', 'Solo', { connected: false });
    const { household, list } = await solo.repo.createHousehold('Só eu');
    await solo.repo.addItem(household.id, list.id, { name: 'Banana' });
    expect(solo.engine.status).toBe('local-only');
    await solo.engine.sync(household.id);
    expect(await solo.engine.pendingCount(household.id)).toBe(3);

    // Depois decide compartilhar: conecta e envia tudo
    server.createHousehold('user-solo', household.id);
    solo.engine.setTransport(server.transportFor('user-solo'));
    await solo.engine.sync(household.id);
    expect(await solo.engine.pendingCount(household.id)).toBe(0);
    expect(server.countOps(household.id)).toBe(3);
  });
});
