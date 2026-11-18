-- =====================================================================
-- Migration 010: certificate logos; winners only in the final round
--
-- Run once in Supabase ▸ SQL Editor, after migration 009. Safe to run more
-- than once. (A fresh install only needs schema.sql, which includes this.)
--
-- What changes
--  • Two logos, top-left and top-right, uploaded by the admin. Either can be
--    left empty, and that corner of the certificate stays blank.
--  • Every evaluated member gets a participation certificate in every round,
--    including the final.
--  • Only the top 3 teams of the department-level final also get a winner
--    certificate (1st, 2nd, 3rd place). No other round issues winner certificates.
--  • Re-issue any round you already issued so its certificates follow these rules.
-- =====================================================================

-- 1. Logos (kept apart from settings so ordinary pages don't load the images)
create table if not exists public.branding (
  id         int primary key default 1 check (id = 1),
  logo_left  text check (logo_left  is null or (logo_left  like 'data:image/%' and length(logo_left)  < 1500000)),
  logo_right text check (logo_right is null or (logo_right like 'data:image/%' and length(logo_right) < 1500000)),
  updated_at timestamptz not null default now()
);
insert into public.branding (id) values (1) on conflict do nothing;
alter table public.branding enable row level security;
drop policy if exists read_all on public.branding;
drop policy if exists admin_all on public.branding;
create policy read_all on public.branding for select to authenticated using (true);
create policy admin_all on public.branding for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.branding to authenticated;

-- 2. A member can now hold a participation and a winner certificate in the same round.
alter table public.certificates drop constraint if exists certificates_team_id_member_index_key;
do $$ begin
  alter table public.certificates add constraint certificates_team_member_kind_key unique (team_id, member_index, kind);
exception when duplicate_object or duplicate_table then null; end $$;

-- 3. Winner certificates: top 3 of the department-level final only.
update public.events set winners_count = case when code = 'DEPT' then 3 else 0 end;

-- 4. Issuing: participation for every evaluated member, plus winner for the final's top 3.
create or replace function public.issue_certificates(p_event int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare e public.events; n int; nw int; skipped jsonb;
begin
  if not public.is_admin() then raise exception 'Only admins can issue certificates.'; end if;
  select * into e from public.events where id = p_event;
  if not found then raise exception 'That round does not exist.'; end if;
  if e.event_date is null then
    raise exception 'Set the date of % on its round page first; it is printed on the certificates.', e.name;
  end if;

  create temp table _new on commit drop as
  with members as (
    select r.team_id, r.rank, m.idx as member_index, m.name as member_name, m.usn,
           t.team_code, t.name as team_name, nullif(trim(t.problem), '') as problem, t.primary_sdg, t.secondary_sdg
    from public.v_team_result r
    join public.teams t on t.id = r.team_id
    cross join lateral public.team_members(t.id) m
    where r.event_id = p_event and r.n_criteria_scored > 0 and m.name is not null
  )
  select m.*, 'participation'::text as kind, null::text as place from members m
  union all
  select m.*, 'winner', public.place_label(m.rank) from members m where m.rank <= e.winners_count;

  delete from public.certificates c
  where c.event_id = p_event
    and not exists (select 1 from _new x where x.team_id = c.team_id and x.member_index = c.member_index and x.kind = c.kind);

  insert into public.certificates (code, event_id, team_id, member_index, member_name, usn, team_code, team_name,
                                   kind, rank, place, problem, primary_sdg, secondary_sdg, event_date, issued_at)
  select upper(substr(md5(random()::text || clock_timestamp()::text || x.team_id || '-' || x.member_index || x.kind), 1, 10)),
         p_event, x.team_id, x.member_index, x.member_name, x.usn, x.team_code, x.team_name,
         x.kind, x.rank, x.place, x.problem, x.primary_sdg, x.secondary_sdg, e.event_date, now()
  from _new x
  on conflict (team_id, member_index, kind) do update
    set member_name = excluded.member_name, usn = excluded.usn, team_code = excluded.team_code,
        team_name = excluded.team_name, rank = excluded.rank, place = excluded.place,
        problem = excluded.problem, primary_sdg = excluded.primary_sdg, secondary_sdg = excluded.secondary_sdg,
        event_date = excluded.event_date, issued_at = now();

  select count(*) filter (where kind = 'participation'), count(*) filter (where kind = 'winner')
    into n, nw from public.certificates where event_id = p_event;

  select coalesce(jsonb_agg(coalesce(t.team_code, '') || ' ' || t.name order by t.team_code), '[]'::jsonb) into skipped
  from public.v_team_result r join public.teams t on t.id = r.team_id
  where r.event_id = p_event and r.n_criteria_scored > 0
    and not exists (select 1 from public.certificates c where c.team_id = t.id);

  return jsonb_build_object('certificates', n + nw, 'participation', n, 'winner', nw, 'teams_without_members', skipped);
end $$;
grant execute on function public.issue_certificates(int) to authenticated;

notify pgrst, 'reload schema';
