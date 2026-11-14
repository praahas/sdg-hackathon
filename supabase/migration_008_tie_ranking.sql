-- =====================================================================
-- Migration 008: ranking ties use the tie-break criterion reliably
--
-- Run once in Supabase ▸ SQL Editor. Safe to run more than once.
-- (A fresh install only needs schema.sql, which already includes this.)
--
-- Why: averaged marks such as 12.1667 are stored with ~20 decimal places, so two
-- totals that are equal (both shown as 61.5) could differ in the 20th decimal.
-- Ranking then followed that rounding noise and never reached the tie-break
-- criterion. Totals are now compared to 6 decimal places before the tie-break.
--
-- This only redefines a calculation view. No stored data is changed.
-- =====================================================================

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
                              order by (tot.n_criteria_scored > 0) desc, round(tot.total, 6) desc nulls last,
                                       round(tot.tiebreak, 6) desc nulls last, tot.team_id)
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

notify pgrst, 'reload schema';
