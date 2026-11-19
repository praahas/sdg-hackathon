-- =====================================================================
-- Migration 016: insights and recommendations for the next hackathon
--
-- Run once in Supabase ▸ SQL Editor, after migration 015. Safe to run more
-- than once. (A fresh install only needs schema.sql, which includes this.)
--
-- What it adds
--  • insight_data(round): every figure the Insights page needs, computed in
--    the database — feedback, SDG coverage and strength, problem-statement
--    take-up, PO/PSO attainment, rubric criteria, evaluator agreement and
--    attendance — for one round or for the whole event. Nothing is sent
--    anywhere outside your Supabase project.
--  • Saved reports (findings plus the optional write-up), admin only.
-- =====================================================================

create or replace function public.insight_data(p_event int default null) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare out jsonb;
begin
  if not public.is_admin() then raise exception 'Only admins can see insights.'; end if;

  with
  -- Teams in scope. For the whole event each team counts once: its section-round entry.
  tms as (
    select t.* from public.teams t
    where (p_event is null and t.origin_team_id is null) or t.event_id = p_event
  ),
  -- Rounds whose marks are in scope (all rounds for the whole event).
  evs as (select id from public.events where p_event is null or id = p_event),
  res as (
    select r.* from public.v_team_result r join evs on evs.id = r.event_id
  ),
  att as (
    select count(*) filter (where not absent) as present, count(*) filter (where absent) as absent, count(*) as registered
    from tms
  ),
  evaluated as (select count(*) filter (where n_criteria_scored > 0) as n from res),
  -- Feedback
  fr as (select f.* from public.feedback_responses f join evs on evs.id = f.event_id),
  fmembers as (
    select count(*) as n from public.teams t join evs on evs.id = t.event_id
    cross join lateral public.team_members(t.id) m
    where not t.absent
      and exists (select 1 from public.events e where e.id = t.event_id and (e.feedback_open or e.feedback_required
                  or exists (select 1 from public.feedback_responses x where x.event_id = e.id)))
  ),
  fq as (
    select qn.id, qn.kind, qn.prompt, qn.options, qn.active, qn.sort,
           count(fr.answers -> qn.id::text) as n,
           avg((fr.answers ->> qn.id::text)::numeric) filter (where qn.kind = 'rating') as avg,
           jsonb_build_array(
             count(*) filter (where qn.kind = 'rating' and fr.answers ->> qn.id::text = '1'),
             count(*) filter (where qn.kind = 'rating' and fr.answers ->> qn.id::text = '2'),
             count(*) filter (where qn.kind = 'rating' and fr.answers ->> qn.id::text = '3'),
             count(*) filter (where qn.kind = 'rating' and fr.answers ->> qn.id::text = '4'),
             count(*) filter (where qn.kind = 'rating' and fr.answers ->> qn.id::text = '5')) as dist
    from public.feedback_questions qn
    left join fr on fr.answers ? qn.id::text
    group by qn.id
  ),
  fchoice as (
    select qn.id, jsonb_object_agg(o, (select count(*) from fr where fr.answers ->> qn.id::text = o)) as counts
    from public.feedback_questions qn cross join lateral unnest(qn.options) o
    where qn.kind = 'choice' group by qn.id
  ),
  fcomments as (
    select qn.id as qid, fr.answers ->> qn.id::text as text
    from public.feedback_questions qn join fr on coalesce(trim(fr.answers ->> qn.id::text), '') <> ''
    where qn.kind = 'text'
  ),
  -- SDGs chosen by the teams in scope (absent teams excluded)
  claims as (
    select t.primary_sdg as sdg, true as is_primary, t.id from tms t where not t.absent and t.primary_sdg is not null
    union all
    select t.secondary_sdg, false, t.id from tms t where not t.absent and t.secondary_sdg is not null and t.secondary_sdg <> t.primary_sdg
  ),
  strength as (
    select g.sdg_id, avg(g.avg_strength) as avg_strength, count(g.avg_strength) as rated
    from public.v_team_sdg_strength g join evs on evs.id = g.event_id
    join public.teams t on t.id = g.team_id and not t.absent
    group by g.sdg_id
  ),
  goals as (
    select sd.id, sd.name,
           count(c.id) filter (where c.is_primary) as primary_teams,
           count(c.id) filter (where not c.is_primary) as secondary_teams,
           st.avg_strength, coalesce(st.rated, 0) as rated
    from public.sdgs sd
    left join claims c on c.sdg = sd.id
    left join strength st on st.sdg_id = sd.id
    group by sd.id, sd.name, st.avg_strength, st.rated
  ),
  pss as (
    select ps.code, ps.title, ps.primary_sdg, ps.secondary_sdg, e.name as round,
           (select count(*) from public.teams t where t.problem_statement_id = ps.id and not t.absent) as teams
    from public.problem_statements ps join evs on evs.id = ps.event_id join public.events e on e.id = ps.event_id
  ),
  -- Outcomes
  outc as (
    select o.code, o.name, o.kind, o.sort, x.n_teams, x.avg_attainment, x.pct_at_target, x.level
    from public.outcomes o
    left join (
      select outcome_code, n_teams, avg_attainment, pct_at_target, level from public.v_event_outcome where event_id = p_event
      union all
      select outcome_code, n_teams, avg_attainment, pct_at_target, level from public.v_overall_outcome where p_event is null
    ) x on x.outcome_code = o.code
    where o.kind in ('PO', 'PSO')
  ),
  -- Rubric criteria: average % and how far evaluators disagree on the same team
  crit as (
    select c.id, c.name, c.short_name, c.max_marks, c.sort,
           avg(tc.pct) as avg_pct, count(tc.pct) as n_teams
    from public.criteria c
    left join public.v_team_criterion tc on tc.criterion_id = c.id and tc.event_id in (select id from evs)
    group by c.id
  ),
  spread as (
    select s.criterion_id, avg(sd) as avg_sd_pct, count(*) as n
    from (
      select s.team_id, s.criterion_id, stddev_samp(s.score) / max(c.max_marks) as sd
      from public.scores s
      join public.teams t on t.id = s.team_id and not t.absent
      join evs on evs.id = t.event_id
      join public.criteria c on c.id = s.criterion_id
      group by s.team_id, s.criterion_id having count(*) >= 2
    ) s group by s.criterion_id
  )
  select jsonb_build_object(
    'scope', coalesce((select name from public.events where id = p_event), 'All rounds'),
    'event_id', p_event,
    'generated_at', now(),
    'settings', (select jsonb_build_object('title', title, 'institution', institution, 'department', department,
                   'academic_year', academic_year, 'target', target, 'sdg_strength_target', sdg_strength_target)
                 from public.settings where id = 1),
    'attendance', (select jsonb_build_object('registered', registered, 'present', present, 'absent', absent) from att),
    'evaluated', (select n from evaluated),
    'rounds', (select jsonb_agg(jsonb_build_object('id', e.id, 'name', e.name) order by e.sort) from public.events e join evs on evs.id = e.id),
    'feedback', jsonb_build_object(
      'responses', (select count(*) from fr),
      'members', (select n from fmembers),
      'questions', coalesce((select jsonb_agg(jsonb_build_object('id', fq.id, 'kind', fq.kind, 'prompt', fq.prompt, 'active', fq.active,
                     'n', fq.n, 'avg', round(fq.avg, 2), 'dist', fq.dist, 'options', fch.counts) order by fq.sort, fq.id)
                   from fq left join fchoice fch on fch.id = fq.id where fq.active or fq.n > 0), '[]'),
      'comments', coalesce((select jsonb_agg(jsonb_build_object('qid', qid, 'text', left(text, 600))) from fcomments), '[]')),
    'sdgs', (select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'primary', primary_teams, 'secondary', secondary_teams,
               'avg_strength', round(avg_strength, 2), 'rated', rated) order by id) from goals),
    'problem_statements', coalesce((select jsonb_agg(jsonb_build_object('code', code, 'title', title, 'round', round,
               'primary_sdg', primary_sdg, 'secondary_sdg', secondary_sdg, 'teams', teams) order by round, code) from pss), '[]'),
    'outcomes', (select jsonb_agg(jsonb_build_object('code', code, 'name', name, 'kind', kind, 'n_teams', coalesce(n_teams, 0),
               'avg', round(avg_attainment, 3), 'pct_at_target', round(pct_at_target, 3), 'level', level) order by sort) from outc),
    'criteria', (select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'short_name', c.short_name, 'max', c.max_marks,
               'avg_pct', round(c.avg_pct, 3), 'n_teams', c.n_teams, 'spread_pct', round(sp.avg_sd_pct, 3), 'spread_n', coalesce(sp.n, 0))
               order by c.sort) from crit c left join spread sp on sp.criterion_id = c.id)
  ) into out;
  return out;
end $$;
grant execute on function public.insight_data(int) to authenticated;

-- Saved reports ---------------------------------------------------------------
create table if not exists public.insight_reports (
  id          serial primary key,
  event_id    int references public.events(id) on delete cascade,   -- null = whole event
  scope       text not null,
  findings    jsonb not null,          -- figures and rule-based recommendations at the time
  narrative   text,                    -- the optional write-up, as edited by the admin
  model       text,                    -- the model that drafted the write-up, if any
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now()
);
alter table public.insight_reports enable row level security;
drop policy if exists admin_all on public.insight_reports;
create policy admin_all on public.insight_reports for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.insight_reports to authenticated;
grant usage, select on sequence public.insight_reports_id_seq to authenticated;

notify pgrst, 'reload schema';
