/**
 * QA (Agente 7) — revisão adversarial do motor de sincronização, HLC e merge.
 * `it.fails` + "BUG:" = defeito demonstrado (deve virar `it` após a correção).
 */
import { describe, expect, it } from 'vitest';
import { PantryDB } from '../../src/db/db';
import { PantryRepo } from '../../src/db/repo';
import type { SyncOp } from '../../src/domain/types';
import { SyncEngine } from '../../src/sync/engine';
import { HlcClock, isValidHlc, serialize } from '../../src/sync/hlc';
import { MemorySyncServer } from '../../src/sync/memoryServer';
import { applyOp, type AnyRecord } from '../../src/sync/merge';
import type { SyncTransport } from '../../src/sync/transport';

const T0 = 1_700_000_000_000;
const HOUR = 3600_000;
let n = 0;
const uid = (p: string) => `${p}-0000-4000-8000-${String(++n).padStart(12, '0')}`;

async function localDevice(opts: { now?: () => number; transport?: SyncTransport | null; db?: PantryDB; deviceId?: string } = {}) {
  const db = opts.db ?? new PantryDB(`qa-sync-${++n}`);
  const deviceId = opts.deviceId ?? `qadev${n}`;
  const now = opts.now ?? (() => T0);
  const engine = await SyncEngine.create(db, deviceId, { now, transport: opts.transport ?? null });
  const repo = new PantryRepo(engine, () => 'QA', () => new Date(now()).toISOString());
  return { db, engine, repo, deviceId };
}

function remoteOp(hid: string, entityId: string, hlc: string, fields: Record<string, unknown>, base: Record<string, string | null>, seq: number): SyncOp {
  return {
    seq,
    opId: uid('abababab'),
    householdId: hid,
    entity: 'shoppingListItems',
    entityId,
    hlc,
    deviceId: hlc.split(':')[2]!,
    fields,
    base,
  };
}

describe('QA HLC', () => {
  // BUG (QA-10): HlcClock.receive soma 1 ao contador remoto sem limitar a
  // MAX_COUNTER. Um carimbo remoto "…:999999:x" (aceito pelo servidor e pelo
  // validador) gera um HLC de 7 dígitos, inválido; ele é persistido em kv
  // 'hlc:last' e, na próxima abertura do app, SyncEngine.create → parse() lança:
  // o app não inicializa mais até apagar os dados (DoS persistente por qualquer membro).
  it('CORRIGIDO QA-10: receive() com contador 999999 deve manter o relógio válido', () => {
    const c = new HlcClock('local', () => T0);
    c.receive(serialize({ ms: T0 + 1000, counter: 999_999, node: 'evil' }));
    expect(isValidHlc(c.current())).toBe(true);
  });

  it('CORRIGIDO QA-10 (efeito): após receber o carimbo, o motor não reabre (app "brickado")', async () => {
    const a = await localDevice();
    const { household, list } = await a.repo.createHousehold('Casa');
    const hlc = serialize({ ms: T0 + 1000, counter: 999_999, node: 'evil' });
    await a.engine.applyRemote(household.id, [remoteOp(household.id, list.id, hlc, { name: 'x' }, { name: null }, 1)]);
    // Reabre o app (mesmo banco / mesmo aparelho)
    await expect(SyncEngine.create(a.db, a.deviceId, { now: () => T0 })).resolves.toBeTruthy();
  });

  it('tick é monotônico mesmo com relógio de parede voltando no tempo', () => {
    let wall = T0;
    const c = new HlcClock('a', () => wall);
    const h1 = c.tick();
    wall = T0 - 10 * HOUR;
    const h2 = c.tick();
    expect(h2 > h1).toBe(true);
  });
});

describe('QA perda silenciosa de edições locais', () => {
  // BUG (QA-06): applyRemote aplica ops cujo HLC está além de MAX_DRIFT_MS, mas
  // o relógio local se recusa a adotá-lo. Daí em diante, toda edição local desse
  // campo gera um HLC menor que o gravado: mutate() grava a op na outbox, porém o
  // valor NÃO muda no aparelho (nem em nenhum outro) e nenhum conflito é criado.
  it('CORRIGIDO QA-06: edição local após op remota "do futuro" (> 24 h) deve valer', async () => {
    const a = await localDevice();
    const { household, list } = await a.repo.createHousehold('Casa');
    const { item } = await a.repo.addItem(household.id, list.id, { name: 'Leite' });
    const future = serialize({ ms: T0 + 48 * HOUR, counter: 0, node: 'relogioerrado' });
    await a.engine.applyRemote(household.id, [remoteOp(household.id, item.id, future, { name: 'Leite X' }, { name: item._v.name! }, 1)]);
    await a.repo.updateItem(household.id, item.id, { name: 'Café' });
    expect((await a.db.shoppingListItems.get(item.id))?.name).toBe('Café');
  });

  // BUG (QA-11): cada aba/instância tem seu próprio HlcClock em memória, mas
  // compartilha o mesmo IndexedDB e deviceId. Duas abas geram o MESMO HLC no
  // mesmo ms; a segunda edição é tratada como "eco" (curHlc === op.hlc) e
  // descartada localmente, enquanto os demais aparelhos aplicam a que chegar
  // primeiro pelo seq → divergência permanente. Com relógio da aba "atrasado"
  // (não viu ops remotas puxadas pela outra aba) a edição também é descartada.
  it('CORRIGIDO QA-11: duas abas no mesmo aparelho não podem descartar a edição uma da outra', async () => {
    const db = new PantryDB(`qa-tabs-${++n}`);
    const tab1 = await localDevice({ db, deviceId: 'mesmoaparelho' });
    const { household, list } = await tab1.repo.createHousehold('Casa');
    const { item } = await tab1.repo.addItem(household.id, list.id, { name: 'Leite' });
    const tab2 = await localDevice({ db, deviceId: 'mesmoaparelho' }); // nova aba
    await tab1.repo.updateItem(household.id, item.id, { quantity: 2 });
    await tab2.repo.updateItem(household.id, item.id, { quantity: 5 });
    const outbox = (await db.outbox.toArray()).filter((o) => o.op.entityId === item.id && 'quantity' in o.op.fields);
    expect(new Set(outbox.map((o) => o.op.hlc)).size).toBe(outbox.length); // HLCs distintos
    expect((await db.shoppingListItems.get(item.id))?.quantity).toBe(5);
  });
});

describe('QA outbox / push parcial', () => {
  // BUG (QA-08): se o servidor deixa de aceitar UMA op (push_ops descarta
  // silenciosamente op_id já existente em outra Casa; check constraint; op
  // inválida de backup — QA-12), pushAll lança "Servidor não aceitou todas as
  // operações" ANTES do pull. A op fica na cabeça da outbox para sempre: o
  // aparelho nunca mais recebe alterações dos outros moradores, sem aviso claro.
  it('CORRIGIDO QA-08: uma op recusada não pode impedir o pull das alterações dos outros', async () => {
    const server = new MemorySyncServer(() => T0);
    const real = server.transportFor('ian');
    const rejecting: SyncTransport = {
      pull: real.pull,
      push: async (hid, ops) => {
        const keep = ops.filter((o) => o.fields.name !== 'veneno');
        const r = await real.push(hid, keep);
        return { accepted: r.accepted };
      },
    };
    const ian = await localDevice({ transport: rejecting });
    const fer = await localDevice({ transport: server.transportFor('fer') });
    const { household, list } = await ian.repo.createHousehold('Casa');
    const hid = household.id;
    server.createHousehold('ian', hid);
    await ian.engine.sync(hid);
    server.createInvite('ian', hid, 'C');
    server.acceptInvite('fer', 'C');
    await fer.engine.sync(hid);

    await ian.repo.addItem(hid, list.id, { name: 'veneno' });
    await fer.repo.addItem(hid, list.id, { name: 'Pão' });
    await fer.engine.sync(hid);
    await ian.engine.sync(hid);
    await ian.engine.sync(hid);
    const names = (await ian.repo.listItems(hid, list.id)).map((i) => i.name);
    expect(names).toContain('Pão');
  });

  // BUG (QA-14, baixa): sync(h2) enquanto sync(h1) está em andamento devolve a
  // promessa de h1 — a outbox de h2 não é enviada e o chamador recebe o relatório errado.
  it('CORRIGIDO QA-14: sync de outra Casa durante um ciclo em andamento não é ignorado', async () => {
    const server = new MemorySyncServer(() => T0);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const t = server.transportFor('ian');
    const slow: SyncTransport = { push: async (h, o) => (await gate, t.push(h, o)), pull: t.pull };
    const d = await localDevice({ transport: slow });
    const a = await d.repo.createHousehold('A');
    const b = await d.repo.createHousehold('B');
    server.createHousehold('ian', a.household.id);
    server.createHousehold('ian', b.household.id);
    const p1 = d.engine.sync(a.household.id);
    const p2 = d.engine.sync(b.household.id);
    release();
    await Promise.all([p1, p2]);
    expect(await d.engine.pendingCount(b.household.id)).toBe(0);
  });

  it('push com erro de rede mantém a outbox intacta e em ordem', async () => {
    const server = new MemorySyncServer(() => T0);
    const d = await localDevice({ transport: server.transportFor('ian') });
    const { household, list } = await d.repo.createHousehold('Casa');
    server.createHousehold('ian', household.id);
    server.online = false;
    for (const name of ['a', 'b', 'c']) await d.repo.addItem(household.id, list.id, { name });
    await d.engine.sync(household.id);
    expect(d.engine.status).toBe('offline');
    const ob = await d.db.outbox.orderBy('seqLocal').toArray();
    expect(ob.length).toBe(5);
    server.online = true;
    await d.engine.sync(household.id);
    expect(await d.engine.pendingCount(household.id)).toBe(0);
    expect(server.countOps(household.id)).toBe(5);
  });
});

describe('QA pull / cursor', () => {
  it('ops inválidas ou de outra Casa são descartadas mas o cursor avança (sem travar)', async () => {
    const a = await localDevice();
    const { household, list } = await a.repo.createHousehold('Casa');
    const hid = household.id;
    const other = uid('cdcdcdcd');
    const good = remoteOp(hid, uid('12121212'), `${String(T0).padStart(15, '0')}:000001:remote`, { name: 'ok', listId: list.id }, { name: null, listId: null }, 30);
    await a.engine.applyRemote(hid, [
      { seq: 10, opId: 'lixo' },
      remoteOp(other, uid('12121212'), `${String(T0).padStart(15, '0')}:000000:remote`, { name: 'x' }, { name: null }, 20),
      { ...remoteOp(hid, uid('12121212'), `${String(T0).padStart(15, '0')}:000000:remote`, { __proto__x: 1 }, {}, 25) },
      { ...remoteOp(hid, uid('12121212'), `${String(T0).padStart(15, '0')}:000000:remote`, { householdId: other }, { householdId: null }, 26) },
      good,
    ]);
    expect(await a.db.getKV<number>(`cursor:${hid}`)).toBe(30);
    expect((await a.db.shoppingListItems.get(good.entityId))?.name).toBe('ok');
    expect(Object.prototype).not.toHaveProperty('x');
  });

  it('reaplicar o mesmo lote é idempotente (sem conflitos extras)', async () => {
    const a = await localDevice();
    const { household } = await a.repo.createHousehold('Casa');
    const hid = household.id;
    const id = uid('34343434');
    const ops = [
      remoteOp(hid, id, `${String(T0).padStart(15, '0')}:000000:devb`, { name: 'B' }, { name: null }, 1),
      remoteOp(hid, id, `${String(T0).padStart(15, '0')}:000000:devc`, { name: 'C' }, { name: null }, 2),
    ];
    await a.engine.applyRemote(hid, ops);
    const c1 = await a.db.conflicts.count();
    await a.engine.applyRemote(hid, ops);
    expect(await a.db.conflicts.count()).toBe(c1);
    expect(c1).toBe(1);
  });
});

describe('QA merge', () => {
  const H = 'aaaaaaaa-0000-4000-8000-0000000000aa';
  const E = 'aaaaaaaa-0000-4000-8000-0000000000ee';
  const mk = (hlc: string, value: string, base: string | null): SyncOp => ({
    opId: uid('56565656'),
    householdId: H,
    entity: 'shoppingListItems',
    entityId: E,
    hlc,
    deviceId: hlc.split(':')[2]!,
    fields: { name: value },
    base: { name: base },
  });
  const a1 = `${String(T0 + 1).padStart(15, '0')}:000000:devA`;
  const b1 = `${String(T0 + 2).padStart(15, '0')}:000000:devB`;
  const a2 = `${String(T0 + 3).padStart(15, '0')}:000000:devA`;
  const opA1 = mk(a1, 'Leite', null);
  const opB1 = mk(b1, 'Pão', null); // B não viu a1
  const opA2 = mk(a2, 'Leite desnatado', a1); // A corrige a própria edição

  function run(order: SyncOp[]) {
    let rec: AnyRecord | undefined;
    const ids: string[] = [];
    for (const o of order) {
      const r = applyOp(rec, o, 'now');
      rec = r.record;
      ids.push(...r.conflicts.map((c) => c.id));
    }
    return { rec: rec!, ids: ids.sort() };
  }

  it('convergência: o estado final independe da ordem de aplicação', () => {
    const orders = [
      [opA1, opA2, opB1],
      [opA1, opB1, opA2],
      [opB1, opA1, opA2],
      [opB1, opA2, opA1],
      [opA2, opB1, opA1],
      [opA2, opA1, opB1],
    ];
    const states = orders.map((o) => run(o).rec);
    for (const s of states) {
      expect(s.name).toBe('Leite desnatado');
      expect(s._v).toEqual(states[0]!._v);
    }
  });

  // BUG (QA-13, baixa): o conjunto de conflitos depende da ordem de chegada.
  // O aparelho A (aplica a1, a2 localmente e depois b1) registra 1 conflito;
  // B e qualquer terceiro aparelho que receba a1, b1, a2 registram 2 — incluindo
  // um "falso conflito" cujo perdedor (a1) já tinha sido substituído pelo próprio autor.
  // Contraria o comentário de merge.ts ("id determinístico, igual em todos os aparelhos").
  it.fails('BUG QA-13: conflitos registrados devem ser os mesmos em todos os aparelhos', () => {
    expect(run([opA1, opA2, opB1]).ids).toEqual(run([opA1, opB1, opA2]).ids);
  });

  it('campos protegidos (id, householdId, _v) nunca são sobrescritos por op', () => {
    const r = applyOp(undefined, { ...mk(a1, 'x', null), fields: { id: 'z', householdId: 'y', _v: {}, name: 'ok' } }, 'now');
    expect(r.record.id).toBe(E);
    expect(r.record.householdId).toBe(H);
    expect(r.record._v).toEqual({ name: a1 });
  });
});
