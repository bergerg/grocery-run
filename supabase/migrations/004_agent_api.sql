-- Applied 2026-10-25.
-- Agent API: personal access tokens scoped to one user + one household,
-- and token-authenticated RPCs used by the pantry-agent Edge Function (MCP + REST).
-- Tokens are 192-bit random, stored as SHA-256 only, shown once. A token stops working
-- if it's revoked or its owner leaves the household.

-- Item author: users are stamped by auth.uid(); agent RPCs (no JWT, server-side only) stamp it themselves.
create or replace function public.items_set_author()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.added_by := auth.uid();
    select m.display_name into new.added_by_name from public.household_members m
     where m.household_id = new.household_id and m.user_id = auth.uid();
    new.added_by_name := split_part(coalesce(new.added_by_name,'Someone'),' ',1);
  end if;
  if (select count(*) from public.items where household_id = new.household_id) >= 500 then
    raise exception 'This list has 500 items. Clear some before adding more.';
  end if;
  return new;
end $$;

create table if not exists public.api_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  token_hash bytea not null unique,
  token_hint text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);
create index if not exists api_tokens_user_idx on public.api_tokens(user_id);
create index if not exists api_tokens_household_idx on public.api_tokens(household_id);
alter table public.api_tokens enable row level security;
create policy "own tokens read" on public.api_tokens for select to authenticated using (user_id = (select auth.uid()));
create policy "own tokens revoke" on public.api_tokens for delete to authenticated using (user_id = (select auth.uid()));
revoke all on public.api_tokens from anon, authenticated;
grant select (id, user_id, household_id, name, token_hint, created_at, last_used_at) on public.api_tokens to authenticated;
grant delete on public.api_tokens to authenticated;

create or replace function public.create_api_token(p_household uuid, p_name text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare u uuid := auth.uid(); tok text; tid uuid;
begin
  if u is null then raise exception 'not authenticated'; end if;
  if not public.is_member(p_household) then raise exception 'not a member'; end if;
  if (select count(*) from public.api_tokens where user_id = u) >= 10 then
    raise exception 'You can have up to 10 agent tokens. Revoke one first.';
  end if;
  tok := 'pr_' || encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.api_tokens(user_id, household_id, name, token_hash, token_hint)
    values (u, p_household, left(coalesce(nullif(trim(p_name),''),'Agent'), 40), extensions.digest(tok, 'sha256'), right(tok, 4))
    returning id into tid;
  return jsonb_build_object('id', tid, 'token', tok);
end $$;
revoke execute on function public.create_api_token(uuid, text) from public, anon;
grant execute on function public.create_api_token(uuid, text) to authenticated;

-- Resolve a token to (user, household). Membership is re-checked on every call.
create or replace function private.agent_ctx(p_token text, out user_id uuid, out household_id uuid, out author text, out household_name text, out token_id uuid)
language plpgsql security definer set search_path = ''
as $$
declare used timestamptz;
begin
  select t.user_id, t.household_id, split_part(coalesce(m.display_name,'Someone'),' ',1) || ' via agent', h.name, t.id, t.last_used_at
    into user_id, household_id, author, household_name, token_id, used
    from public.api_tokens t
    join public.household_members m on m.household_id = t.household_id and m.user_id = t.user_id
    join public.households h on h.id = t.household_id
   where t.token_hash = extensions.digest(coalesce(p_token,''), 'sha256');
  if token_id is null then raise exception 'invalid or revoked token' using errcode = '28000'; end if;
  if used is null or used < now() - interval '5 minutes' then
    update public.api_tokens set last_used_at = now() where id = token_id;
  end if;
end $$;

-- Find an item by id, exact name, or a unique partial name match.
create or replace function private.agent_find(p_household uuid, p_ref text)
returns uuid language plpgsql stable security definer set search_path = ''
as $$
declare r text := trim(coalesce(p_ref,'')); found uuid; pat text; n int;
begin
  if r = '' then return null; end if;
  if r ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select id into found from public.items where id = r::uuid and household_id = p_household;
    if found is not null then return found; end if;
  end if;
  select id into found from public.items where household_id = p_household and lower(name) = lower(r) order by checked, created_at limit 1;
  if found is not null then return found; end if;
  pat := '%' || replace(replace(replace(r, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  select count(*), min(id::text)::uuid into n, found from public.items where household_id = p_household and name ilike pat;
  if n = 1 then return found; end if;
  return null;
end $$;

create or replace function public.agent_list(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c record;
begin
  select * into c from private.agent_ctx(p_token);
  return jsonb_build_object(
    'household', c.household_name,
    'to_buy', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'quantity', quantity, 'added_by', added_by_name) order by created_at)
                          from public.items where household_id = c.household_id and not checked), '[]'),
    'in_cart', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'quantity', quantity) order by updated_at desc)
                          from public.items where household_id = c.household_id and checked), '[]'));
end $$;

-- p_items: ["milk", {"name":"eggs","quantity":"12"}, ...]
create or replace function public.agent_add(p_token text, p_items jsonb)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c record; el jsonb; n text; q text; ex record;
        added jsonb := '[]'; already jsonb := '[]'; readded jsonb := '[]';
begin
  select * into c from private.agent_ctx(p_token);
  if jsonb_typeof(p_items) <> 'array' then raise exception 'items must be an array'; end if;
  if jsonb_array_length(p_items) > 50 then raise exception 'Add at most 50 items per call.'; end if;
  for el in select * from jsonb_array_elements(p_items) loop
    if jsonb_typeof(el) = 'string' then n := el #>> '{}'; q := null;
    else n := el->>'name'; q := el->>'quantity'; end if;
    n := left(trim(coalesce(n,'')), 120); q := left(nullif(trim(coalesce(q,'')),''), 30);
    if n = '' then continue; end if;
    select id, checked into ex from public.items where household_id = c.household_id and lower(name) = lower(n) order by checked, created_at limit 1;
    if ex.id is null then
      insert into public.items(household_id, name, quantity, added_by, added_by_name) values (c.household_id, n, q, c.user_id, c.author);
      added := added || to_jsonb(n);
    elsif ex.checked then
      update public.items set checked = false, quantity = coalesce(q, quantity) where id = ex.id;
      readded := readded || to_jsonb(n);
    else
      if q is not null then update public.items set quantity = q where id = ex.id; end if;
      already := already || to_jsonb(n);
    end if;
    ex := null;
  end loop;
  return jsonb_build_object('added', added, 'already_on_list', already, 'moved_back_from_cart', readded);
end $$;

create or replace function public.agent_check(p_token text, p_items text[], p_checked boolean default true)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c record; r text; iid uuid; done jsonb := '[]'; missing jsonb := '[]'; nm text;
begin
  select * into c from private.agent_ctx(p_token);
  if coalesce(array_length(p_items,1),0) > 50 then raise exception 'At most 50 items per call.'; end if;
  foreach r in array coalesce(p_items, '{}') loop
    iid := private.agent_find(c.household_id, r);
    if iid is null then missing := missing || to_jsonb(r); continue; end if;
    update public.items set checked = coalesce(p_checked, true) where id = iid returning name into nm;
    done := done || to_jsonb(nm);
  end loop;
  return jsonb_build_object(case when coalesce(p_checked,true) then 'checked' else 'unchecked' end, done, 'not_found', missing);
end $$;

-- agent_remove / agent_clear_cart: see 005_agent_remove.sql

-- Agent RPCs authenticate by token, so the Edge Function can call them with the publishable key.
revoke execute on function public.agent_list(text), public.agent_add(text, jsonb), public.agent_check(text, text[], boolean) from public;
grant execute on function public.agent_list(text), public.agent_add(text, jsonb), public.agent_check(text, text[], boolean) to anon, authenticated;
revoke execute on function private.agent_ctx(text), private.agent_find(uuid, text) from public, anon, authenticated;
