-- =====================================================================
-- Migration 015: teams marked absent
--
-- Run once in Supabase ▸ SQL Editor, after migration 014. Safe to run more
-- than once. (A fresh install only needs schema.sql, which includes this.)
--
-- What changes
--  • The admin can mark a team absent in a round (round page ▸ Absent).
--  • An absent team counts as not evaluated in that round: any marks or SDG
--    ratings it was given are ignored, it gets no rank, its status reads
--    "Absent", it is left out of PO/PSO and SDG attainment, it can't be
--    shortlisted, and it gets no certificate.
--  • Marks already entered are kept, so unticking Absent restores them.
--  • Certificates already issued to the team are withdrawn when the round is
--    re-issued; the Certificates page points this out.
-- =====================================================================

alter table public.teams add column if not exists absent boolean not null default false;

-- Marks: an absent team's marks don't count.
create or replace view public.v_team_criterion with (security_invoker = true) as
select t.id as team_id, t.event_id, c.id as criterion_id, c.sort, c.max_marks,
       avg(s.score)               as avg_score,
       avg(s.score) / c.max_marks as pct,
       count(s.score)             as n_evaluators
from public.teams t
cross join public.criteria c
left join public.scores s on s.team_id = t.id and s.criterion_id = c.id and not t.absent
group by t.id, t.event_id, c.id, c.sort, c.max_marks;

-- SDG ratings: likewise.
create or replace view public.v_team_sdg_strength with (security_invoker = true) as
select t.id as team_id, t.event_id, g.sdg_id, g.is_primary,
       avg(r.strength)   as avg_strength,
       count(r.strength) as n_raters
from public.teams t
cross join lateral (values (t.primary_sdg, true), (t.secondary_sdg, false)) as g(sdg_id, is_primary)
left join public.sdg_ratings r on r.team_id = t.id and r.sdg_id = g.sdg_id and not t.absent
where g.sdg_id is not null
  and not (g.is_primary = false and t.secondary_sdg = t.primary_sdg)
group by t.id, t.event_id, g.sdg_id, g.is_primary;

-- Results: unranked, with the status "Absent".
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
       case when t.absent then 'Absent'
            when r.rank is null then null
            when not e.shortlists then public.place_label(r.rank)
            when r.rank <= (select shortlist_count from public.settings where id = 1) then 'Shortlisted'
            else 'Not shortlisted' end as status
from ranked r
join public.teams t on t.id = r.team_id
join public.events e on e.id = r.event_id;

-- Feedback: absent teams aren't asked for event feedback.
create or replace function public.my_feedback()
returns table (event_id int, team_id int, member_index int, member_name text, usn text,
               submitted_at timestamptz, answers jsonb)
language sql stable security definer set search_path = public as $$
  select t.event_id, t.id, m.idx, m.name, m.usn, f.submitted_at, f.answers
  from public.teams t
  join public.events e on e.id = t.event_id
  cross join lateral public.team_members(t.id) m
  left join public.feedback_responses f on f.team_id = t.id and f.member_index = m.idx
  where t.owner_id = auth.uid() and m.name is not null and not t.absent
    and (e.feedback_open or e.feedback_required)
  order by e.sort, t.id, m.idx;
$$;

-- Certificates page: say why a certificate is going to be withdrawn.
create or replace function public.certificate_gaps()
returns table (event_id int, team_code text, team_name text, member_name text, issue text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can check certificates.'; end if;
  return query
  with issued as (select distinct c.event_id from public.certificates c),
  cur as (
    select r.event_id, t.id as team_id, t.team_code, t.name as team_name, m.idx, m.name, m.usn
    from public.v_team_result r
    join issued i on i.event_id = r.event_id
    join public.teams t on t.id = r.team_id
    cross join lateral public.team_members(t.id) m
    where r.n_criteria_scored > 0
  ), part as (select * from public.certificates where kind = 'participation')
  select cur.event_id, cur.team_code, cur.team_name, cur.name, 'missing'::text
  from cur where not exists (select 1 from part p where p.team_id = cur.team_id and p.member_index = cur.idx)
  union all
  select cur.event_id, cur.team_code, cur.team_name, cur.name, 'changed'
  from cur join part p on p.team_id = cur.team_id and p.member_index = cur.idx
  where p.member_name is distinct from cur.name or p.usn is distinct from cur.usn
  union all
  select p.event_id, p.team_code, p.team_name, p.member_name,
         case when t.absent then 'absent'
              when not exists (select 1 from cur c2 where c2.team_id = p.team_id) then 'not_evaluated'
              else 'removed' end
  from part p join issued i on i.event_id = p.event_id
  join public.teams t on t.id = p.team_id
  where not exists (select 1 from cur where cur.team_id = p.team_id and cur.idx = p.member_index);
end $$;
grant execute on function public.certificate_gaps() to authenticated;

notify pgrst, 'reload schema';
