-- =====================================================================
-- SDG Hackathon Evaluation App — Supabase schema
-- Run this whole file once in Supabase: Dashboard ▸ SQL Editor ▸ New query ▸ Run.
-- It creates tables, security rules (RLS), calculation views and seed data
-- (POs, PSOs, 17 SDGs, the 9-criterion rubric, the mapping matrix and 6 events),
-- and the SDG contribution-strength ratings (section 7).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table public.settings (
  id              int primary key default 1 check (id = 1),
  title           text not null default 'SDG Hackathon 2026',
  institution     text not null default 'Canara Engineering College, Mangaluru',
  department      text not null default 'Artificial Intelligence and Machine Learning',
  academic_year   text not null default '2026-27',
  target          numeric not null default 0.60 check (target > 0 and target <= 1),
  level3          numeric not null default 0.70 check (level3 > 0 and level3 <= 1),
  level2          numeric not null default 0.60 check (level2 > 0 and level2 <= 1),
  level1          numeric not null default 0.50 check (level1 > 0 and level1 <= 1),
  shortlist_count int not null default 5 check (shortlist_count between 1 and 20),
  updated_at      timestamptz not null default now(),
  check (level3 >= level2 and level2 >= level1)
);

create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text not null default '',
  role       text not null default 'evaluator' check (role in ('admin', 'evaluator')),
  created_at timestamptz not null default now()
);

create table public.outcomes (
  code text primary key,
  name text not null,
  kind text not null check (kind in ('PO', 'PSO', 'SDG')),
  sort int not null
);

create table public.sdgs (
  id    int primary key check (id between 1 and 17),
  name  text not null,
  color text not null
);

create table public.criteria (
  id                serial primary key,
  sort              int not null,
  name              text not null,
  short_name        text not null,
  max_marks         numeric not null check (max_marks > 0),
  excellent         text not null default '',
  good              text not null default '',
  satisfactory      text not null default '',
  needs_improvement text not null default '',
  is_tiebreak       boolean not null default false
);

create table public.mapping (
  criterion_id int  not null references public.criteria(id) on delete cascade,
  outcome_code text not null references public.outcomes(code) on delete cascade,
  weight       int  not null check (weight between 0 and 3),
  primary key (criterion_id, outcome_code)
);

create table public.events (
  id         serial primary key,
  code       text not null unique,
  name       text not null,
  semester   int  not null,
  section    text,
  kind       text not null check (kind in ('intra', 'inter')),
  feeds_into int references public.events(id) on delete set null,
  locked     boolean not null default false,
  event_date date,
  venue      text,
  sort       int not null default 0
);

create table public.teams (
  id             serial primary key,
  event_id       int not null references public.events(id) on delete cascade,
  team_code      text,
  name           text not null,
  members        text,
  primary_sdg    int references public.sdgs(id),
  secondary_sdg  int references public.sdgs(id),
  problem        text,
  origin_team_id int references public.teams(id) on delete set null,
  created_at     timestamptz not null default now()
);
create index on public.teams(event_id);

create table public.event_evaluators (
  event_id     int  not null references public.events(id) on delete cascade,
  evaluator_id uuid not null references public.profiles(id) on delete cascade,
  primary key (event_id, evaluator_id)
);

create table public.scores (
  team_id      int  not null references public.teams(id) on delete cascade,
  criterion_id int  not null references public.criteria(id) on delete cascade,
  evaluator_id uuid not null references public.profiles(id) on delete cascade,
  score        numeric not null check (score >= 0),
  updated_at   timestamptz not null default now(),
  primary key (team_id, criterion_id, evaluator_id)
);
create index on public.scores(evaluator_id);

-- ---------------------------------------------------------------------
-- 2. Helper functions (security definer so RLS policies can use them)
-- ---------------------------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.is_assigned(p_event int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.event_evaluators
                 where event_id = p_event and evaluator_id = auth.uid());
$$;

create or replace function public.team_event(p_team int) returns int
language sql stable security definer set search_path = public as $$
  select event_id from public.teams where id = p_team;
$$;

create or replace function public.event_open(p_event int) returns boolean
language sql stable security definer set search_path = public as $$
  select not locked from public.events where id = p_event;
$$;

create or replace function public.attainment_level(p numeric) returns int
language sql stable set search_path = public as $$
  select case when p is null then null
              when p >= level3 then 3 when p >= level2 then 2 when p >= level1 then 1
              else 0 end
  from public.settings where id = 1;
$$;

-- New sign-ups get a profile. The very first account becomes the admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          case when exists (select 1 from public.profiles where role = 'admin')
               then 'evaluator' else 'admin' end);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Never leave the app without an admin.
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and (select count(*) from public.profiles where role = 'admin') <= 1 then
    raise exception 'At least one admin is required. Make someone else admin first.';
  end if;
  return coalesce(new, old);
end $$;
create trigger profiles_keep_admin before update or delete on public.profiles
  for each row execute function public.keep_one_admin();

-- Scores must not exceed the criterion maximum.
create or replace function public.check_score() returns trigger
language plpgsql security definer set search_path = public as $$
declare mx numeric;
begin
  select max_marks into mx from public.criteria where id = new.criterion_id;
  if new.score > mx then
    raise exception 'Score % is above the maximum of % for this criterion.', new.score, mx;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger scores_check before insert or update on public.scores
  for each row execute function public.check_score();

-- ---------------------------------------------------------------------
-- 3. Row-level security
-- ---------------------------------------------------------------------
alter table public.settings         enable row level security;
alter table public.profiles         enable row level security;
alter table public.outcomes         enable row level security;
alter table public.sdgs             enable row level security;
alter table public.criteria         enable row level security;
alter table public.mapping          enable row level security;
alter table public.events           enable row level security;
alter table public.teams            enable row level security;
alter table public.event_evaluators enable row level security;
alter table public.scores           enable row level security;

-- Reference data: every signed-in user reads, only admins write.
create policy read_all   on public.settings for select to authenticated using (true);
create policy admin_all  on public.settings for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all   on public.outcomes for select to authenticated using (true);
create policy admin_all  on public.outcomes for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all   on public.sdgs     for select to authenticated using (true);
create policy admin_all  on public.sdgs     for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all   on public.criteria for select to authenticated using (true);
create policy admin_all  on public.criteria for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_all   on public.mapping  for select to authenticated using (true);
create policy admin_all  on public.mapping  for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Profiles: see yourself; admins see and manage everyone.
create policy read_own   on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy admin_upd  on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy admin_del  on public.profiles for delete to authenticated using (public.is_admin());

-- Events and teams: evaluators see only events assigned to them.
create policy read_assigned on public.events for select to authenticated using (public.is_admin() or public.is_assigned(id));
create policy admin_all     on public.events for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_assigned on public.teams  for select to authenticated using (public.is_admin() or public.is_assigned(event_id));
create policy admin_all     on public.teams  for all    to authenticated using (public.is_admin()) with check (public.is_admin());
create policy read_own      on public.event_evaluators for select to authenticated using (public.is_admin() or evaluator_id = auth.uid());
create policy admin_all     on public.event_evaluators for all    to authenticated using (public.is_admin()) with check (public.is_admin());

-- Scores: evaluators read and write only their own marks, only for assigned,
-- unlocked events. Admins can read and correct everything.
create policy own_read on public.scores for select to authenticated
  using (evaluator_id = auth.uid() or public.is_admin());
create policy own_insert on public.scores for insert to authenticated
  with check (evaluator_id = auth.uid()
              and public.is_assigned(public.team_event(team_id))
              and public.event_open(public.team_event(team_id)));
create policy own_update on public.scores for update to authenticated
  using (evaluator_id = auth.uid()
         and public.is_assigned(public.team_event(team_id))
         and public.event_open(public.team_event(team_id)))
  with check (evaluator_id = auth.uid());
create policy own_delete on public.scores for delete to authenticated
  using (evaluator_id = auth.uid()
         and public.is_assigned(public.team_event(team_id))
         and public.event_open(public.team_event(team_id)));
create policy admin_all on public.scores for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------
-- 4. Calculation views (security_invoker: they respect the caller's RLS)
-- ---------------------------------------------------------------------

-- Average of evaluators' marks per team and criterion.
create view public.v_team_criterion with (security_invoker = true) as
select t.id as team_id, t.event_id, c.id as criterion_id, c.sort, c.max_marks,
       avg(s.score)               as avg_score,
       avg(s.score) / c.max_marks as pct,
       count(s.score)             as n_evaluators
from public.teams t
cross join public.criteria c
left join public.scores s on s.team_id = t.id and s.criterion_id = c.id
group by t.id, t.event_id, c.id, c.sort, c.max_marks;

-- Total, %, rank (tie-break: the criterion flagged is_tiebreak, then team id) and status.
create view public.v_team_result with (security_invoker = true) as
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
            when r.rank <= (select shortlist_count from public.settings where id = 1) then 'Shortlisted'
            else 'Not shortlisted' end as status
from ranked r join public.teams t on t.id = r.team_id;

-- Per-team outcome attainment = Σ(criterion % × weight) ÷ Σ weight.
-- Only computed once every mapped criterion has at least one score.
create view public.v_team_outcome with (security_invoker = true) as
select tc.team_id, tc.event_id, m.outcome_code,
       case when count(*) filter (where tc.pct is null) = 0
            then sum(tc.pct * m.weight) / sum(m.weight) end as attainment
from public.v_team_criterion tc
join public.mapping m on m.criterion_id = tc.criterion_id and m.weight > 0
group by tc.team_id, tc.event_id, m.outcome_code;

-- Per-event outcome summary.
create view public.v_event_outcome with (security_invoker = true) as
select x.*, public.attainment_level(x.pct_at_target) as level
from (
  select o.event_id, o.outcome_code,
         count(o.attainment) as n_teams,
         avg(o.attainment)   as avg_attainment,
         (count(*) filter (where o.attainment >= s.target))::numeric
           / nullif(count(o.attainment), 0) as pct_at_target
  from public.v_team_outcome o cross join public.settings s
  group by o.event_id, o.outcome_code, s.target
) x;

-- All events pooled.
create view public.v_overall_outcome with (security_invoker = true) as
select x.*, public.attainment_level(x.pct_at_target) as level
from (
  select o.outcome_code,
         count(o.attainment) as n_teams,
         avg(o.attainment)   as avg_attainment,
         (count(*) filter (where o.attainment >= s.target))::numeric
           / nullif(count(o.attainment), 0) as pct_at_target
  from public.v_team_outcome o cross join public.settings s
  group by o.outcome_code, s.target
) x;

-- ---------------------------------------------------------------------
-- 5. Admin action: copy the shortlisted teams of the feeding sections
--    into an inter-section round.
-- ---------------------------------------------------------------------
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
  if exists (select 1 from public.scores s join public.teams t on t.id = s.team_id
             where t.event_id = p_inter) then
    raise exception 'This round already has scores. Clear them before pulling the shortlist again.';
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

-- Explicit API grants (row-level security above still decides which rows each user can touch).
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on function public.promote_shortlist(int) to authenticated;
grant select on public.v_team_criterion, public.v_team_result, public.v_team_outcome,
                public.v_event_outcome, public.v_overall_outcome to authenticated;

-- ---------------------------------------------------------------------
-- 6. Seed data
-- ---------------------------------------------------------------------
insert into public.settings (id) values (1);

insert into public.outcomes (code, name, kind, sort) values
 ('PO1',  'Engineering Knowledge', 'PO', 1),
 ('PO2',  'Problem Analysis', 'PO', 2),
 ('PO3',  'Design/Development of Solutions', 'PO', 3),
 ('PO4',  'Conduct Investigations of Complex Problems', 'PO', 4),
 ('PO5',  'Engineering Tool Usage', 'PO', 5),
 ('PO6',  'The Engineer and The World', 'PO', 6),
 ('PO7',  'Ethics', 'PO', 7),
 ('PO8',  'Individual and Collaborative Team Work', 'PO', 8),
 ('PO9',  'Communication', 'PO', 9),
 ('PO10', 'Project Management and Finance', 'PO', 10),
 ('PO11', 'Life-Long Learning', 'PO', 11),
 ('PSO1', 'Intelligent Systems: Select appropriate technologies to analyse, design, implement, and deployment of smart and intelligent systems', 'PSO', 12),
 ('PSO2', 'Contemporary Systems: Design, and development of efficient IT solutions for challenging issues through experiential learning', 'PSO', 13);

insert into public.sdgs (id, name, color) values
 (1, 'No Poverty', '#E5243B'), (2, 'Zero Hunger', '#DDA63A'),
 (3, 'Good Health and Well-being', '#4C9F38'), (4, 'Quality Education', '#C5192D'),
 (5, 'Gender Equality', '#FF3A21'), (6, 'Clean Water and Sanitation', '#26BDE2'),
 (7, 'Affordable and Clean Energy', '#FCC30B'), (8, 'Decent Work and Economic Growth', '#A21942'),
 (9, 'Industry, Innovation and Infrastructure', '#FD6925'), (10, 'Reduced Inequalities', '#DD1367'),
 (11, 'Sustainable Cities and Communities', '#FD9D24'), (12, 'Responsible Consumption and Production', '#BF8B2E'),
 (13, 'Climate Action', '#3F7E44'), (14, 'Life Below Water', '#0A97D9'),
 (15, 'Life on Land', '#56C02B'), (16, 'Peace, Justice and Strong Institutions', '#00689D'),
 (17, 'Partnerships for the Goals', '#19486A');

insert into public.criteria (id, sort, name, short_name, max_marks, excellent, good, satisfactory, needs_improvement, is_tiebreak) values
 (1, 1, 'Problem Identification & SDG Relevance', 'Problem & SDG', 10,
  'Real, well-scoped problem explicitly linked to specific SDG targets (e.g., 6.1, 13.1); stakeholders and measurable impact indicators identified with evidence.',
  'Relevant problem mapped to an SDG goal; scope and stakeholders mostly clear; limited supporting evidence.',
  'Problem stated in general terms; SDG link is broad or superficial; scope vague.',
  'Problem unclear or trivial; no credible SDG connection.', false),
 (2, 2, 'Research & Analysis of Existing Solutions', 'Research', 10,
  'Thorough review of existing solutions, data and literature; gaps clearly articulated and used to justify the proposal.',
  'Reviews key existing solutions and identifies some gaps.',
  'Limited survey; gaps asserted without evidence.',
  'No analysis of existing work or data.', false),
 (3, 3, 'Solution Design & Innovation', 'Design', 15,
  'Original, well-architected solution (architecture/flow diagrams, modules, data flow); clearly innovative beyond existing approaches.',
  'Sound design with some novelty; architecture mostly complete.',
  'Conventional design with gaps; minimal innovation.',
  'No coherent design, or a copy of an existing solution.', false),
 (4, 4, 'Technical Implementation & Tool Usage', 'Implementation', 20,
  'Working prototype demonstrates core features end-to-end; modern tools/frameworks used effectively; clean, version-controlled code.',
  'Prototype works for most core features; appropriate tools used.',
  'Partial prototype or mock-up with limited functionality.',
  'No working implementation.', true),
 (5, 5, 'Intelligent & Smart System Features (AI/ML, IoT, Analytics)', 'Intelligent features', 10,
  'Meaningful use of AI/ML, data analytics, IoT or automation with justified technology/model choice and measured performance.',
  'Intelligent component present and working; limited evaluation.',
  'Intelligent feature only proposed or rudimentary (hard-coded rules).',
  'No intelligent or data-driven element.', false),
 (6, 6, 'Sustainability, Societal Impact & Ethics', 'Impact & ethics', 10,
  'Quantified social/environmental impact; addresses privacy, safety, inclusivity, bias and environmental footprint.',
  'Impact and ethical aspects discussed with some specifics.',
  'Impact claimed in general terms; ethics mentioned only briefly.',
  'Impact and ethical considerations ignored.', false),
 (7, 7, 'Feasibility, Scalability & Cost', 'Feasibility', 10,
  'Realistic deployment plan, cost estimate or business model, scalability path and risks identified.',
  'Feasible, with rough costing and some scalability considerations.',
  'Feasibility asserted; costing or scaling not addressed.',
  'Infeasible, or no deployment thinking.', false),
 (8, 8, 'Teamwork & Project Management', 'Teamwork', 5,
  'Clear roles and balanced contribution; planned timeline/task tracking evident; every member answers confidently.',
  'Roles defined; most members contribute.',
  'Uneven contribution; little evidence of planning.',
  'One or two members did most of the work; no planning.', false),
 (9, 9, 'Presentation, Demo & Q&A', 'Presentation', 10,
  'Clear, time-bound pitch; compelling live demo; accurate, confident answers to technical questions.',
  'Clear presentation and demo; answers most questions.',
  'Presentation unclear or over time; weak answers.',
  'Disorganised; unable to answer questions.', false);
select setval('public.criteria_id_seq', 9);

-- Rubric → PO/PSO correlation matrix (3 = high, 2 = medium, 1 = low).
-- SDG attainment does not come from this matrix; see section 7.
insert into public.mapping (criterion_id, outcome_code, weight)
select c, o, w from (values
 (1,'PO1',1),(1,'PO2',3),(1,'PO4',1),(1,'PO6',3),(1,'PO11',1),(1,'PSO2',1),
 (2,'PO1',2),(2,'PO2',3),(2,'PO4',3),(2,'PO5',1),(2,'PO6',1),(2,'PO11',2),
 (3,'PO1',2),(3,'PO2',2),(3,'PO3',3),(3,'PO4',1),(3,'PO6',1),(3,'PSO1',2),(3,'PSO2',3),
 (4,'PO1',2),(4,'PO3',2),(4,'PO5',3),(4,'PO8',1),(4,'PO11',1),(4,'PSO1',3),(4,'PSO2',2),
 (5,'PO1',2),(5,'PO2',1),(5,'PO3',1),(5,'PO4',2),(5,'PO5',2),(5,'PO11',1),(5,'PSO1',3),(5,'PSO2',1),
 (6,'PO3',1),(6,'PO6',3),(6,'PO7',3),(6,'PSO2',1),
 (7,'PO3',1),(7,'PO6',2),(7,'PO10',3),(7,'PSO2',2),
 (8,'PO7',1),(8,'PO8',3),(8,'PO9',1),(8,'PO10',2),
 (9,'PO8',2),(9,'PO9',3),(9,'PO11',1),(9,'PSO2',1)
) as v(c, o, w);

insert into public.events (id, code, name, semester, section, kind, feeds_into, sort) values
 (3, '3-INTER', '3rd Semester inter-section round', 3, null, 'inter', null, 3),
 (6, '5-INTER', '5th Semester inter-section round', 5, null, 'inter', null, 6),
 (1, '3A', '3rd Semester Section A', 3, 'A', 'intra', 3, 1),
 (2, '3B', '3rd Semester Section B', 3, 'B', 'intra', 3, 2),
 (4, '5A', '5th Semester Section A', 5, 'A', 'intra', 6, 4),
 (5, '5B', '5th Semester Section B', 5, 'B', 'intra', 6, 5);
select setval('public.events_id_seq', 6);

-- ---------------------------------------------------------------------
-- 7. SDG attainment from evaluators' contribution-strength ratings
--    Evaluators rate each SDG a team claims: 3 High, 2 Medium, 1 Low, 0 None.
-- ---------------------------------------------------------------------
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

-- ---------------------------------------------------------------------
-- 8. Team self-registration and team leaderboards
-- ---------------------------------------------------------------------
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
