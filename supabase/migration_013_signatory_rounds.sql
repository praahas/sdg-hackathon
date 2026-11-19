-- =====================================================================
-- Migration 013: signatories mapped to rounds
--
-- Run once in Supabase ▸ SQL Editor, after migration 012. Safe to run more
-- than once. (A fresh install only needs schema.sql, which includes this.)
--
-- What changes
--  • Each signatory either signs every round's certificates (as before) or
--    only the rounds the admin picks, e.g. a section coordinator signs only
--    that section's certificates while the HoD and Principal sign all.
--  • Existing signatories keep signing every round.
-- =====================================================================

alter table public.signatories
  add column if not exists event_ids int[] not null default '{}';   -- empty = all rounds

comment on column public.signatories.event_ids is
  'Rounds (events.id) whose certificates carry this signature; empty means every round.';

notify pgrst, 'reload schema';
