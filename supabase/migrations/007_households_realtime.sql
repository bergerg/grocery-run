-- Applied 2026-11-05. Lets members see a list rename live (RLS limits events to members).
alter publication supabase_realtime add table public.households;
