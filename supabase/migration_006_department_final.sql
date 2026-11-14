-- =====================================================================
-- Migration 006: department-level final round
--
-- Run once in Supabase ▸ SQL Editor if you already have the app running.
-- (A fresh install only needs schema.sql, which already includes this.)
--
-- What changes
--  • A seventh round, "Department-level final (intra-department hackathon)".
--    The top 5 of the 3rd-semester inter-section round and the top 5 of the
--    5th-semester inter-section round go into it, and its top 5 are the
--    department's final shortlist.
--  • The admin pulls the 10 finalists into it with the same "Pull shortlisted
--    teams" button used for the inter-section rounds.
--  • Teams keep their original Team ID (e.g. 3A-04, 5B-02) in every round.
-- =====================================================================

-- A department-level round belongs to no single semester.
alter table public.events alter column semester drop not null;

insert into public.events (code, name, semester, section, kind, feeds_into, sort)
values ('DEPT', 'Department-level final (intra-department hackathon)', null, null, 'inter', null, 7)
on conflict (code) do nothing;

update public.events
set feeds_into = (select id from public.events where code = 'DEPT')
where code in ('3-INTER', '5-INTER');

-- Renumbering a section round now also updates finalist copies at every level
-- (inter-section round and department final), in two passes so Team IDs never
-- clash part-way through.
create or replace function public.renumber_codes_internal(p_event int) returns int
language plpgsql security definer set search_path = public as $$
declare e public.events; n int; changed int;
begin
  select * into e from public.events where id = p_event;
  if e.kind <> 'intra' then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('team_code'), p_event);
  perform set_config('app.renumbering', 'on', true);
  update public.teams set team_code = '~' || id where event_id = p_event;
  with ordered as (select id, row_number() over (order by created_at, id) as rn
                   from public.teams where event_id = p_event)
  update public.teams t set team_code = e.code || '-' || lpad(o.rn::text, 2, '0')
  from ordered o where t.id = o.id;
  get diagnostics n = row_count;
  loop
    update public.teams c set team_code = '~' || c.id
    from public.teams o
    where c.origin_team_id = o.id and o.team_code not like '~%'
      and c.team_code is distinct from o.team_code;
    get diagnostics changed = row_count;
    exit when changed = 0;
    update public.teams c set team_code = o.team_code
    from public.teams o
    where c.origin_team_id = o.id and c.team_code like '~%' and o.team_code not like '~%';
  end loop;
  perform set_config('app.renumbering', 'off', true);
  return n;
end $$;
revoke execute on function public.renumber_codes_internal(int) from public, anon, authenticated;

notify pgrst, 'reload schema';
