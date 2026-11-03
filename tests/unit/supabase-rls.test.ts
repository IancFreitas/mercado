/**
 * Testa a migração SQL real (supabase/migrations) em Postgres (PGlite/WASM),
 * simulando os papéis do Supabase (`authenticated`, `anon`) e `auth.uid()`.
 * Valida isolamento entre Casas, convites e imutabilidade do log.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { beforeAll, describe, expect, it } from 'vitest';

const IAN = 'aaaaaaaa-0000-4000-8000-000000000001';
const FER = 'aaaaaaaa-0000-4000-8000-000000000002';
const AMIGO = 'aaaaaaaa-0000-4000-8000-000000000003';
const H1 = 'bbbbbbbb-0000-4000-8000-000000000001';
const H2 = 'bbbbbbbb-0000-4000-8000-000000000002';

const SUPABASE_STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create schema auth;
  create schema extensions;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth, extensions, public to anon, authenticated;
`;

let db: PGlite;

async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

let opN = 0;
function op(household: string, fields: Record<string, unknown> = { name: 'Leite' }, entity = 'shoppingListItems') {
  opN++;
  const id = `cccccccc-0000-4000-8000-${String(opN).padStart(12, '0')}`;
  return {
    opId: id,
    householdId: household,
    entity,
    entityId: entity === 'households' ? household : id,
    hlc: `${String(1700000000000 + opN).padStart(15, '0')}:000000:devA`,
    deviceId: 'devA',
    fields,
    base: Object.fromEntries(Object.keys(fields).map((k) => [k, null])),
  };
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const dir = join(__dirname, '../../supabase/migrations');
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));
  await as(IAN, `select public.create_household($1, 'Ian')`, [H1]);
  await as(AMIGO, `select public.create_household($1, 'Amigo')`, [H2]);
});

describe('Supabase: RLS e RPCs', () => {
  it('membro grava e lê operações da própria Casa', async () => {
    const o = op(H1);
    const acc = await as(IAN, `select * from public.push_ops($1, $2::jsonb) as op_id`, [H1, JSON.stringify([o])]);
    expect(acc.map((r) => r.op_id)).toEqual([o.opId]);
    const rows = await as(IAN, `select op_id, user_id from public.sync_ops where household_id = $1`, [H1]);
    expect(rows).toEqual([{ op_id: o.opId, user_id: IAN }]);
  });

  it('push é idempotente', async () => {
    const o = op(H1);
    await as(IAN, `select * from public.push_ops($1, $2::jsonb)`, [H1, JSON.stringify([o])]);
    const again = await as(IAN, `select * from public.push_ops($1, $2::jsonb) as op_id`, [H1, JSON.stringify([o])]);
    expect(again.map((r) => r.op_id)).toEqual([o.opId]);
    const n = await as<{ n: number }>(IAN, `select count(*)::int n from public.sync_ops where op_id = $1`, [o.opId]);
    expect(n[0]!.n).toBe(1);
  });

  it('não-membro não lê dados de outra Casa', async () => {
    const rows = await as(AMIGO, `select * from public.sync_ops where household_id = $1`, [H1]);
    expect(rows).toHaveLength(0);
    const hh = await as(AMIGO, `select id from public.households`);
    expect(hh.map((r) => r.id)).toEqual([H2]);
    const mem = await as(AMIGO, `select * from public.household_members where household_id = $1`, [H1]);
    expect(mem).toHaveLength(0);
  });

  it('não-membro não escreve em outra Casa (RPC nem insert direto)', async () => {
    await expect(as(AMIGO, `select * from public.push_ops($1, $2::jsonb)`, [H1, JSON.stringify([op(H1)])])).rejects.toThrow(/forbidden/);
    const o = op(H1);
    await expect(
      as(AMIGO, `insert into public.sync_ops(household_id, op_id, entity, entity_id, hlc, device_id, fields, base)
                 values ($1, $2, 'shoppingListItems', $2, $3, 'x', '{}', '{}')`, [H1, o.opId, o.hlc]),
    ).rejects.toThrow(/permission denied/);
  });

  it('operações com householdId diferente do lote são descartadas', async () => {
    const foreign = op(H2);
    const acc = await as(IAN, `select * from public.push_ops($1, $2::jsonb) as op_id`, [H1, JSON.stringify([foreign])]);
    expect(acc).toHaveLength(0);
  });

  it('não é possível forjar user_id de outra pessoa', async () => {
    const o = op(H1);
    await expect(
      as(IAN, `insert into public.sync_ops(household_id, op_id, entity, entity_id, hlc, device_id, fields, base, user_id)
               values ($1, $2, 'shoppingListItems', $2, $3, 'x', '{}', '{}', $4)`, [H1, o.opId, o.hlc, FER]),
    ).rejects.toThrow(/permission denied/);
    // via push_ops o user_id é sempre auth.uid()
    const o2 = op(H1);
    await as(IAN, `select * from public.push_ops($1, $2::jsonb)`, [H1, JSON.stringify([{ ...o2, userId: FER, user_id: FER }])]);
    const r = await db.query<{ user_id: string }>(`select user_id from public.sync_ops where op_id = $1`, [o2.opId]);
    expect(r.rows[0]!.user_id).toBe(IAN);
  });

  it('log é imutável (sem UPDATE/DELETE)', async () => {
    await expect(as(IAN, `update public.sync_ops set fields = '{}' where household_id = $1`, [H1])).rejects.toThrow(/permission denied/);
    await expect(as(IAN, `delete from public.sync_ops where household_id = $1`, [H1])).rejects.toThrow(/permission denied/);
  });

  it('usuário não consegue se auto-adicionar a uma Casa', async () => {
    await expect(
      as(AMIGO, `insert into public.household_members(household_id, user_id) values ($1, $2)`, [H1, AMIGO]),
    ).rejects.toThrow(/permission denied/);
  });

  it('anon não acessa nada', async () => {
    await expect(as(null, `select * from public.sync_ops`)).rejects.toThrow(/permission denied/);
    await expect(as(null, `select public.create_invitation($1)`, [H1])).rejects.toThrow(/permission denied/);
  });

  it('fluxo de convite: criar, aceitar, não reutilizar', async () => {
    const [{ code }] = (await as<{ code: string }>(IAN, `select public.create_invitation($1) as code`, [H1])) as [{ code: string }];
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
    // Código em texto puro não é armazenado
    const stored = await db.query<{ n: number }>(`select count(*)::int n from public.invitations where code_hash = $1`, [code]);
    expect(stored.rows[0]!.n).toBe(0);
    // Não-membro não cria convite para Casa alheia
    await expect(as(AMIGO, `select public.create_invitation($1)`, [H1])).rejects.toThrow(/forbidden/);
    // Fernanda aceita (com formatação diferente)
    const pretty = code.toLowerCase().replace(/(.{4})/g, '$1-');
    const [{ hid }] = (await as<{ hid: string }>(FER, `select public.accept_invitation($1, 'Fernanda') as hid`, [pretty])) as [{ hid: string }];
    expect(hid).toBe(H1);
    const rows = await as(FER, `select count(*)::int n from public.sync_ops where household_id = $1`, [H1]);
    expect((rows[0] as { n: number }).n).toBeGreaterThan(0);
    // Reuso negado
    await expect(as(AMIGO, `select public.accept_invitation($1, 'x')`, [code])).rejects.toThrow(/invalid invitation/);
  });

  it('convite expirado ou revogado é recusado', async () => {
    const [{ code }] = (await as<{ code: string }>(IAN, `select public.create_invitation($1) as code`, [H1])) as [{ code: string }];
    await db.query(`update public.invitations set expires_at = now() - interval '1 minute' where code_hash = encode(extensions.digest($1, 'sha256'), 'hex')`, [code]);
    await expect(as(AMIGO, `select public.accept_invitation($1, 'x')`, [code])).rejects.toThrow(/invalid invitation/);
  });

  it('membro comum não remove outros; pode sair; perde acesso ao sair', async () => {
    await expect(as(FER, `select public.remove_member($1, $2)`, [H1, IAN])).rejects.toThrow(/forbidden/);
    await as(FER, `select public.remove_member($1, $2)`, [H1, FER]);
    const rows = await as(FER, `select * from public.sync_ops where household_id = $1`, [H1]);
    expect(rows).toHaveLength(0);
  });

  it('Casa duplicada é recusada (não sequestra id existente)', async () => {
    await expect(as(AMIGO, `select public.create_household($1, 'x')`, [H1])).rejects.toThrow(/already exists/);
  });

  it('valida formato da operação no banco', async () => {
    const bad = { ...op(H1), entity: 'users' };
    const acc = await as(IAN, `select * from public.push_ops($1, $2::jsonb) as op_id`, [H1, JSON.stringify([bad])]);
    expect(acc).toHaveLength(0);
  });

  it('dono pode apagar a Casa inteira (LGPD)', async () => {
    await as(AMIGO, `select * from public.push_ops($1, $2::jsonb)`, [H2, JSON.stringify([op(H2)])]);
    await expect(as(IAN, `select public.delete_household($1)`, [H2])).rejects.toThrow(/forbidden/);
    await as(AMIGO, `select public.delete_household($1)`, [H2]);
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.sync_ops where household_id = $1`, [H2]);
    expect(n.rows[0]!.n).toBe(0);
  });
});
