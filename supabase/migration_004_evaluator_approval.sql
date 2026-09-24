-- =====================================================================
-- Migration 004: evaluator accounts need admin approval
--
-- Run once in Supabase ▸ SQL Editor if you already have the app running.
-- (A fresh install only needs schema.sql, which already includes this.)
--
-- What changes
--  • New evaluator sign-ups start as "pending" and can do nothing until an
--    admin approves them (role → evaluator) or declines them (role → rejected).
--  • The very first account on a fresh install still becomes the admin.
--  • Existing evaluators and admins are not affected.
-- =====================================================================

alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('admin', 'evaluator', 'team', 'pending', 'rejected'));

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (new.id, new.email,
          coalesce(new.raw_user_meta_data ->> 'full_name', ''),
          case when coalesce(new.raw_user_meta_data ->> 'account_type', '') = 'team' then 'team'
               when exists (select 1 from public.profiles where role = 'admin') then 'pending'
               else 'admin' end);
  return new;
end $$;

-- Only approved evaluators (and admins) count as assigned to a round, so a
-- pending or declined account can never read teams or enter marks.
create or replace function public.is_assigned(p_event int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.event_evaluators ee
                 join public.profiles p on p.id = ee.evaluator_id
                 where ee.event_id = p_event and ee.evaluator_id = auth.uid()
                   and p.role in ('evaluator', 'admin'));
$$;

-- Unapproved accounts cannot be assigned to rounds.
create or replace function public.check_assignment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if (select role from public.profiles where id = new.evaluator_id) not in ('evaluator', 'admin') then
    raise exception 'Only approved evaluators can be assigned to a round. Approve the account on the People page first.';
  end if;
  return new;
end $$;
drop trigger if exists event_evaluators_check on public.event_evaluators;
create trigger event_evaluators_check before insert or update on public.event_evaluators
  for each row execute function public.check_assignment();

-- Declining or suspending an evaluator also removes their round assignments.
create or replace function public.drop_assignments_on_demote() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.role not in ('evaluator', 'admin') and old.role in ('evaluator', 'admin') then
    delete from public.event_evaluators where evaluator_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists profiles_drop_assignments on public.profiles;
create trigger profiles_drop_assignments after update of role on public.profiles
  for each row execute function public.drop_assignments_on_demote();

notify pgrst, 'reload schema';
