import { describe, expect, it } from 'vitest';
import { HlcClock, compare, parse, serialize, MAX_DRIFT_MS } from '../../src/sync/hlc';
import { applyOp, mergeRecords, type AnyRecord } from '../../src/sync/merge';
import type { SyncOp } from '../../src/domain/types';
import { validateOp } from '../../src/sync/validate';

const HID = '11111111-1111-4111-8111-111111111111';
const EID = '22222222-2222-4222-8222-222222222222';
let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;

function op(hlc: string, fields: Record<string, unknown>, base: Record<string, string | null> = {}): SyncOp {
  const b: Record<string, string | null> = {};
  for (const k of Object.keys(fields)) b[k] = base[k] ?? null;
  return { opId: uuid(), householdId: HID, entity: 'shoppingListItems', entityId: EID, hlc, deviceId: parse(hlc).node, fields, base: b };
}

describe('HLC', () => {
  it('é monotônico mesmo com relógio parado ou voltando', () => {
    let t = 1000;
    const c = new HlcClock('devA', () => t);
    const a = c.tick();
    const b = c.tick();
    t = 500; // relógio voltou
    const d = c.tick();
    expect(compare(a, b)).toBeLessThan(0);
    expect(compare(b, d)).toBeLessThan(0);
  });

  it('receive() ordena eventos locais após eventos remotos', () => {
    const a = new HlcClock('devA', () => 1000);
    const b = new HlcClock('devB', () => 5000);
    const remote = b.tick();
    a.receive(remote);
    expect(compare(a.tick(), remote)).toBeGreaterThan(0);
  });

  it('não adota relógio remoto absurdamente adiantado', () => {
    const a = new HlcClock('devA', () => 1000);
    a.receive(serialize({ ms: 1000 + MAX_DRIFT_MS + 10, counter: 0, node: 'evil' }));
    expect(parse(a.tick()).ms).toBe(1000);
  });

  it('rejeita formatos inválidos', () => {
    expect(() => parse('abc')).toThrow();
    expect(() => new HlcClock('a b')).toThrow();
  });
});

describe('merge LWW por campo', () => {
  const h = (ms: number, node: string) => serialize({ ms, counter: 0, node });

  it('cria registro na primeira operação', () => {
    const r = applyOp(undefined, op(h(1, 'A'), { name: 'Leite' }), 'now');
    expect(r.record).toMatchObject({ id: EID, householdId: HID, name: 'Leite' });
    expect(r.conflicts).toHaveLength(0);
  });

  it('é comutativo: qualquer ordem converge', () => {
    const o1 = op(h(1, 'A'), { name: 'Leite', quantity: 1 });
    const o2 = op(h(2, 'B'), { quantity: 3 }, { quantity: h(1, 'A') });
    const o3 = op(h(3, 'A'), { checked: true });
    const perms = [
      [o1, o2, o3],
      [o3, o2, o1],
      [o2, o1, o3],
      [o3, o1, o2],
    ];
    const results = perms.map((p) => {
      let rec: AnyRecord | undefined;
      for (const o of p) rec = applyOp(rec, o, 'now').record;
      return JSON.stringify(Object.entries(rec!).sort(), (_k, v) =>
        v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v,
      );
    });
    expect(new Set(results).size).toBe(1);
  });

  it('é idempotente', () => {
    const o1 = op(h(1, 'A'), { name: 'Leite' });
    const r1 = applyOp(undefined, o1, 'now').record;
    const r2 = applyOp(r1, o1, 'now');
    expect(r2.changed).toBe(false);
    expect(r2.record).toEqual(r1);
  });

  it('detecta edição concorrente e preserva o valor perdedor', () => {
    const create = op(h(1, 'A'), { quantity: 1 });
    const base = { quantity: h(1, 'A') };
    const fromA = op(h(5, 'A'), { quantity: 2 }, base);
    const fromB = op(h(6, 'B'), { quantity: 4 }, base);
    let ra = applyOp(undefined, create, 'now').record;
    ra = applyOp(ra, fromA, 'now').record;
    const ca = applyOp(ra, fromB, 'now');
    let rb = applyOp(undefined, create, 'now').record;
    rb = applyOp(rb, fromB, 'now').record;
    const cb = applyOp(rb, fromA, 'now');
    expect(ca.record.quantity).toBe(4);
    expect(cb.record.quantity).toBe(4);
    expect(ca.conflicts).toHaveLength(1);
    expect(cb.conflicts).toHaveLength(1);
    expect(ca.conflicts[0]!.id).toBe(cb.conflicts[0]!.id);
    expect(ca.conflicts[0]!.loserValue).toBe(2);
  });

  it('não acusa conflito quando o autor via a versão atual', () => {
    const r = applyOp(undefined, op(h(1, 'A'), { quantity: 1 }), 'now').record;
    const res = applyOp(r, op(h(2, 'B'), { quantity: 2 }, { quantity: h(1, 'A') }), 'now');
    expect(res.conflicts).toHaveLength(0);
  });

  it('não acusa conflito entre edições sequenciais do mesmo aparelho', () => {
    let r = applyOp(undefined, op(h(1, 'A'), { quantity: 1 }), 'now').record;
    const first = op(h(2, 'A'), { quantity: 2 }, { quantity: h(1, 'A') });
    r = applyOp(r, first, 'now').record;
    r = applyOp(r, op(h(3, 'A'), { quantity: 3 }, { quantity: h(2, 'A') }), 'now').record;
    expect(applyOp(r, first, 'now').conflicts).toHaveLength(0);
  });

  it('não acusa conflito quando os valores concorrentes são iguais', () => {
    const r = applyOp(undefined, op(h(1, 'A'), { checked: false }), 'now').record;
    const r2 = applyOp(r, op(h(2, 'A'), { checked: true }, { checked: h(1, 'A') }), 'now').record;
    const res = applyOp(r2, op(h(3, 'B'), { checked: true }, { checked: h(1, 'A') }), 'now');
    expect(res.conflicts).toHaveLength(0);
  });

  it('recusa operação de outra Casa sobre registro existente', () => {
    const r = applyOp(undefined, op(h(1, 'A'), { name: 'x' }), 'now').record;
    const evil = { ...op(h(2, 'B'), { name: 'y' }), householdId: '99999999-9999-4999-8999-999999999999' };
    expect(() => applyOp(r, evil, 'now')).toThrow();
  });

  it('ignora tentativa de alterar campos protegidos', () => {
    const r = applyOp(undefined, op(h(1, 'A'), { name: 'x', _v: { name: 'zzz' } }), 'now').record;
    expect(r._v.name).toBe(h(1, 'A'));
  });

  it('mergeRecords escolhe a versão mais recente por campo', () => {
    const a: AnyRecord = { id: EID, householdId: HID, name: 'A', qty: 1, _v: { name: h(5, 'A'), qty: h(1, 'A') } };
    const b: AnyRecord = { id: EID, householdId: HID, name: 'B', qty: 9, _v: { name: h(2, 'B'), qty: h(3, 'B') } };
    expect(mergeRecords(a, b)).toMatchObject({ name: 'A', qty: 9 });
    expect(mergeRecords(b, a)).toMatchObject({ name: 'A', qty: 9 });
  });
});

describe('validação de operações', () => {
  const good = () => ({ ...op(serialize({ ms: 1, counter: 0, node: 'A' }), { name: 'Leite' }) });
  it('aceita operação válida', () => {
    expect(validateOp(good()).fields.name).toBe('Leite');
  });
  it.each([
    ['entidade desconhecida', { entity: 'users' }],
    ['uuid inválido', { entityId: 'abc' }],
    ['hlc inválido', { hlc: 'x' }],
    ['campo proibido', { fields: { householdId: 'x' }, base: { householdId: null } }],
    ['campo com nome estranho', { fields: { '__proto__x': 1 }, base: {} }],
    ['número não finito', { fields: { q: Infinity }, base: { q: null } }],
  ])('rejeita %s', (_n, patch) => {
    expect(() => validateOp({ ...good(), ...patch })).toThrow();
  });
  it('rejeita payload grande demais', () => {
    expect(() => validateOp({ ...good(), fields: { name: 'x'.repeat(20000) }, base: { name: null } })).toThrow();
  });
});
