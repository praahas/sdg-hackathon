-- =====================================================================
-- Migration 007: ranked department final and problem statements
--
-- Run once in Supabase ▸ SQL Editor if you already have the app running.
-- (A fresh install only needs schema.sql, which already includes this.)
--
-- What changes
--  • The department-level final no longer shortlists a top 5: every team is
--    ranked by total score (1st place, 2nd place, …).
--  • The admin can set N problem statements for a round, each mapped to the
--    SDG(s) it is expected to address (primary, optional secondary, targets).
--  • Teams choose a problem statement from the team portal while the admin has
--    selection open. A team's SDGs for that round then come from its problem
--    statement, so SDG ratings and attainment follow the chosen statement.
--  • The admin can also assign or change a team's problem statement.
-- =====================================================================

-- 1. Rounds that rank instead of shortlisting --------------------------------
alter table public.events
  add column if not exists shortlists boolean not null default true,
  add column if not exists ps_selection_open boolean not null default false;
update public.events set shortlists = false where code = 'DEPT';

-- 2. Problem statements -------------------------------------------------------
create table if not exists public.problem_statements (
  id            serial primary key,
  event_id      int  not null references public.events(id) on delete cascade,
  code          text not null,
  title         text not null,
  description   text not null default '',
  primary_sdg   int  not null references public.sdgs(id),
  secondary_sdg int  references public.sdgs(id),
  sdg_targets   text,
  created_at    timestamptz not null default now(),
  check (secondary_sdg is null or secondary_sdg <> primary_sdg),
  unique (event_id, code)
);

-- Codes PS01, PS02 … per round, assigned automatically.
create or replace function public.assign_ps_code() returns trigger
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if tg_op = 'UPDATE' then new.code := old.code; new.event_id := old.event_id; return new; end if;
  perform pg_advisory_xact_lock(hashtext('ps_code'), new.event_id);
  select coalesce(max((regexp_match(code, '^PS(\d+)$'))[1]::int), 0) + 1 into n
  from public.problem_statements where event_id = new.event_id;
  new.code := 'PS' || lpad(n::text, 2, '0');
  return new;
end $$;
drop trigger if exists ps_assign_code on public.problem_statements;
create trigger ps_assign_code before insert or update on public.problem_statements
  for each row execute function public.assign_ps_code();

alter table public.problem_statements enable row level security;
drop policy if exists read_all on public.problem_statements;
drop policy if exists admin_all on public.problem_statements;
create policy read_all on public.problem_statements for select to authenticated using (true);
create policy admin_all on public.problem_statements for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.problem_statements to authenticated;
grant usage, select on sequence public.problem_statements_id_seq to authenticated;

-- 3. A team's chosen problem statement drives its problem text and SDGs ------
alter table public.teams
  add column if not exists problem_statement_id int references public.problem_statements(id) on delete set null;

create or replace function public.apply_problem_statement() returns trigger
language plpgsql security definer set search_path = public as $$
declare ps public.problem_statements;
begin
  if new.problem_statement_id is not null
     and (tg_op = 'INSERT' or new.problem_statement_id is distinct from old.problem_statement_id) then
    select * into ps from public.problem_statements where id = new.problem_statement_id;
    if ps.event_id <> new.event_id then
      raise exception 'That problem statement belongs to a different round.';
    end if;
    new.problem := ps.code || ' — ' || ps.title;
    new.primary_sdg := ps.primary_sdg;
    new.secondary_sdg := ps.secondary_sdg;
    new.sdg_targets := ps.sdg_targets;
  end if;
  return new;
end $$;
drop trigger if exists teams_apply_ps on public.teams;
create trigger teams_apply_ps before insert or update on public.teams
  for each row execute function public.apply_problem_statement();

-- Editing a problem statement updates every team that chose it.
create or replace function public.sync_problem_statement() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.teams
  set problem = new.code || ' — ' || new.title,
      primary_sdg = new.primary_sdg, secondary_sdg = new.secondary_sdg, sdg_targets = new.sdg_targets
  where problem_statement_id = new.id;
  return new;
end $$;
drop trigger if exists ps_sync_teams on public.problem_statements;
create trigger ps_sync_teams after update on public.problem_statements
  for each row execute function public.sync_problem_statement();

-- Team portal: choose (or change) a problem statement.
create or replace function public.select_problem_statement(p_team int, p_ps int) returns void
language plpgsql security definer set search_path = public as $$
declare t public.teams; e public.events; ps public.problem_statements;
begin
  select * into t from public.teams where id = p_team;
  if not found or t.owner_id is distinct from auth.uid() then
    raise exception 'You can only choose a problem statement for your own team.';
  end if;
  select * into e from public.events where id = t.event_id;
  if not e.ps_selection_open then
    raise exception 'Problem statement selection for % is closed. Contact the coordinator.', e.name;
  end if;
  select * into ps from public.problem_statements where id = p_ps;
  if not found or ps.event_id <> t.event_id then
    raise exception 'That problem statement is not part of %.', e.name;
  end if;
  if exists (select 1 from public.scores where team_id = p_team)
     or exists (select 1 from public.sdg_ratings where team_id = p_team) then
    raise exception 'Evaluation of your team has started, so the problem statement can no longer be changed.';
  end if;
  update public.teams set problem_statement_id = p_ps where id = p_team;
end $$;
grant execute on function public.select_problem_statement(int, int) to authenticated;

-- 4. Ranking label for rounds that don't shortlist ---------------------------
create or replace function public.place_label(p_rank bigint) returns text
language sql immutable as $$
  select p_rank || case when p_rank % 100 between 11 and 13 then 'th'
                        when p_rank % 10 = 1 then 'st' when p_rank % 10 = 2 then 'nd'
                        when p_rank % 10 = 3 then 'rd' else 'th' end || ' place';
$$;

create or replace view public.v_team_result with (security_invoker = true) as
with tot as (
  select tc.team_id, tc.event_id,
         sum(tc.avg_score)   as total,
         count(tc.avg_score) as n_criteria_scored,
         max(case when c.is_tiebreak then tc.avg_score end) as tiebreak
  from public.v_team_criterion tc
  join public.criteria c on c.id = tc.criterion_id
  group by tc.team_id, tc.event_id
), mx as (select sum(max_marks) as max_total from public.criteria),
ranked as (
  select tot.*, mx.max_total, tot.total / mx.max_total as pct,
         case when tot.n_criteria_scored > 0 then
           row_number() over (partition by tot.event_id
                              order by (tot.n_criteria_scored > 0) desc, tot.total desc nulls last,
                                       tot.tiebreak desc nulls last, tot.team_id)
         end as rank
  from tot cross join mx
)
select r.team_id, r.event_id, t.team_code, t.name as team_name, t.primary_sdg, t.secondary_sdg,
       r.total, r.max_total, r.pct, r.n_criteria_scored, r.rank,
       case when r.rank is null then null
            when not e.shortlists then public.place_label(r.rank)
            when r.rank <= (select shortlist_count from public.settings where id = 1) then 'Shortlisted'
            else 'Not shortlisted' end as status
from ranked r
join public.teams t on t.id = r.team_id
join public.events e on e.id = r.event_id;

-- 5. Finalist copies start without a problem statement (they choose one) ----
-- promote_shortlist already copies only teams marked 'Shortlisted' from
-- shortlisting rounds; nothing else changes there.

notify pgrst, 'reload schema';
