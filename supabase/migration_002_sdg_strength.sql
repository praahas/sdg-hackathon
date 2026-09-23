-- =====================================================================
-- Migration 002: SDG attainment from evaluators' contribution-strength ratings
--
-- Run this ONCE in Supabase ▸ SQL Editor if you already ran the original
-- schema.sql. (A fresh install only needs the updated schema.sql, which
-- already includes this.) Existing teams, marks and settings are kept.
--
-- What changes
--  • Evaluators rate how strongly each solution advances each SDG the team
--    claims (primary and, if any, secondary) on a 0–3 scale:
--      3 High, 2 Medium, 1 Low, 0 None.
--  • SDG attainment = average of those strengths (0–3). Also reported: the
--    share of solutions rated at or above a target strength (default 2).
--  • The old "SDG" column of the rubric mapping is removed, so rubric marks
--    now feed only POs and PSOs. Team totals and ranks are unchanged.
-- =====================================================================

-- 1. Remove the old rubric-derived SDG measure --------------------------
drop view if exists public.v_sdg_goal_overall;
drop view if exists public.v_sdg_goal_event;
drop view if exists public.v_team_sdg_goal;
delete from public.mapping  where outcome_code = 'SDG';
delete from public.outcomes where code = 'SDG';

-- 2. Setting: strength that counts as "reached" --------------------------
alter table public.settings
  add column if not exists sdg_strength_target int not null default 2
  check (sdg_strength_target between 1 and 3);

-- 3. Ratings table -------------------------------------------------------
create table if not exists public.sdg_ratings (
  team_id      int  not null references public.teams(id) on delete cascade,
  sdg_id       int  not null references public.sdgs(id),
  evaluator_id uuid not null references public.profiles(id) on delete cascade,
  strength     int  not null check (strength between 0 and 3),
  updated_at   timestamptz not null default now(),
  primary key (team_id, sdg_id, evaluator_id)
);
create index if not exists sdg_ratings_evaluator_idx on public.sdg_ratings(evaluator_id);

-- A rating is only allowed for an SDG the team actually claims.
create or replace function public.check_sdg_rating() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.teams
                 where id = new.team_id
                   and new.sdg_id in (primary_sdg, secondary_sdg)) then
    raise exception 'SDG % is not one of the goals this team claims.', new.sdg_id;
  end if;
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists sdg_ratings_check on public.sdg_ratings;
create trigger sdg_ratings_check before insert or update on public.sdg_ratings
  for each row execute function public.check_sdg_rating();

-- Same access rules as rubric marks.
alter table public.sdg_ratings enable row level security;
drop policy if exists own_read   on public.sdg_ratings;
drop policy if exists own_insert on public.sdg_ratings;
drop policy if exists own_update on public.sdg_ratings;
drop policy if exists own_delete on public.sdg_ratings;
drop policy if exists admin_all  on public.sdg_ratings;
create policy own_read on public.sdg_ratings for select to authenticated
  using (evaluator_id = auth.uid() or public.is_admin());
create policy own_insert on public.sdg_ratings for insert to authenticated
  with check (evaluator_id = auth.uid()
              and public.is_assigned(public.team_event(team_id))
              and public.event_open(public.team_event(team_id)));
create policy own_update on public.sdg_ratings for update to authenticated
  using (evaluator_id = auth.uid()
         and public.is_assigned(public.team_event(team_id))
         and public.event_open(public.team_event(team_id)))
  with check (evaluator_id = auth.uid());
create policy own_delete on public.sdg_ratings for delete to authenticated
  using (evaluator_id = auth.uid()
         and public.is_assigned(public.team_event(team_id))
         and public.event_open(public.team_event(team_id)));
create policy admin_all on public.sdg_ratings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.sdg_ratings to authenticated;

-- 4. Calculation views ---------------------------------------------------

-- One row per team per claimed SDG: average strength across evaluators.
create or replace view public.v_team_sdg_strength with (security_invoker = true) as
select t.id as team_id, t.event_id, g.sdg_id, g.is_primary,
       avg(r.strength)   as avg_strength,
       count(r.strength) as n_raters
from public.teams t
cross join lateral (values (t.primary_sdg, true), (t.secondary_sdg, false)) as g(sdg_id, is_primary)
left join public.sdg_ratings r on r.team_id = t.id and r.sdg_id = g.sdg_id
where g.sdg_id is not null
  and not (g.is_primary = false and t.secondary_sdg = t.primary_sdg)
group by t.id, t.event_id, g.sdg_id, g.is_primary;

-- Goal-wise, per round (all 17 goals listed).
create or replace view public.v_sdg_goal_event with (security_invoker = true) as
select e.id as event_id, sd.id as sdg_id, sd.name, sd.color,
       count(g.team_id)      as solutions,
       count(g.avg_strength) as rated,
       avg(g.avg_strength)   as avg_strength,
       (count(*) filter (where g.avg_strength >= s.sdg_strength_target))::numeric
         / nullif(count(g.avg_strength), 0) as pct_at_target
from public.events e
cross join public.sdgs sd
cross join public.settings s
left join public.v_team_sdg_strength g on g.event_id = e.id and g.sdg_id = sd.id
group by e.id, sd.id, sd.name, sd.color, s.sdg_strength_target;

-- Goal-wise, all rounds pooled.
create or replace view public.v_sdg_goal_overall with (security_invoker = true) as
select sd.id as sdg_id, sd.name, sd.color,
       count(g.team_id)      as solutions,
       count(g.avg_strength) as rated,
       avg(g.avg_strength)   as avg_strength,
       (count(*) filter (where g.avg_strength >= s.sdg_strength_target))::numeric
         / nullif(count(g.avg_strength), 0) as pct_at_target
from public.sdgs sd
cross join public.settings s
left join public.v_team_sdg_strength g on g.sdg_id = sd.id
group by sd.id, sd.name, sd.color, s.sdg_strength_target;

-- Overall SDG attainment per round (every claimed SDG of every team).
create or replace view public.v_event_sdg with (security_invoker = true) as
select e.id as event_id,
       count(g.team_id)      as solutions,
       count(g.avg_strength) as rated,
       avg(g.avg_strength)   as avg_strength,
       (count(*) filter (where g.avg_strength >= s.sdg_strength_target))::numeric
         / nullif(count(g.avg_strength), 0) as pct_at_target
from public.events e
cross join public.settings s
left join public.v_team_sdg_strength g on g.event_id = e.id
group by e.id, s.sdg_strength_target;

-- Overall SDG attainment, all rounds pooled.
create or replace view public.v_overall_sdg with (security_invoker = true) as
select count(g.team_id)      as solutions,
       count(g.avg_strength) as rated,
       avg(g.avg_strength)   as avg_strength,
       (count(*) filter (where g.avg_strength >= s.sdg_strength_target))::numeric
         / nullif(count(g.avg_strength), 0) as pct_at_target
from public.settings s
left join public.v_team_sdg_strength g on true
group by s.sdg_strength_target;

grant select on public.v_team_sdg_strength, public.v_sdg_goal_event, public.v_sdg_goal_overall,
                public.v_event_sdg, public.v_overall_sdg to authenticated;

-- 5. Pulling finalists must also respect SDG ratings already given --------
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
  insert into public.teams (event_id, team_code, name, members, primary_sdg, secondary_sdg, problem, origin_team_id)
  select p_inter, t.team_code, t.name, t.members, t.primary_sdg, t.secondary_sdg, t.problem, t.id
  from public.v_team_result r
  join public.teams  t on t.id = r.team_id
  join public.events e on e.id = t.event_id
  where e.feeds_into = p_inter and r.status = 'Shortlisted'
  order by e.sort, r.rank;
  get diagnostics n = row_count;
  return n;
end $$;

-- Ask the API to pick up the new table and views straight away.
notify pgrst, 'reload schema';
