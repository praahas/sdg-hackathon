-- =====================================================================
-- Migration 005: automatic, sequential Team IDs
--
-- Run once in Supabase ▸ SQL Editor if you already have the app running.
-- (A fresh install only needs schema.sql, which already includes this.)
--
-- What changes
--  • Every team in a section round gets its Team ID automatically:
--    3A-01, 3A-02 … 3B-01 … 5A-01 … 5B-01 …, in the order teams are added
--    (by the admin, by bulk paste, or by self-registration).
--  • Team IDs can't be typed or edited any more; finalists keep their
--    section Team ID in the inter-section round.
--  • Existing teams in section rounds are renumbered once, in the order they
--    were added, and their finalist copies are updated to match.
--  • Deleting a team leaves a gap; the admin can close gaps with
--    "Renumber teams" on the round's page.
-- =====================================================================

-- Internal: renumber one section round in the order teams were added.
create or replace function public.renumber_codes_internal(p_event int) returns int
language plpgsql security definer set search_path = public as $$
declare e public.events; n int;
begin
  select * into e from public.events where id = p_event;
  if e.kind <> 'intra' then return 0; end if;
  perform pg_advisory_xact_lock(hashtext('team_code'), p_event);
  perform set_config('app.renumbering', 'on', true);
  -- Two passes so the unique index never sees a clash mid-way.
  update public.teams set team_code = '~' || id where event_id = p_event;
  with ordered as (select id, row_number() over (order by created_at, id) as rn
                   from public.teams where event_id = p_event)
  update public.teams t set team_code = e.code || '-' || lpad(o.rn::text, 2, '0')
  from ordered o where t.id = o.id;
  get diagnostics n = row_count;
  -- Finalist copies carry the section Team ID.
  update public.teams c set team_code = o.team_code
  from public.teams o where c.origin_team_id = o.id and o.event_id = p_event;
  perform set_config('app.renumbering', 'off', true);
  return n;
end $$;
revoke execute on function public.renumber_codes_internal(int) from public, anon, authenticated;

-- Admin action: close gaps left by deleted teams.
create or replace function public.renumber_team_codes(p_event int) returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can renumber teams.'; end if;
  if (select kind from public.events where id = p_event) <> 'intra' then
    raise exception 'Only section rounds are numbered; finalists keep their section Team ID.';
  end if;
  return public.renumber_codes_internal(p_event);
end $$;
grant execute on function public.renumber_team_codes(int) to authenticated;

-- Assign the next Team ID on insert; keep it fixed on update.
create or replace function public.assign_team_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.events; n int;
begin
  if coalesce(current_setting('app.renumbering', true), 'off') = 'on' then return new; end if;
  select * into e from public.events where id = new.event_id;
  if e.kind <> 'intra' then return new; end if;
  if tg_op = 'UPDATE' and new.event_id = old.event_id then
    new.team_code := old.team_code;
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtext('team_code'), new.event_id);
  select coalesce(max((regexp_match(team_code, '^' || e.code || '-(\d+)$'))[1]::int), 0) + 1
    into n from public.teams where event_id = new.event_id;
  new.team_code := e.code || '-' || lpad(n::text, 2, '0');
  return new;
end $$;
drop trigger if exists teams_assign_code on public.teams;
create trigger teams_assign_code before insert or update on public.teams
  for each row execute function public.assign_team_code();

-- One-time renumbering of existing section rounds, then enforce uniqueness.
do $$
declare r record;
begin
  for r in select id from public.events where kind = 'intra' order by sort loop
    perform public.renumber_codes_internal(r.id);
  end loop;
end $$;
create unique index if not exists teams_event_code_unique on public.teams(event_id, team_code);

-- Self-registration no longer needs to work out the Team ID itself.
create or replace function public.register_team(
  p_event int, p_name text, p_members jsonb, p_phone text,
  p_primary int, p_secondary int, p_targets text, p_problem text) returns int
language plpgsql security definer set search_path = public as $$
declare e public.events; v_id int; v_email text;
begin
  if not public.is_team() then raise exception 'Only team accounts can register a team.'; end if;
  select * into e from public.events where id = p_event;
  if not found then raise exception 'That round does not exist.'; end if;
  if e.kind <> 'intra' then raise exception 'Teams register for their section round; finalists are chosen from there.'; end if;
  if not e.registration_open then raise exception 'Registration for % is closed.', e.name; end if;
  if exists (select 1 from public.teams t join public.events x on x.id = t.event_id
             where t.owner_id = auth.uid() and x.kind = 'intra') then
    raise exception 'This account has already registered a team. Edit that registration instead.';
  end if;
  perform public.check_team_details(p_event, null, p_name, p_members, p_primary, p_secondary, p_problem);
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.teams (event_id, name, members, member_list, primary_sdg, secondary_sdg,
                            problem, sdg_targets, owner_id, contact_email, contact_phone)
  values (p_event, trim(p_name), public.members_text(p_members), p_members,
          p_primary, p_secondary, trim(p_problem), nullif(trim(p_targets), ''), auth.uid(), v_email, nullif(trim(p_phone), ''))
  returning id into v_id;
  return v_id;
end $$;

notify pgrst, 'reload schema';
