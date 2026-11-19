-- =====================================================================
-- Migration 014: team members stay in sync; certificates flag missing members
--
-- Run once in Supabase ▸ SQL Editor, after migration 013. Safe to run more
-- than once. (A fresh install only needs schema.sql, which includes this.)
--
-- Why
--  A member added to a team later could be left without a certificate:
--  • For a team that registered itself, editing "Members" on the round page
--    changed the text the admin sees but not the member list certificates use.
--  • Each round keeps its own copy of a finalist team, and a change in one
--    round did not reach the copies in the other rounds.
--  • Certificates already issued are a snapshot and nothing showed that a
--    member had been added since.
--
-- What changes
--  • Editing members anywhere (round page or team portal) updates both forms
--    of the member list, and the same team's copies in every other round.
--  • Existing teams are repaired once (details below).
--  • The Certificates page lists members who are missing from, or differ
--    from, the certificates already issued, so you know to click Re-issue.
-- =====================================================================

-- 1. Free text such as "Asha (4CB23AI001), Bala 4CB23AI002" → [{name, usn}, …]
create or replace function public.parse_members(p text) returns jsonb
language sql immutable as $$
  with parts as (
    select ord, trim(x) as p
    from regexp_split_to_table(coalesce(p, ''), '\s*[,;\n]\s*') with ordinality as s(x, ord)
  ), parsed as (
    select ord, p, upper(substring(p from '([0-9][A-Za-z]{2}[0-9]{2}[A-Za-z]{2,3}[0-9]{3})')) as u
    from parts where p <> ''
  )
  select case when count(*) = 0 then null else
    jsonb_agg(jsonb_build_object(
      'name', coalesce(nullif(trim(both ' -:' from regexp_replace(regexp_replace(
                case when u is null then p else regexp_replace(p, u, '', 'i') end,
                '[()\[\]]', '', 'g'), '\s+', ' ', 'g')), ''), ''),
      'usn', coalesce(u, '')) order by ord) end
  from parsed;
$$;

-- Named members in a member list (for comparing versions).
create or replace function public.member_count(p jsonb) returns int
language sql immutable as $$
  select count(*)::int from jsonb_array_elements(coalesce(p, '[]'::jsonb)) m
  where coalesce(trim(m ->> 'name'), '') <> '';
$$;

-- 2. Keep "members" (text) and "member_list" (structured) in step on every write.
create or replace function public.sync_member_fields() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    if new.member_list is null or jsonb_typeof(new.member_list) <> 'array' or jsonb_array_length(new.member_list) = 0 then
      new.member_list := public.parse_members(new.members);
    end if;
  elsif new.members is distinct from old.members and new.member_list is not distinct from old.member_list then
    new.member_list := public.parse_members(new.members);           -- edited as text (round page)
  elsif new.member_list is distinct from old.member_list and new.members is not distinct from old.members then
    new.members := public.members_text(new.member_list);            -- edited as a list
  end if;
  return new;
end $$;
drop trigger if exists teams_sync_members on public.teams;
create trigger teams_sync_members before insert or update of members, member_list on public.teams
  for each row execute function public.sync_member_fields();

-- 3. The same team in other rounds: its origin chain up to the section round, and every copy below.
create or replace function public.linked_teams(p_team int) returns setof int
language sql stable as $$
  with recursive up as (
    select id, origin_team_id from public.teams where id = p_team
    union all
    select t.id, t.origin_team_id from public.teams t join up on t.id = up.origin_team_id
  ), root as (select id from up where origin_team_id is null limit 1),
  down as (
    select id from root
    union all
    select t.id from public.teams t join down on t.origin_team_id = down.id
  )
  select id from down;
$$;

create or replace function public.propagate_members() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;   -- don't cascade from the copies' own updates
  update public.teams c set members = new.members, member_list = new.member_list
  where c.id in (select public.linked_teams(new.id)) and c.id <> new.id
    and (c.members is distinct from new.members or c.member_list is distinct from new.member_list);
  return null;
end $$;
drop trigger if exists teams_propagate_members on public.teams;
create trigger teams_propagate_members after update of members, member_list on public.teams
  for each row when (old.members is distinct from new.members or old.member_list is distinct from new.member_list)
  execute function public.propagate_members();

-- 4. Certificates read the (now always in-step) member list.
create or replace function public.team_members(p_team int)
returns table (idx int, name text, usn text)
language sql stable security definer set search_path = public as $$
  select ord::int, trim(m ->> 'name'), nullif(upper(trim(coalesce(m ->> 'usn', ''))), '')
  from public.teams t,
       jsonb_array_elements(coalesce(t.member_list, public.parse_members(t.members), '[]'::jsonb)) with ordinality as x(m, ord)
  where t.id = p_team and coalesce(trim(m ->> 'name'), '') <> '';
$$;
revoke execute on function public.team_members(int) from public, anon;

-- 5. One-time repair of existing teams -------------------------------------------
-- a) Within a team: the round page only ever changed the text, and the team portal
--    always writes both, so where they disagree the text is the later edit.
alter table public.teams disable trigger teams_propagate_members;
update public.teams set member_list = public.parse_members(members)
where coalesce(public.parse_members(members), '[]'::jsonb) <> '[]'::jsonb
  and (member_list is null or jsonb_typeof(member_list) <> 'array'
       or public.members_text(member_list) is distinct from public.members_text(public.parse_members(members)));
-- b) Across rounds: a copy with fewer members than another copy of the same team takes
--    the fuller list (adding a member later is the usual correction). Copies with the
--    same number of members are left as they are.
with grp as (
  select t.id, (select min(x) from public.linked_teams(t.id) x) as root, t.members, t.member_list,
         public.member_count(t.member_list) as n, e.sort
  from public.teams t join public.events e on e.id = t.event_id
), best as (
  select distinct on (root) root, members, member_list, n from grp order by root, n desc, sort desc
)
update public.teams t set members = b.members, member_list = b.member_list
from grp g join best b on b.root = g.root
where t.id = g.id and g.n < b.n;
alter table public.teams enable trigger teams_propagate_members;

-- 6. Issued certificates that no longer match the teams --------------------------
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
  select p.event_id, p.team_code, p.team_name, p.member_name, 'removed'
  from part p join issued i on i.event_id = p.event_id
  where not exists (select 1 from cur where cur.team_id = p.team_id and cur.idx = p.member_index);
end $$;
grant execute on function public.certificate_gaps() to authenticated;

notify pgrst, 'reload schema';
