/**
 * QA (Agente 7) — revisão adversarial do SQL/RLS.
 *
 * Roda a migração real em PGlite com o mesmo stub de auth.uid()/papéis usado em
 * supabase-rls.test.ts. Testes marcados com `it.fails` + "BUG:" demonstram
 * defeitos existentes (passam a falhar — e devem virar `it` — quando corrigidos).
 * Os demais são testes de regressão de propriedades que hoje estão corretas.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { validateOp } from '../../src/sync/validate';

const DONO = 'dddddddd-0000-4000-8000-000000000001';
const MEMBRO = 'dddddddd-0000-4000-8000-000000000002';
const ESTRANHO = 'dddddddd-0000-4000-8000-000000000003';
const OUTRO = 'dddddddd-0000-4000-8000-000000000004';

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
let hN = 0;
const newHid = () => `eeeeeeee-0000-4000-8000-${String(++hN).padStart(12, '0')}`;

async function as<T = Record<string, unknown>>(user: string | null, sql: string, params: unknown[] = []) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${user ?? ''}', false); set role ${user ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}

let opN = 0;
function op(household: string, fields: Record<string, unknown> = { name: 'Leite' }, extra: Record<string, unknown> = {}) {
  opN++;
  const id = `ffffffff-0000-4000-8000-${String(opN).padStart(12, '0')}`;
  return {
    opId: id,
    householdId: household,
    entity: 'shoppingListItems',
    entityId: id,
    hlc: `${String(1700000000000 + opN).padStart(15, '0')}:000000:devA`,
    deviceId: 'devA',
    fields,
    base: Object.fromEntries(Object.keys(fields).map((k) => [k, null])),
    ...extra,
  };
}

const push = (user: string, hid: string, ops: unknown[]) =>
  as<{ op_id: string }>(user, `select * from public.push_ops($1, $2::jsonb) as op_id`, [hid, JSON.stringify(ops)]);

async function invite(user: string, hid: string): Promise<string> {
  const [{ code }] = (await as<{ code: string }>(user, `select public.create_invitation($1) as code`, [hid])) as [{ code: string }];
  return code;
}

/** Casa com DONO (owner) e MEMBRO (member). */
async function casaComMembro(): Promise<string> {
  const hid = newHid();
  await as(DONO, `select public.create_household($1, 'Dono')`, [hid]);
  await as(MEMBRO, `select public.accept_invitation($1, 'Membro')`, [await invite(DONO, hid)]);
  return hid;
}

beforeAll(async () => {
  db = await PGlite.create({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  const dir = join(__dirname, '../../supabase/migrations');
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), 'utf8'));
});

describe('QA SQL — associação e convites', () => {
  // BUG (QA-01): remove_member permite que o dono remova a si mesmo. A Casa fica
  // sem dono: ninguém mais consegue remover membros, ver/revogar convites ou
  // apagar a Casa (delete_household exige is_owner) — dados ficam órfãos no servidor.
  it('CORRIGIDO QA-01: dono não deveria conseguir sair deixando a Casa sem dono', async () => {
    const hid = await casaComMembro();
    await expect(as(DONO, `select public.remove_member($1, $2)`, [hid, DONO])).rejects.toThrow();
  });

  it('QA-01 (corrigido): dono transfere a posse e sai; último membro a sair apaga a Casa (LGPD)', async () => {
    const hid = await casaComMembro();
    await push(MEMBRO, hid, [op(hid)]);
    await expect(as(DONO, `select public.remove_member($1, $2)`, [hid, DONO])).rejects.toThrow(/last owner/);
    await expect(as(MEMBRO, `select public.transfer_ownership($1, $2)`, [hid, MEMBRO])).rejects.toThrow(/forbidden/);
    await as(DONO, `select public.transfer_ownership($1, $2)`, [hid, MEMBRO]);
    await as(DONO, `select public.remove_member($1, $2)`, [hid, DONO]);
    const owners = await db.query<{ user_id: string }>(`select user_id from public.household_members where household_id = $1 and role = 'owner'`, [hid]);
    expect(owners.rows.map((r) => r.user_id)).toEqual([MEMBRO]);
    // O último membro sai: a Casa e o log são apagados (sem dados órfãos).
    await as(MEMBRO, `select public.remove_member($1, $2)`, [hid, MEMBRO]);
    const left = await db.query<{ n: number }>(`select count(*)::int n from public.sync_ops where household_id = $1`, [hid]);
    expect(left.rows[0]!.n).toBe(0);
  });

  // BUG (QA-02): qualquer membro cria convites (create_invitation só exige
  // is_member) e o convite sobrevive à remoção do autor. O membro removido pelo
  // dono usa o próprio código (gerado antes) e volta para a Casa.
  it('CORRIGIDO QA-02: membro removido não pode voltar usando convite que ele mesmo gerou', async () => {
    const hid = await casaComMembro();
    const backdoor = await invite(MEMBRO, hid);
    await as(DONO, `select public.remove_member($1, $2)`, [hid, MEMBRO]);
    await expect(as(MEMBRO, `select public.accept_invitation($1, 'Voltei')`, [backdoor])).rejects.toThrow(/invalid invitation/);
  });

  it('QA-02 (corrigido): o membro removido não recupera leitura do log', async () => {
    const hid = await casaComMembro();
    const backdoor = await invite(MEMBRO, hid);
    await as(DONO, `select public.remove_member($1, $2)`, [hid, MEMBRO]);
    await push(DONO, hid, [op(hid, { name: 'segredo' })]);
    await as(MEMBRO, `select public.accept_invitation($1, 'Voltei')`, [backdoor]).catch(() => undefined);
    const rows = await as(MEMBRO, `select fields from public.sync_ops where household_id = $1`, [hid]);
    expect(rows).toHaveLength(0);
  });

  it('QA-02: convite de outro membro (ainda na Casa) continua válido', async () => {
    const hid = await casaComMembro();
    const code = await invite(MEMBRO, hid);
    await expect(as(OUTRO, `select public.accept_invitation($1, 'Outro')`, [code])).resolves.toBeDefined();
  });

  // BUG (QA-03, baixa): aceitar um convite sendo já membro consome um uso
  // (on conflict do nothing, mas uses += 1 antes) — o convite real é "queimado".
  it('CORRIGIDO QA-03: membro existente que aceita convite não deveria consumir o uso', async () => {
    const hid = await casaComMembro();
    const code = await invite(DONO, hid);
    await as(MEMBRO, `select public.accept_invitation($1, 'de novo')`, [code]);
    await expect(as(OUTRO, `select public.accept_invitation($1, 'Outro')`, [code])).resolves.toBeDefined();
  });

  it('membro comum não vê nem revoga convites; não-dono não apaga a Casa', async () => {
    const hid = await casaComMembro();
    await invite(DONO, hid);
    expect(await as(MEMBRO, `select * from public.invitations where household_id = $1`, [hid])).toHaveLength(0);
    const [inv] = (await db.query<{ id: string }>(`select id from public.invitations where household_id = $1 limit 1`, [hid])).rows;
    await as(MEMBRO, `select public.revoke_invitation($1)`, [inv!.id]);
    const r = await db.query<{ revoked: boolean }>(`select revoked from public.invitations where id = $1`, [inv!.id]);
    expect(r.rows[0]!.revoked).toBe(false);
    await expect(as(MEMBRO, `select public.delete_household($1)`, [hid])).rejects.toThrow(/forbidden/);
    await expect(as(ESTRANHO, `select public.revoke_invitation($1)`, [inv!.id])).resolves.toBeDefined();
    const r2 = await db.query<{ revoked: boolean }>(`select revoked from public.invitations where id = $1`, [inv!.id]);
    expect(r2.rows[0]!.revoked).toBe(false);
  });

  it('membro não se promove a dono nem altera associação diretamente', async () => {
    const hid = await casaComMembro();
    await expect(as(MEMBRO, `update public.household_members set role = 'owner' where household_id = $1`, [hid])).rejects.toThrow(/permission denied/);
    await expect(as(MEMBRO, `delete from public.household_members where household_id = $1`, [hid])).rejects.toThrow(/permission denied/);
    await expect(as(MEMBRO, `update public.invitations set max_uses = 10`)).rejects.toThrow(/permission denied/);
    await expect(as(MEMBRO, `select public.remove_member($1, $2)`, [hid, DONO])).rejects.toThrow(/forbidden/);
  });

  it('código de convite: 16 caracteres do alfabeto de 32 (80 bits) e só o hash é salvo', async () => {
    const hid = await casaComMembro();
    const codes = new Set<string>();
    for (let i = 0; i < 5; i++) codes.add(await invite(DONO, hid));
    expect(codes.size).toBe(5);
    for (const c of codes) expect(c).toMatch(/^[A-HJ-NP-Z2-9]{16}$/);
  });

  it('anon não executa nenhuma RPC nem lê tabelas', async () => {
    const hid = await casaComMembro();
    for (const sql of [
      `select public.is_member('${hid}')`,
      `select public.accept_invitation('X', 'y')`,
      `select public.create_household('${newHid()}', 'x')`,
      `select * from public.push_ops('${hid}', '[]'::jsonb)`,
      `select public.delete_household('${hid}')`,
      `select * from public.households`,
      `select * from public.invitations`,
    ]) {
      await expect(as(null, sql)).rejects.toThrow(/permission denied/);
    }
  });

  it('toda função SECURITY DEFINER fixa search_path', async () => {
    const r = await db.query<{ proname: string; cfg: string[] | null }>(
      `select proname, proconfig cfg from pg_proc where pronamespace = 'public'::regnamespace and prosecdef`,
    );
    expect(r.rows.length).toBeGreaterThan(0);
    for (const f of r.rows) expect(f.cfg?.some((c) => c.startsWith('search_path='))).toBe(true);
  });
});

describe('QA SQL — push_ops e log', () => {
  // BUG (QA-04): o INSERT direto em sync_ops continua concedido a `authenticated`.
  // Isso contorna o pg_advisory_xact_lock de push_ops: uma transação concorrente
  // pode obter seq menor e commitar depois de outra com seq maior; quem fizer pull
  // nesse intervalo avança o cursor e PULA a operação de seq menor para sempre.
  // (A corrida em si não é reproduzível em PGlite — conexão única; aqui provamos
  // que o caminho sem lock está aberto.)
  it('CORRIGIDO QA-04: membro não deveria inserir em sync_ops sem passar por push_ops', async () => {
    const hid = await casaComMembro();
    const o = op(hid);
    await expect(
      as(MEMBRO, `insert into public.sync_ops(household_id, op_id, entity, entity_id, hlc, device_id, fields, base)
                  values ($1, $2, 'shoppingListItems', $2, $3, 'x', '{}', '{}')`, [hid, o.opId, o.hlc]),
    ).rejects.toThrow(/permission denied/);
  });

  // BUG (QA-05): o servidor aceita HLC arbitrariamente no futuro. Um membro (ou
  // aparelho com relógio errado) grava um campo com ms=999999999999999 e esse
  // valor vence o LWW para sempre — edições posteriores são descartadas em todos
  // os aparelhos (ver qa-sync.test.ts, QA-06).
  it('CORRIGIDO QA-05: servidor deveria recusar HLC muito à frente de now()', async () => {
    const hid = await casaComMembro();
    const o = op(hid, { name: 'travado' }, { hlc: '999999999999999:000000:devA' });
    // Correção: a op não é aceita (rejeição por operação) e não é gravada.
    expect(await push(MEMBRO, hid, [o])).toHaveLength(0);
    const n = await db.query<{ n: number }>(`select count(*)::int n from public.sync_ops where op_id = $1`, [o.opId]);
    expect(n.rows[0]!.n).toBe(0);
  });

  // BUG (QA-07, baixa): op_id é globalmente único. Se o op_id já existir em OUTRA
  // Casa, push_ops não insere nem devolve o id (nem erro): o cliente recebe
  // "Servidor não aceitou todas as operações" para sempre e a outbox trava (QA-08).
  it('CORRIGIDO QA-07: op_id já usado em outra Casa deveria gerar erro explícito', async () => {
    const h1 = await casaComMembro();
    const h2 = newHid();
    await as(ESTRANHO, `select public.create_household($1, 'x')`, [h2]);
    const victim = op(h1);
    await push(ESTRANHO, h2, [{ ...victim, householdId: h2 }]); // "squat" do op_id
    // Correção: unicidade (household_id, op_id) — o "squat" não afeta a Casa vítima.
    expect((await push(DONO, h1, [victim])).map((r) => r.op_id)).toEqual([victim.opId]);
  });

  it('QA-07 (corrigido): o op legítimo é aceito mesmo com op_id "ocupado" em outra Casa', async () => {
    const h1 = await casaComMembro();
    const h2 = newHid();
    await as(ESTRANHO, `select public.create_household($1, 'x')`, [h2]);
    const victim = op(h1);
    await push(ESTRANHO, h2, [{ ...victim, householdId: h2 }]);
    expect(await push(DONO, h1, [victim])).toHaveLength(1);
    // e o squatter não consegue ler a Casa vítima
    expect(await as(ESTRANHO, `select * from public.sync_ops where household_id = $1`, [h1])).toHaveLength(0);
  });

  // BUG (QA-09): limites de tamanho divergentes. O cliente aceita ops até 16 KiB
  // de JSON (validateOp/MAX_OP_BYTES), mas o servidor mede pg_column_size(jsonb),
  // que pode ser ~6x maior (ex.: arrays numéricos). O lote inteiro é rejeitado
  // por check constraint e a outbox fica travada (QA-08).
  it('CORRIGIDO QA-09: op aceita pelo validador do cliente deveria ser aceita pelo servidor', async () => {
    const hid = await casaComMembro();
    const o = op(hid, { lines: Array(2000).fill(0) });
    expect(() => validateOp(o)).not.toThrow();
    await expect(push(MEMBRO, hid, [o])).resolves.toHaveLength(1);
  });

  it('QA-08 (corrigido): uma op ruim não derruba as boas do mesmo lote', async () => {
    const hid = await casaComMembro();
    const good = op(hid);
    const bad = op(hid, { lines: Array(20000).fill(0) });
    const badName = op(hid, { householdId: 'x' });
    const acc = await push(MEMBRO, hid, [good, bad, badName, { lixo: true }]);
    expect(acc.map((r) => r.op_id)).toEqual([good.opId]);
  });

  it('lote com householdId divergente: só as ops da Casa do lote entram', async () => {
    const h1 = await casaComMembro();
    const h2 = newHid();
    await as(MEMBRO, `select public.create_household($1, 'minha')`, [h2]);
    const a = op(h1);
    const b = op(h2);
    const acc = await push(MEMBRO, h1, [a, b]);
    expect(acc.map((r) => r.op_id)).toEqual([a.opId]);
    const r = await db.query<{ household_id: string }>(`select household_id from public.sync_ops where op_id = $1`, [b.opId]);
    expect(r.rows).toHaveLength(0);
  });

  it('não-membro não usa push_ops para Casa alheia nem com householdId interno trocado', async () => {
    const h1 = await casaComMembro();
    const h2 = newHid();
    await as(ESTRANHO, `select public.create_household($1, 'x')`, [h2]);
    // lote "da minha Casa" com op interna apontando para a Casa vítima → descartada
    expect(await push(ESTRANHO, h2, [op(h1)])).toHaveLength(0);
    await expect(push(ESTRANHO, h1, [op(h1)])).rejects.toThrow(/forbidden/);
  });

  it('Casa: entity=households só para a própria Casa (constraint)', async () => {
    const hid = await casaComMembro();
    const o = { ...op(hid), entity: 'households', entityId: newHid() };
    expect(await push(MEMBRO, hid, [o])).toHaveLength(0);
  });

  it('lote acima de 200 é recusado', async () => {
    const hid = await casaComMembro();
    await expect(push(MEMBRO, hid, Array.from({ length: 201 }, () => op(hid)))).rejects.toThrow(/invalid batch/);
  });
});
