-- Run in the Supabase SQL editor. Lets the agent remove items and clear the cart.
create or replace function public.agent_remove(p_token text, p_items text[])
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c record; r text; iid uuid; done jsonb := '[]'; missing jsonb := '[]'; nm text;
begin
  select * into c from private.agent_ctx(p_token);
  if coalesce(array_length(p_items,1),0) > 50 then raise exception 'At most 50 items per call.'; end if;
  foreach r in array coalesce(p_items, '{}') loop
    iid := private.agent_find(c.household_id, r);
    if iid is null then missing := missing || to_jsonb(r); continue; end if;
    delete from public.items where id = iid returning name into nm;
    done := done || to_jsonb(nm);
  end loop;
  return jsonb_build_object('removed', done, 'not_found', missing);
end $$;

create or replace function public.agent_clear_cart(p_token text)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare c record; n int;
begin
  select * into c from private.agent_ctx(p_token);
  with d as (delete from public.items where household_id = c.household_id and checked returning 1) select count(*) into n from d;
  return jsonb_build_object('cleared', n);
end $$;

revoke execute on function public.agent_remove(text, text[]), public.agent_clear_cart(text) from public;
grant execute on function public.agent_remove(text, text[]), public.agent_clear_cart(text) to anon, authenticated;
