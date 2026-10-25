-- Applied 2026-10-25.
-- The app's new code expects this: join_household returns null on a wrong code, and the author is set server-side.
begin;

-- 1. Least-privilege table grants (RLS already blocks anon; this is defense in depth)
revoke all on public.households, public.household_members, public.items from anon;
revoke all on public.households, public.household_members, public.items from authenticated;
grant select on public.households to authenticated;
grant update (name) on public.households to authenticated;
grant select, delete on public.household_members to authenticated;
grant select, delete on public.items to authenticated;
grant insert (household_id, name, quantity) on public.items to authenticated;
grant update (name, quantity, checked) on public.items to authenticated;

-- 2. Server sets item author (no spoofing) and caps list size
create or replace function public.items_set_author()
returns trigger language plpgsql security definer set search_path = ''
as $$
begin
  new.added_by := auth.uid();
  select m.display_name into new.added_by_name from public.household_members m
   where m.household_id = new.household_id and m.user_id = auth.uid();
  new.added_by_name := split_part(coalesce(new.added_by_name,'Someone'),' ',1);
  if (select count(*) from public.items where household_id = new.household_id) >= 500 then
    raise exception 'This list has 500 items. Clear some before adding more.';
  end if;
  return new;
end $$;
revoke execute on function public.items_set_author() from public, anon, authenticated;
drop trigger if exists items_author on public.items;
create trigger items_author before insert on public.items for each row execute function public.items_set_author();

-- 3. Stronger invite codes: 10 chars from a 31-symbol alphabet (~50 bits)
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create or replace function private.new_invite_code()
returns text language sql volatile set search_path = ''
as $$ select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + (get_byte(b, i) % 31), 1), '')
      from (select extensions.gen_random_bytes(10) b) x, generate_series(0, 9) i $$;
alter table public.households alter column invite_code set default private.new_invite_code();
update public.households set invite_code = private.new_invite_code() where char_length(invite_code) < 10;

-- 4. Rate-limit wrong join codes: 10 per hour per user
create table if not exists private.join_attempts (user_id uuid not null, at timestamptz not null default now());
create index if not exists join_attempts_user_at on private.join_attempts(user_id, at);

drop function if exists public.join_household(text);
create function public.join_household(p_code text)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare hid uuid; u uuid := auth.uid();
begin
  if u is null then raise exception 'not authenticated'; end if;
  if (select count(*) from private.join_attempts where user_id = u and at > now() - interval '1 hour') >= 10 then
    raise exception 'Too many wrong codes. Try again in an hour.';
  end if;
  select id into hid from public.households where invite_code = upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  if hid is null then
    insert into private.join_attempts(user_id) values (u);  -- returns null instead of raising, so this insert is kept
    return null;
  end if;
  insert into public.household_members(household_id, user_id, display_name, avatar_url)
    select hid, u, left(coalesce(raw_user_meta_data->>'full_name', split_part(email,'@',1)), 60),
           case when raw_user_meta_data->>'avatar_url' ~ '^https://[a-z0-9-]+\.googleusercontent\.com/' then raw_user_meta_data->>'avatar_url' end
      from auth.users where id = u
    on conflict do nothing;
  return hid;
end $$;

-- 5. Create: sanitised profile, cap 20 households per user
create or replace function public.create_household(p_name text)
returns public.households language plpgsql security definer set search_path = ''
as $$
declare h public.households; u uuid := auth.uid();
begin
  if u is null then raise exception 'not authenticated'; end if;
  if (select count(*) from public.households where created_by = u) >= 20 then
    raise exception 'You can create up to 20 households.';
  end if;
  insert into public.households(name, created_by) values (left(coalesce(nullif(trim(p_name),''),'Home'), 60), u) returning * into h;
  insert into public.household_members(household_id, user_id, display_name, avatar_url)
    select h.id, u, left(coalesce(raw_user_meta_data->>'full_name', split_part(email,'@',1)), 60),
           case when raw_user_meta_data->>'avatar_url' ~ '^https://[a-z0-9-]+\.googleusercontent\.com/' then raw_user_meta_data->>'avatar_url' end
      from auth.users where id = u;
  return h;
end $$;

-- 6. Members can rotate a leaked invite code
create or replace function public.rotate_invite_code(p_household uuid)
returns text language plpgsql security definer set search_path = ''
as $$
declare c text;
begin
  if not public.is_member(p_household) then raise exception 'not a member'; end if;
  update public.households set invite_code = private.new_invite_code() where id = p_household returning invite_code into c;
  return c;
end $$;

revoke execute on function public.join_household(text), public.create_household(text), public.rotate_invite_code(uuid) from public, anon;
grant execute on function public.join_household(text), public.create_household(text), public.rotate_invite_code(uuid) to authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

-- 7. FK indexes
create index if not exists households_created_by_idx on public.households(created_by);
create index if not exists items_added_by_idx on public.items(added_by);

-- 8. Old token-based "shop" app: cut off API access (reversible, nothing deleted)
revoke execute on function public.shop_add_item(text,uuid,text), public.shop_add_list(text,text), public.shop_devices(text),
  public.shop_make_invite(text,boolean), public.shop_redeem(text,text), public.shop_rename_list(text,uuid,text),
  public.shop_revoke(text,uuid), public.shop_state(text), public.shop_toggle_item(text,uuid)
  from public, anon, authenticated;

commit;
