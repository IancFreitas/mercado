-- Smart Pantry — esquema do servidor de sincronização (Supabase/Postgres)
--
-- Princípios:
-- * O servidor é um "relay" com armazenamento: guarda o log de operações por Casa.
--   O estado materializado vive nos aparelhos (local-first).
-- * Isolamento por Casa garantido por RLS: toda leitura/escrita exige que
--   auth.uid() seja membro da Casa.
-- * Log append-only: não há UPDATE/DELETE em sync_ops para usuários.
-- * Convites: o código em texto puro nunca é armazenado (apenas SHA-256).
-- * Nenhuma chave de serviço é usada pelo app; só a anon key + JWT do usuário.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Tabelas
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'member' check (role in ('owner', 'member')),
  display_name text not null default '' check (char_length(display_name) <= 60),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members(user_id);

create table public.invitations (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  code_hash text not null unique,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  max_uses int not null default 1 check (max_uses between 1 and 10),
  uses int not null default 0,
  revoked boolean not null default false
);
create index invitations_household_idx on public.invitations(household_id);

create table public.sync_ops (
  seq bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  op_id uuid not null unique,
  entity text not null check (entity in (
    'households','stores','products','productAliases','purchases','purchaseItems',
    'inventory','inventoryMovements','shoppingLists','shoppingListItems','priceHistory'
  )),
  entity_id uuid not null,
  hlc text not null check (hlc ~ '^\d{15}:\d{6}:[A-Za-z0-9_-]{1,64}$'),
  device_id text not null check (device_id ~ '^[A-Za-z0-9_-]{1,64}$'),
  user_id uuid not null default auth.uid(),
  fields jsonb not null check (jsonb_typeof(fields) = 'object'),
  base jsonb not null check (jsonb_typeof(base) = 'object'),
  created_at timestamptz not null default now(),
  constraint sync_ops_size check (pg_column_size(fields) + pg_column_size(base) < 16384),
  constraint sync_ops_household_self check (entity <> 'households' or entity_id = household_id)
);
create index sync_ops_household_seq_idx on public.sync_ops(household_id, seq);

-- ---------------------------------------------------------------------------
-- Funções auxiliares
-- ---------------------------------------------------------------------------
create or replace function public.is_member(p_household uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_owner(p_household uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = p_household and m.user_id = auth.uid() and m.role = 'owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.invitations enable row level security;
alter table public.sync_ops enable row level security;

alter table public.households force row level security;
alter table public.household_members force row level security;
alter table public.invitations force row level security;
alter table public.sync_ops force row level security;

create policy households_select on public.households
  for select to authenticated using (public.is_member(id));

create policy members_select on public.household_members
  for select to authenticated using (public.is_member(household_id));

create policy invitations_select on public.invitations
  for select to authenticated using (public.is_owner(household_id));

create policy sync_ops_select on public.sync_ops
  for select to authenticated using (public.is_member(household_id));

create policy sync_ops_insert on public.sync_ops
  for insert to authenticated
  with check (public.is_member(household_id) and user_id = auth.uid());

-- Sem políticas de UPDATE/DELETE → negados por padrão.
revoke all on public.households, public.household_members, public.invitations, public.sync_ops from anon;
revoke update, delete, truncate on public.sync_ops from authenticated;
revoke insert, update, delete, truncate on public.households, public.household_members, public.invitations from authenticated;
grant select on public.households, public.household_members, public.invitations to authenticated;
grant select, insert on public.sync_ops to authenticated;

-- ---------------------------------------------------------------------------
-- RPCs (alterações de associação passam SOMENTE por aqui)
-- ---------------------------------------------------------------------------

-- Cria a Casa no servidor usando o id gerado no aparelho (modo individual → compartilhado).
create or replace function public.create_household(p_id uuid, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  insert into public.households(id, created_by) values (p_id, auth.uid());
  insert into public.household_members(household_id, user_id, role, display_name)
    values (p_id, auth.uid(), 'owner', left(coalesce(p_display_name, ''), 60));
  return p_id;
exception when unique_violation then
  raise exception 'household already exists' using errcode = '42501';
end;
$$;

-- Gera um convite. Retorna o código em texto puro UMA vez; só o hash é salvo.
create or replace function public.create_invitation(p_household uuid, p_ttl_hours int default 48)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_code text;
begin
  if not public.is_member(p_household) then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from public.invitations
        where household_id = p_household and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate limited' using errcode = '54000';
  end if;
  -- 80 bits de entropia, alfabeto sem caracteres ambíguos.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
    into v_code
    from (select extensions.gen_random_bytes(16) as b) r, generate_series(0, 15) i;
  insert into public.invitations(household_id, code_hash, expires_at)
    values (p_household, encode(extensions.digest(v_code, 'sha256'), 'hex'),
            now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 168)));
  return v_code;
end;
$$;

create or replace function public.accept_invitation(p_code text, p_display_name text)
returns uuid
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_inv public.invitations%rowtype;
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select * into v_inv from public.invitations
    where code_hash = encode(extensions.digest(upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g')), 'sha256'), 'hex')
    for update;
  if not found or v_inv.revoked or v_inv.uses >= v_inv.max_uses or v_inv.expires_at < now() then
    raise exception 'invalid invitation' using errcode = '42501';
  end if;
  update public.invitations set uses = uses + 1 where id = v_inv.id;
  insert into public.household_members(household_id, user_id, role, display_name)
    values (v_inv.household_id, auth.uid(), 'member', left(coalesce(p_display_name, ''), 60))
    on conflict (household_id, user_id) do nothing;
  return v_inv.household_id;
end;
$$;

create or replace function public.revoke_invitation(p_invitation uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.invitations set revoked = true
    where id = p_invitation and public.is_owner(household_id);
end;
$$;

-- Sair da Casa (qualquer membro) ou remover membro (somente dono).
create or replace function public.remove_member(p_household uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if p_user <> auth.uid() and not public.is_owner(p_household) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
end;
$$;

-- Push em lote: serializa escritas por Casa para que a ordem de `seq` seja
-- igual à ordem de commit (evita que um cliente "pule" operações no pull).
-- SECURITY INVOKER: as políticas RLS de sync_ops continuam valendo.
create or replace function public.push_ops(p_household uuid, p_ops jsonb)
returns setof uuid
language plpgsql security invoker set search_path = public
as $$
begin
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text, 0));
  return query
  with input as (
    select (o->>'opId')::uuid as op_id,
           (o->>'householdId')::uuid as household_id,
           o->>'entity' as entity,
           (o->>'entityId')::uuid as entity_id,
           o->>'hlc' as hlc,
           o->>'deviceId' as device_id,
           o->'fields' as fields,
           o->'base' as base
      from jsonb_array_elements(p_ops) o
  ), checked as (
    select * from input where household_id = p_household
  ), ins as (
    insert into public.sync_ops(household_id, op_id, entity, entity_id, hlc, device_id, fields, base)
    select household_id, op_id, entity, entity_id, hlc, device_id, fields, base from checked
    on conflict (op_id) do nothing
    returning op_id
  )
  select op_id from ins
  union
  -- já existentes (reenvio idempotente) — apenas os da própria Casa
  select s.op_id from public.sync_ops s join checked c on c.op_id = s.op_id
    where s.household_id = p_household;
end;
$$;

-- Exclusão de dados (LGPD): o dono apaga a Casa inteira no servidor.
create or replace function public.delete_household(p_household uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner(p_household) then raise exception 'forbidden' using errcode = '42501'; end if;
  delete from public.households where id = p_household;
end;
$$;

revoke all on function public.create_household(uuid, text), public.create_invitation(uuid, int),
  public.accept_invitation(text, text), public.revoke_invitation(uuid), public.remove_member(uuid, uuid),
  public.push_ops(uuid, jsonb), public.delete_household(uuid), public.is_member(uuid), public.is_owner(uuid)
  from public, anon;
grant execute on function public.create_household(uuid, text), public.create_invitation(uuid, int),
  public.accept_invitation(text, text), public.revoke_invitation(uuid), public.remove_member(uuid, uuid),
  public.push_ops(uuid, jsonb), public.delete_household(uuid), public.is_member(uuid), public.is_owner(uuid)
  to authenticated;
