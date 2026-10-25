-- Applied 2026-10-25. Households, members, items, RLS, realtime.
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 60),
  invite_code text not null unique default upper(substr(md5(gen_random_uuid()::text),1,6)),
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text, avatar_url text,
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index on public.household_members(user_id);
create table public.items (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  quantity text check (char_length(quantity) <= 30),
  checked boolean not null default false,
  added_by uuid references auth.users(id) on delete set null,
  added_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.items(household_id);

create or replace function public.is_member(hid uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.household_members m where m.household_id = hid and m.user_id = (select auth.uid())) $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at = now(); return new; end $$;
create trigger items_touch before update on public.items for each row execute function public.touch_updated_at();

alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.items enable row level security;

create policy "members read household" on public.households for select to authenticated using (public.is_member(id));
create policy "members rename household" on public.households for update to authenticated using (public.is_member(id)) with check (public.is_member(id));
create policy "members see members" on public.household_members for select to authenticated using (public.is_member(household_id));
create policy "leave household" on public.household_members for delete to authenticated using (user_id = (select auth.uid()));
create policy "members read items" on public.items for select to authenticated using (public.is_member(household_id));
create policy "members add items" on public.items for insert to authenticated with check (public.is_member(household_id));
create policy "members update items" on public.items for update to authenticated using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members delete items" on public.items for delete to authenticated using (public.is_member(household_id));

-- create_household / join_household v1 (replaced in 003)

alter table public.items replica identity full;
alter publication supabase_realtime add table public.items, public.household_members;
