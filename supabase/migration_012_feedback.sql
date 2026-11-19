-- =====================================================================
-- Migration 012: student feedback on the event
--
-- Run once in Supabase ▸ SQL Editor, after migration 011. Safe to run more
-- than once. (A fresh install only needs schema.sql, which includes this.)
--
-- What it adds
--  • Feedback questions the admin can edit: 1–5 ratings, single-choice
--    questions and free-text comments. A ready-made set is added once.
--  • Per round: whether feedback is being collected, and whether a member
--    must give feedback before their certificate for that round can be
--    downloaded from the team portal (off by default).
--  • One response per team member per round, filled in through the team
--    portal. A member can change their response while feedback is open.
-- =====================================================================

-- 1. Questions -------------------------------------------------------------------
create table if not exists public.feedback_questions (
  id         serial primary key,
  kind       text not null check (kind in ('rating', 'choice', 'text')),
  prompt     text not null check (length(trim(prompt)) > 0),
  options    text[] not null default '{}',     -- for 'choice'
  required   boolean not null default true,
  sort       int not null default 0,
  active     boolean not null default true,    -- removed questions are kept so old answers still read
  created_at timestamptz not null default now()
);
alter table public.feedback_questions enable row level security;
drop policy if exists read_all on public.feedback_questions;
drop policy if exists admin_all on public.feedback_questions;
create policy read_all on public.feedback_questions for select to authenticated using (true);
create policy admin_all on public.feedback_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.feedback_questions to authenticated;
grant usage, select on sequence public.feedback_questions_id_seq to authenticated;

insert into public.feedback_questions (kind, prompt, options, required, sort)
select * from (values
  ('rating', 'Organisation of the event (schedule, venue, communication)', '{}'::text[], true, 1),
  ('rating', 'Clarity and relevance of the problem statements to the SDGs', '{}', true, 2),
  ('rating', 'Guidance and support from faculty mentors', '{}', true, 3),
  ('rating', 'Fairness of the evaluation and clarity of the criteria', '{}', true, 4),
  ('rating', 'What you learned technically (tools, design, building a working solution)', '{}', true, 5),
  ('rating', 'Growth in teamwork, communication and presentation skills', '{}', true, 6),
  ('rating', 'Your understanding of the SDGs and how engineering can address them', '{}', true, 7),
  ('rating', 'Overall, how would you rate the event?', '{}', true, 8),
  ('choice', 'Would you take part in a similar event again?', '{Yes,Maybe,No}', true, 9),
  ('text',   'What did you like most?', '{}', false, 10),
  ('text',   'What should we improve next time?', '{}', false, 11)
) v(kind, prompt, options, required, sort)
where not exists (select 1 from public.feedback_questions);

-- 2. Per-round switches ------------------------------------------------------------
alter table public.events
  add column if not exists feedback_open boolean not null default false,
  add column if not exists feedback_required boolean not null default false;

-- 3. Responses ---------------------------------------------------------------------
create table if not exists public.feedback_responses (
  id           serial primary key,
  event_id     int  not null references public.events(id) on delete cascade,
  team_id      int  not null references public.teams(id) on delete cascade,
  member_index int  not null,
  member_name  text not null,
  usn          text,
  answers      jsonb not null default '{}',     -- {"<question id>": 1-5 | "option" | "text"}
  submitted_at timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (team_id, member_index)
);
create index if not exists feedback_responses_event_idx on public.feedback_responses(event_id);
alter table public.feedback_responses enable row level security;
drop policy if exists admin_all on public.feedback_responses;
drop policy if exists own_team_read on public.feedback_responses;
create policy admin_all on public.feedback_responses for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy own_team_read on public.feedback_responses for select to authenticated
  using (exists (select 1 from public.teams t where t.id = team_id and t.owner_id = auth.uid()));
grant select, delete on public.feedback_responses to authenticated;

-- 4. Team portal: members and their feedback status, per round ---------------------
-- Rounds where feedback is open, or where it is required for certificates.
create or replace function public.my_feedback()
returns table (event_id int, team_id int, member_index int, member_name text, usn text,
               submitted_at timestamptz, answers jsonb)
language sql stable security definer set search_path = public as $$
  select t.event_id, t.id, m.idx, m.name, m.usn, f.submitted_at, f.answers
  from public.teams t
  join public.events e on e.id = t.event_id
  cross join lateral public.team_members(t.id) m
  left join public.feedback_responses f on f.team_id = t.id and f.member_index = m.idx
  where t.owner_id = auth.uid() and m.name is not null
    and (e.feedback_open or e.feedback_required)
  order by e.sort, t.id, m.idx;
$$;
grant execute on function public.my_feedback() to authenticated;

-- Submit (or update) one member's feedback.
create or replace function public.submit_feedback(p_team int, p_member int, p_answers jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare t public.teams; e public.events; m record; qn record; v jsonb; clean jsonb := '{}';
begin
  select * into t from public.teams where id = p_team;
  if not found or t.owner_id is distinct from auth.uid() then
    raise exception 'You can only give feedback for members of your own team.';
  end if;
  select * into e from public.events where id = t.event_id;
  if not e.feedback_open then
    raise exception 'Feedback for % is closed.', e.name;
  end if;
  select * into m from public.team_members(p_team) x where x.idx = p_member and x.name is not null;
  if not found then raise exception 'That member is not on your team.'; end if;

  for qn in select * from public.feedback_questions where active order by sort, id loop
    v := p_answers -> qn.id::text;
    if v is null or v = 'null'::jsonb or (jsonb_typeof(v) = 'string' and trim(v #>> '{}') = '') then
      if qn.required then raise exception 'Please answer: %', qn.prompt; end if;
      continue;
    end if;
    if qn.kind = 'rating' then
      if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric not in (1, 2, 3, 4, 5) then
        raise exception 'Rate "%" from 1 to 5.', qn.prompt;
      end if;
    elsif qn.kind = 'choice' then
      if jsonb_typeof(v) <> 'string' or not ((v #>> '{}') = any (qn.options)) then
        raise exception 'Choose one of the options for "%".', qn.prompt;
      end if;
    else
      if jsonb_typeof(v) <> 'string' then raise exception 'Answer "%" in words.', qn.prompt; end if;
      v := to_jsonb(left(trim(v #>> '{}'), 2000));
    end if;
    clean := clean || jsonb_build_object(qn.id::text, v);
  end loop;

  insert into public.feedback_responses (event_id, team_id, member_index, member_name, usn, answers)
  values (t.event_id, p_team, p_member, m.name, m.usn, clean)
  on conflict (team_id, member_index) do update
    set answers = excluded.answers, member_name = excluded.member_name, usn = excluded.usn, updated_at = now();
end $$;
grant execute on function public.submit_feedback(int, int, jsonb) to authenticated;

-- 5. Admin: members and responses per round ------------------------------------------
create or replace function public.feedback_overview()
returns table (event_id int, members int, responses int)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only admins can see feedback.'; end if;
  return query
    select e.id,
           (select count(*)::int from public.teams t cross join lateral public.team_members(t.id) m
             where t.event_id = e.id and m.name is not null),
           (select count(*)::int from public.feedback_responses f where f.event_id = e.id)
    from public.events e order by e.sort;
end $$;
grant execute on function public.feedback_overview() to authenticated;

-- 6. Certificates: when a round requires feedback, the team portal shows a member's
--    certificates only after that member has given feedback. Admin downloads are unaffected.
drop policy if exists own_team_read on public.certificates;
create policy own_team_read on public.certificates for select to authenticated
  using (exists (select 1 from public.teams t join public.events e on e.id = t.event_id
                 where t.id = team_id and t.owner_id = auth.uid() and e.certificates_released
                   and (not e.feedback_required
                        or exists (select 1 from public.feedback_responses f
                                   where f.team_id = certificates.team_id and f.member_index = certificates.member_index))));

notify pgrst, 'reload schema';
