-- =====================================================================
-- Migration 009: digital certificates
--
-- Run once in Supabase ▸ SQL Editor. Safe to run more than once.
-- (A fresh install only needs schema.sql, which already includes this.)
-- Nothing existing is changed or deleted.
--
-- What it adds
--  • Signatories (name, designation, uploaded signature) printed on every certificate.
--  • Per round: how many top teams get winner certificates, and whether issued
--    certificates are released to teams.
--  • Issued certificates, one per member of every evaluated team in a round:
--    participation, or winner with the team's place. Each has a unique code.
--  • A public lookup so anyone can verify a certificate from its code or QR.
-- =====================================================================

-- 1. Signatories ---------------------------------------------------------------
create table if not exists public.signatories (
  id          serial primary key,
  name        text not null,
  designation text not null default '',
  signature   text,                        -- PNG/JPEG data URL, resized in the browser
  sort        int  not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  check (signature is null or (signature like 'data:image/%' and length(signature) < 700000))
);
alter table public.signatories enable row level security;
drop policy if exists read_all on public.signatories;
drop policy if exists admin_all on public.signatories;
create policy read_all on public.signatories for select to authenticated using (true);
create policy admin_all on public.signatories for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.signatories to authenticated;
grant usage, select on sequence public.signatories_id_seq to authenticated;

-- 2. Per-round certificate settings -------------------------------------------
alter table public.events
  add column if not exists winners_count int not null default 3 check (winners_count between 0 and 50),
  add column if not exists certificates_released boolean not null default false;

-- 3. Issued certificates --------------------------------------------------------
create table if not exists public.certificates (
  id            serial primary key,
  code          text not null unique,
  event_id      int  not null references public.events(id) on delete cascade,
  team_id       int  not null references public.teams(id) on delete cascade,
  member_index  int  not null,
  member_name   text not null,
  usn           text,
  team_code     text,
  team_name     text not null,
  kind          text not null check (kind in ('participation', 'winner')),
  rank          int,
  place         text,
  problem       text,
  primary_sdg   int references public.sdgs(id),
  secondary_sdg int references public.sdgs(id),
  event_date    date,
  issued_at     timestamptz not null default now(),
  unique (team_id, member_index)
);
create index if not exists certificates_event_idx on public.certificates(event_id);

alter table public.certificates enable row level security;
drop policy if exists admin_all on public.certificates;
drop policy if exists own_team_read on public.certificates;
create policy admin_all on public.certificates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- Teams see their own members' certificates once the round's certificates are released.
create policy own_team_read on public.certificates for select to authenticated
  using (exists (select 1 from public.teams t join public.events e on e.id = t.event_id
                 where t.id = team_id and t.owner_id = auth.uid() and e.certificates_released));
grant select, insert, update, delete on public.certificates to authenticated;

-- 4. Team members as (index, name, USN) ---------------------------------------
-- Self-registered teams have a structured member list. Admin-added teams have free
-- text such as "Asha (4CB23AI001), Bala (4CB23AI002)"; it is split on commas,
-- semicolons or new lines, and a VTU-style USN is picked out wherever it appears.
create or replace function public.team_members(p_team int)
returns table (idx int, name text, usn text)
language plpgsql stable security definer set search_path = public as $$
declare t public.teams;
begin
  select * into t from public.teams where id = p_team;
  if t.member_list is not null and jsonb_typeof(t.member_list) = 'array' and jsonb_array_length(t.member_list) > 0 then
    return query
      select ord::int, trim(m ->> 'name'), nullif(upper(trim(coalesce(m ->> 'usn', ''))), '')
      from jsonb_array_elements(t.member_list) with ordinality as x(m, ord)
      where coalesce(trim(m ->> 'name'), '') <> '';
  else
    return query
      with parts as (
        select ord::int as ord, trim(p) as p
        from regexp_split_to_table(coalesce(t.members, ''), '\s*[,;\n]\s*') with ordinality as x(p, ord)
      ), parsed as (
        select ord, p, upper(substring(p from '([0-9][A-Za-z]{2}[0-9]{2}[A-Za-z]{2,3}[0-9]{3})')) as u from parts where p <> ''
      )
      select (row_number() over (order by ord))::int,
             nullif(trim(both ' -:' from regexp_replace(regexp_replace(
               case when u is null then p else regexp_replace(p, u, '', 'i') end,
               '[()\[\]]', '', 'g'), '\s+', ' ', 'g')), ''),
             u
      from parsed;
  end if;
end $$;

-- 5. Issue (or re-issue) a round's certificates --------------------------------
-- Every member of every team with at least one mark gets a certificate. Teams
-- ranked within the round's "winners_count" get winner certificates with their
-- place. Re-issuing keeps each member's certificate code and updates the details.
create or replace function public.issue_certificates(p_event int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events; n int; skipped jsonb;
begin
  if not public.is_admin() then raise exception 'Only admins can issue certificates.'; end if;
  select * into e from public.events where id = p_event;
  if not found then raise exception 'That round does not exist.'; end if;
  if e.event_date is null then
    raise exception 'Set the date of % on its round page first; it is printed on the certificates.', e.name;
  end if;

  create temp table _new on commit drop as
  select r.team_id, m.idx as member_index, m.name as member_name, m.usn,
         t.team_code, t.name as team_name,
         case when r.rank <= e.winners_count then 'winner' else 'participation' end as kind,
         r.rank, case when r.rank <= e.winners_count then public.place_label(r.rank) end as place,
         nullif(trim(t.problem), '') as problem, t.primary_sdg, t.secondary_sdg
  from public.v_team_result r
  join public.teams t on t.id = r.team_id
  cross join lateral public.team_members(t.id) m
  where r.event_id = p_event and r.n_criteria_scored > 0 and m.name is not null;

  delete from public.certificates c
  where c.event_id = p_event
    and not exists (select 1 from _new x where x.team_id = c.team_id and x.member_index = c.member_index);

  insert into public.certificates (code, event_id, team_id, member_index, member_name, usn, team_code, team_name,
                                   kind, rank, place, problem, primary_sdg, secondary_sdg, event_date, issued_at)
  select upper(substr(md5(random()::text || clock_timestamp()::text || x.team_id || '-' || x.member_index), 1, 10)),
         p_event, x.team_id, x.member_index, x.member_name, x.usn, x.team_code, x.team_name,
         x.kind, x.rank, x.place, x.problem, x.primary_sdg, x.secondary_sdg, e.event_date, now()
  from _new x
  on conflict (team_id, member_index) do update
    set member_name = excluded.member_name, usn = excluded.usn, team_code = excluded.team_code,
        team_name = excluded.team_name, kind = excluded.kind, rank = excluded.rank, place = excluded.place,
        problem = excluded.problem, primary_sdg = excluded.primary_sdg, secondary_sdg = excluded.secondary_sdg,
        event_date = excluded.event_date, issued_at = now();
  select count(*) into n from public.certificates where event_id = p_event;

  -- Evaluated teams that produced no certificate because no member names could be read.
  select coalesce(jsonb_agg(coalesce(t.team_code, '') || ' ' || t.name order by t.team_code), '[]'::jsonb) into skipped
  from public.v_team_result r join public.teams t on t.id = r.team_id
  where r.event_id = p_event and r.n_criteria_scored > 0
    and not exists (select 1 from public.certificates c where c.team_id = t.id);

  return jsonb_build_object('certificates', n, 'teams_without_members', skipped);
end $$;
grant execute on function public.issue_certificates(int) to authenticated;

-- 6. Public verification --------------------------------------------------------
create or replace function public.verify_certificate(p_code text)
returns table (code text, member_name text, usn text, team_code text, team_name text, kind text, place text,
               problem text, primary_sdg int, secondary_sdg int, round_name text, event_date date,
               hackathon text, institution text, department text, issued_at timestamptz)
language sql stable security definer set search_path = public as $$
  select c.code, c.member_name, c.usn, c.team_code, c.team_name, c.kind, c.place, c.problem,
         c.primary_sdg, c.secondary_sdg, e.name, c.event_date, s.title, s.institution, s.department, c.issued_at
  from public.certificates c
  join public.events e on e.id = c.event_id
  cross join public.settings s
  where c.code = upper(trim(p_code)) and s.id = 1;
$$;
revoke execute on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;
grant select on public.sdgs to anon;
drop policy if exists anon_read on public.sdgs;
create policy anon_read on public.sdgs for select to anon using (true);

revoke execute on function public.team_members(int) from public, anon;

notify pgrst, 'reload schema';
