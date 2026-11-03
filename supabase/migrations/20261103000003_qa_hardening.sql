-- Endurecimento após revisão de QA (docs/QA_REVIEW.md).
-- QA-01 Casa sem dono · QA-02 convite "porta dos fundos" · QA-03 uso queimado
-- QA-04 INSERT direto sem lock · QA-05 HLC do futuro · QA-07 op_id global
-- QA-08/09 lote tudo-ou-nada e limites divergentes · QA-18 rate limit por autor
-- QA-19 nó do HLC = device_id

-- QA-04: escrita no log SOMENTE via push_ops (que serializa por Casa).
revoke insert on public.sync_ops from authenticated;
drop policy if exists sync_ops_insert on public.sync_ops;

-- QA-07: unicidade de op_id por Casa (um op_id "ocupado" em outra Casa não bloqueia).
alter table public.sync_ops drop constraint if exists sync_ops_op_id_key;
alter table public.sync_ops add constraint sync_ops_household_op_key unique (household_id, op_id);

-- QA-09: limite pelo texto JSON (mesma métrica do cliente, com margem: cliente ≤ 8 KiB).
alter table public.sync_ops drop constraint if exists sync_ops_size;
alter table public.sync_ops add constraint sync_ops_size
  check (octet_length(fields::text) + octet_length(base::text) <= 16384);

-- Validação de uma op (espelha src/sync/validate.ts). Retorna null se válida, ou o motivo.
create or replace function public.op_invalid_reason(p_household uuid, o jsonb)
returns text
language plpgsql immutable set search_path = public
as $$
declare
  uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  k text;
begin
  if jsonb_typeof(o) <> 'object' then return 'not object'; end if;
  if coalesce(o->>'opId', '') !~ uuid_re then return 'opId'; end if;
  if coalesce(o->>'entityId', '') !~ uuid_re then return 'entityId'; end if;
  if coalesce(o->>'householdId', '') !~ uuid_re or (o->>'householdId')::uuid <> p_household then return 'household'; end if;
  if coalesce(o->>'entity', '') not in ('households','stores','products','productAliases','purchases','purchaseItems',
      'inventory','inventoryMovements','shoppingLists','shoppingListItems','priceHistory') then return 'entity'; end if;
  if o->>'entity' = 'households' and (o->>'entityId')::uuid <> p_household then return 'household self'; end if;
  if coalesce(o->>'deviceId', '') !~ '^[A-Za-z0-9_-]{1,64}$' then return 'deviceId'; end if;
  if coalesce(o->>'hlc', '') !~ '^\d{15}:\d{6}:[A-Za-z0-9_-]{1,64}$' then return 'hlc'; end if;
  -- QA-19: o nó do HLC é o próprio aparelho.
  if split_part(o->>'hlc', ':', 3) <> o->>'deviceId' then return 'hlc node'; end if;
  if jsonb_typeof(o->'fields') is distinct from 'object' or jsonb_typeof(o->'base') is distinct from 'object' then return 'fields/base'; end if;
  for k in select jsonb_object_keys(o->'fields') loop
    if k !~ '^[a-zA-Z][a-zA-Z0-9]{0,40}$' or k in ('id', 'householdId') then return 'field name'; end if;
  end loop;
  for k in select jsonb_object_keys(o->'base') loop
    if not (o->'fields') ? k then return 'base key'; end if;
  end loop;
  if octet_length((o->'fields')::text) + octet_length((o->'base')::text) > 16384 then return 'size'; end if;
  return null;
end;
$$;

-- Push em lote com rejeição POR OPERAÇÃO (QA-08): ops inválidas não são aceitas
-- (o cliente as move para uma fila de rejeitadas) e não derrubam as válidas.
-- SECURITY DEFINER com checagem explícita de associação (QA-04).
drop function if exists public.push_ops(uuid, jsonb);
create function public.push_ops(p_household uuid, p_ops jsonb)
returns setof uuid
language plpgsql security definer set search_path = public
as $$
declare
  o jsonb;
  v_max_ms bigint := (extract(epoch from now()) * 1000)::bigint + 86400000; -- QA-05: +24 h
begin
  if auth.uid() is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  if not public.is_member(p_household) then raise exception 'forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_ops) <> 'array' or jsonb_array_length(p_ops) > 200 then
    raise exception 'invalid batch' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_household::text, 0));
  for o in select * from jsonb_array_elements(p_ops) loop
    continue when public.op_invalid_reason(p_household, o) is not null;
    continue when left(o->>'hlc', 15)::bigint > v_max_ms;
    begin
      insert into public.sync_ops(household_id, op_id, entity, entity_id, hlc, device_id, user_id, fields, base)
      values (p_household, (o->>'opId')::uuid, o->>'entity', (o->>'entityId')::uuid, o->>'hlc',
              o->>'deviceId', auth.uid(), o->'fields', o->'base')
      on conflict (household_id, op_id) do nothing;
      return next (o->>'opId')::uuid; -- novo ou reenvio idempotente
    exception when check_violation or not_null_violation or invalid_text_representation then
      continue;
    end;
  end loop;
end;
$$;
revoke all on function public.push_ops(uuid, jsonb) from public, anon;
grant execute on function public.push_ops(uuid, jsonb) to authenticated;
revoke all on function public.op_invalid_reason(uuid, jsonb) from public, anon, authenticated;

-- QA-18: limite de convites por autor (um membro não esgota o limite do dono).
create or replace function public.create_invitation(p_household uuid, p_ttl_hours int default 48)
returns text
language plpgsql security definer set search_path = public, extensions
as $$
declare
  v_code text;
begin
  if not public.is_member(p_household) then raise exception 'forbidden' using errcode = '42501'; end if;
  if (select count(*) from public.invitations
        where household_id = p_household and created_by = auth.uid()
          and created_at > now() - interval '1 hour') >= 10 then
    raise exception 'rate limited' using errcode = '54000';
  end if;
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (get_byte(b, i) % 32) + 1, 1), '')
    into v_code
    from (select extensions.gen_random_bytes(16) as b) r, generate_series(0, 15) i;
  insert into public.invitations(household_id, code_hash, created_by, expires_at)
    values (p_household, encode(extensions.digest(v_code, 'sha256'), 'hex'), auth.uid(),
            now() + make_interval(hours => least(greatest(p_ttl_hours, 1), 168)));
  return v_code;
end;
$$;

-- QA-02: convite só vale se o autor ainda for membro. QA-03: já-membro não consome uso.
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
  if not found or v_inv.revoked or v_inv.uses >= v_inv.max_uses or v_inv.expires_at < now()
     or not exists (select 1 from public.household_members m
                    where m.household_id = v_inv.household_id and m.user_id = v_inv.created_by) then
    raise exception 'invalid invitation' using errcode = '42501';
  end if;
  if exists (select 1 from public.household_members m
             where m.household_id = v_inv.household_id and m.user_id = auth.uid()) then
    return v_inv.household_id;
  end if;
  update public.invitations set uses = uses + 1 where id = v_inv.id;
  insert into public.household_members(household_id, user_id, role, display_name)
    values (v_inv.household_id, auth.uid(), 'member', left(coalesce(p_display_name, ''), 60));
  return v_inv.household_id;
end;
$$;

-- QA-01: o único dono não sai enquanto houver outros membros (transfira antes);
-- o último membro a sair apaga a Casa (sem dados órfãos — LGPD).
-- QA-02: convites criados pelo removido são revogados.
create or replace function public.remove_member(p_household uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_role text;
begin
  if p_user <> auth.uid() and not public.is_owner(p_household) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  perform 1 from public.households where id = p_household for update;
  select role into v_role from public.household_members where household_id = p_household and user_id = p_user;
  if not found then return; end if;
  if (select count(*) from public.household_members where household_id = p_household) = 1 then
    delete from public.households where id = p_household; -- último membro: apaga tudo
    return;
  end if;
  if v_role = 'owner' and (select count(*) from public.household_members
                           where household_id = p_household and role = 'owner') = 1 then
    raise exception 'last owner: transfer ownership first' using errcode = '42501';
  end if;
  update public.invitations set revoked = true where household_id = p_household and created_by = p_user;
  delete from public.household_members where household_id = p_household and user_id = p_user;
end;
$$;

create or replace function public.transfer_ownership(p_household uuid, p_new_owner uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_owner(p_household) then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_new_owner = auth.uid() then return; end if;
  update public.household_members set role = 'owner' where household_id = p_household and user_id = p_new_owner;
  if not found then raise exception 'not a member' using errcode = '42501'; end if;
  update public.household_members set role = 'member' where household_id = p_household and user_id = auth.uid();
end;
$$;
revoke all on function public.transfer_ownership(uuid, uuid) from public, anon;
grant execute on function public.transfer_ownership(uuid, uuid) to authenticated;
