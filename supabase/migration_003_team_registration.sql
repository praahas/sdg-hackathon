-- =====================================================================
-- Migration 003: team self-registration and team leaderboards
--
-- Run once in Supabase ▸ SQL Editor if you already have the app running.
-- (A fresh install only needs schema.sql, which already includes this.)
-- Existing teams, marks, ratings and settings are kept.
--
-- What changes
--  • A third account type, "team": one member signs up with their email and
--    registers the team in a section round the admin has opened.
--  • Admins still add teams themselves as before.
--  • Per round, the admin opens/closes registration and publishes/hides the
--    leaderboard. Teams see only their own round's leaderboard (and the
--    inter-section round's, if they are pulled into it), never evaluators'
--    individual marks or other teams' contact details.
-- =====================================================================

-- 1. Team accounts ---------------------------------------------------------
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'evaluator', 'team'));

-- Team sign-ups become "team"; the first non-team account is still the admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          case when coalesce(new.raw_user_meta_data ->> 'account_type', '') = 'team' then 'team'
               when exists (select 1 from public.profiles where role = 'admin') then 'evaluator'
               else 'admin' end);
  return new;
end $$;

create or replace function public.is_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'team');
$$;

-- 2. New columns -----------------------------------------------------------
alter table public.settings
  add column if not exists team_min_members int not null default 2,
  add column if not exists team_max_members int not null default 4;
alter table public.settings drop constraint if exists settings_team_size_check;
alter table public.settings add constraint settings_team_size_check
  check (team_min_members between 1 and 10 and team_max_members between team_min_members and 10);

alter table public.events
  add column if not exists registration_open     boolean not null default false,
  add column if not exists leaderboard_published boolean not null default false;

alter table public.teams
  add column if not exists owner_id      uuid references public.profiles(id) on delete set null,
  add column if not exists contact_email text,
  add column if not exists contact_phone text,
  add column if not exists sdg_targets   text,
  add column if not exists member_list   jsonb;
create index if not exists teams_owner_idx on public.teams(owner_id);

-- 3. Access rules ----------------------------------------------------------
-- Round names and dates are not secret: every signed-in user can list rounds.
drop policy if exists read_assigned on public.events;
drop policy if exists read_all on public.events;
create policy read_all on public.events for select to authenticated using (true);

-- A team account can read its own team rows (never other teams', never marks).
drop policy if exists own_team_read on public.teams;
create policy own_team_read on public.teams for select to authenticated
  using (owner_id = auth.uid());

-- 4. Registration --------------------------------------------------------------
-- p_members: JSON array of {"name": "...", "usn": "..."}.
create or replace function public.check_team_details(
  p_event int, p_team int, p_name text, p_members jsonb,
  p_primary int, p_secondary int, p_problem text) returns void
language plpgsql stable security definer set search_path = public as $$
declare s public.settings; n int;
begin
  select * into s from public.settings where id = 1;
  if coalesce(trim(p_name), '') = '' then raise exception 'Enter the team name.'; end if;
  if p_members is null or jsonb_typeof(p_members) <> 'array' then raise exception 'Add the team members.'; end if;
  select count(*) into n from jsonb_array_elements(p_members) m where coalesce(trim(m ->> 'name'), '') <> '';
  if n <> jsonb_array_length(p_members) then raise exception 'Every member needs a name.'; end if;
  if n < s.team_min_members or n > s.team_max_members then
    raise exception 'A team must have % to % members.', s.team_min_members, s.team_max_members;
  end if;
  if p_primary is null then raise exception 'Choose the primary SDG your solution addresses.'; end if;
  if p_secondary = p_primary then raise exception 'The secondary SDG must differ from the primary SDG.'; end if;
  if coalesce(trim(p_problem), '') = '' then raise exception 'Enter the problem statement.'; end if;
  if exists (select 1 from public.teams where event_id = p_event and id is distinct from p_team
             and lower(trim(name)) = lower(trim(p_name))) then
    raise exception 'A team called "%" is already registered in this round. Choose another name.', trim(p_name);
  end if;
end $$;

create or replace function public.members_text(p_members jsonb) returns text
language sql immutable as $$
  select string_agg(trim(m ->> 'name') ||
                    case when coalesce(trim(m ->> 'usn'), '') <> '' then ' (' || upper(trim(m ->> 'usn')) || ')' else '' end,
                    ', ' order by ord)
  from jsonb_array_elements(p_members) with ordinality as x(m, ord);
$$;

create or replace function public.register_team(
  p_event int, p_name text, p_members jsonb, p_phone text,
  p_primary int, p_secondary int, p_targets text, p_problem text) returns int
language plpgsql security definer set search_path = public as $$
declare e public.events; v_id int; v_no int; v_email text;
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
  select coalesce(max((regexp_match(team_code, '^' || e.code || '-(\d+)$'))[1]::int), 0) + 1
    into v_no from public.teams where event_id = p_event;
  select email into v_email from public.profiles where id = auth.uid();
  insert into public.teams (event_id, team_code, name, members, member_list, primary_sdg, secondary_sdg,
                            problem, sdg_targets, owner_id, contact_email, contact_phone)
  values (p_event, e.code || '-' || lpad(v_no::text, 2, '0'), trim(p_name), public.members_text(p_members), p_members,
          p_primary, p_secondary, trim(p_problem), nullif(trim(p_targets), ''), auth.uid(), v_email, nullif(trim(p_phone), ''))
  returning id into v_id;
  return v_id;
end $$;

-- Teams can edit their registration while registration is open and before any marks.
create or replace function public.update_my_team(
  p_team int, p_name text, p_members jsonb, p_phone text,
  p_primary int, p_secondary int, p_targets text, p_problem text) returns void
language plpgsql security definer set search_path = public as $$
declare t public.teams; e public.events;
begin
  select * into t from public.teams where id = p_team;
  if not found or t.owner_id is distinct from auth.uid() then raise exception 'You can only edit your own team.'; end if;
  select * into e from public.events where id = t.event_id;
  if not e.registration_open then raise exception 'Registration for % is closed, so details can no longer be changed. Contact the coordinator.', e.name; end if;
  if exists (select 1 from public.scores where team_id = p_team) or exists (select 1 from public.sdg_ratings where team_id = p_team) then
    raise exception 'Evaluation of your team has started, so details can no longer be changed. Contact the coordinator.';
  end if;
  perform public.check_team_details(t.event_id, p_team, p_name, p_members, p_primary, p_secondary, p_problem);
  update public.teams set name = trim(p_name), members = public.members_text(p_members), member_list = p_members,
         primary_sdg = p_primary, secondary_sdg = p_secondary, problem = trim(p_problem),
         sdg_targets = nullif(trim(p_targets), ''), contact_phone = nullif(trim(p_phone), '')
  where id = p_team;
end $$;

-- 5. Leaderboards ----------------------------------------------------------
-- Teams see a round's leaderboard only if it is published and they are in it.
create or replace function public.can_see_leaderboard(p_event int) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin()
      or (exists (select 1 from public.events where id = p_event and leaderboard_published)
          and exists (select 1 from public.teams where event_id = p_event and owner_id = auth.uid()));
$$;

create or replace function public.round_leaderboard(p_event int)
returns table (rank int, team_code text, team_name text, primary_sdg int, secondary_sdg int,
               total numeric, max_total numeric, pct numeric, status text, is_mine boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.can_see_leaderboard(p_event) then
    raise exception 'The leaderboard for this round has not been published yet.';
  end if;
  return query
  select r.rank::int, t.team_code, t.name, t.primary_sdg, t.secondary_sdg,
         round(r.total, 2), r.max_total, r.pct, r.status, coalesce(t.owner_id = auth.uid(), false)
  from public.teams t
  left join public.v_team_result r on r.team_id = t.id
  where t.event_id = p_event
  order by r.rank nulls last, t.team_code, t.id;
end $$;

-- A team's own breakdown: average mark per criterion and SDG contribution strength.
create or replace function public.my_team_breakdown(p_event int)
returns table (item_kind text, sort int, label text, max_value numeric, avg_value numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_team int;
begin
  if not public.can_see_leaderboard(p_event) then
    raise exception 'The leaderboard for this round has not been published yet.';
  end if;
  select id into v_team from public.teams where event_id = p_event and owner_id = auth.uid() limit 1;
  if v_team is null then return; end if;
  return query
  select 'criterion'::text, c.sort, c.name, c.max_marks, round(tc.avg_score, 2)
  from public.v_team_criterion tc join public.criteria c on c.id = tc.criterion_id
  where tc.team_id = v_team
  union all
  select 'sdg', case when g.is_primary then 1 else 2 end, 'SDG ' || g.sdg_id || ': ' || s.name, 3::numeric, round(g.avg_strength, 2)
  from public.v_team_sdg_strength g join public.sdgs s on s.id = g.sdg_id
  where g.team_id = v_team
  order by 1, 2;
end $$;

-- 6. Finalists keep their team account link ---------------------------------
create or replace function public.promote_shortlist(p_inter int) returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then
    raise exception 'Only admins can pull shortlisted teams.';
  end if;
  if (select kind from public.events where id = p_inter) <> 'inter' then
    raise exception 'Shortlisted teams can only be pulled into an inter-section round.';
  end if;
  if exists (select 1 from public.scores s join public.teams t on t.id = s.team_id where t.event_id = p_inter)
     or exists (select 1 from public.sdg_ratings r join public.teams t on t.id = r.team_id where t.event_id = p_inter) then
    raise exception 'This round already has marks or SDG ratings. Clear them before pulling the shortlist again.';
  end if;
  delete from public.teams where event_id = p_inter and origin_team_id is not null;
  insert into public.teams (event_id, team_code, name, members, member_list, primary_sdg, secondary_sdg, problem,
                            sdg_targets, owner_id, contact_email, contact_phone, origin_team_id)
  select p_inter, t.team_code, t.name, t.members, t.member_list, t.primary_sdg, t.secondary_sdg, t.problem,
         t.sdg_targets, t.owner_id, t.contact_email, t.contact_phone, t.id
  from public.v_team_result r
  join public.teams  t on t.id = r.team_id
  join public.events e on e.id = t.event_id
  where e.feeds_into = p_inter and r.status = 'Shortlisted'
  order by e.sort, r.rank;
  get diagnostics n = row_count;
  return n;
end $$;

grant execute on function public.register_team(int, text, jsonb, text, int, int, text, text),
                          public.update_my_team(int, text, jsonb, text, int, int, text, text),
                          public.round_leaderboard(int), public.my_team_breakdown(int),
                          public.can_see_leaderboard(int), public.is_team() to authenticated;
revoke execute on function public.check_team_details(int, int, text, jsonb, int, int, text) from public, anon;

notify pgrst, 'reload schema';
