-- Applied 2026-11-05. Purchase history for the Insights page.
-- Every add / buy / un-buy / remove-without-buying is logged by a trigger on items.
-- Clearing bought items from the cart is not logged again (the purchase is already recorded).
create table if not exists public.item_events (
  id bigint generated always as identity primary key,
  household_id uuid not null references public.households(id) on delete cascade,
  item_id uuid,
  name text not null,
  quantity text,
  action text not null check (action in ('added','bought','unbought','removed')),
  actor_id uuid,
  actor_name text,
  at timestamptz not null default now()
);
create index if not exists item_events_hh_at on public.item_events(household_id, at desc);
alter table public.item_events enable row level security;
create policy "members read events" on public.item_events for select to authenticated using (public.is_member(household_id));
revoke all on public.item_events from anon, authenticated;
grant select on public.item_events to authenticated;

create or replace function private.log_item_event()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare r public.items; act text; who uuid := auth.uid(); nm text;
begin
  if TG_OP = 'INSERT' then
    r := new; act := 'added'; who := coalesce(new.added_by, who); nm := new.added_by_name;
  elsif TG_OP = 'UPDATE' then
    r := new;
    if new.checked and not old.checked then act := 'bought';
    elsif old.checked and not new.checked then act := 'unbought';
    else return new; end if;
  else
    r := old;
    if old.checked then return old; end if;
    act := 'removed';
  end if;
  if nm is null then
    select split_part(m.display_name,' ',1) into nm from public.household_members m
     where m.household_id = r.household_id and m.user_id = who;
    nm := coalesce(nm, case when who is null then 'Agent' end);
  end if;
  insert into public.item_events(household_id, item_id, name, quantity, action, actor_id, actor_name)
    values (r.household_id, r.id, r.name, r.quantity, act, who, nm);
  return r;
end $$;

create trigger items_log after insert or update of checked or delete on public.items
  for each row execute function private.log_item_event();

-- Backfill from items that existed when logging started
insert into public.item_events(household_id, item_id, name, quantity, action, actor_id, actor_name, at)
select i.household_id, i.id, i.name, i.quantity, 'added', i.added_by, i.added_by_name, i.created_at from public.items i
 where not exists (select 1 from public.item_events e where e.item_id = i.id and e.action = 'added');
insert into public.item_events(household_id, item_id, name, quantity, action, actor_id, actor_name, at)
select i.household_id, i.id, i.name, i.quantity, 'bought', null, null, i.updated_at from public.items i
 where i.checked and not exists (select 1 from public.item_events e where e.item_id = i.id and e.action = 'bought');
