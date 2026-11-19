-- =====================================================================
-- Migration 011: six certificate logos; institution address
--
-- Run once in Supabase ▸ SQL Editor, after migration 010. Safe to run more
-- than once. (A fresh install only needs schema.sql, which includes this.)
--
-- What changes
--  • Four more logo slots: two under the top-left logo and two under the
--    top-right logo. Any slot can be left empty.
--  • An institution address, printed in smaller type under the institution
--    name on certificates. Edit it on Rubric & targets ▸ Hackathon details.
-- =====================================================================

alter table public.branding
  add column if not exists logo_left2  text check (logo_left2  is null or (logo_left2  like 'data:image/%' and length(logo_left2)  < 1500000)),
  add column if not exists logo_left3  text check (logo_left3  is null or (logo_left3  like 'data:image/%' and length(logo_left3)  < 1500000)),
  add column if not exists logo_right2 text check (logo_right2 is null or (logo_right2 like 'data:image/%' and length(logo_right2) < 1500000)),
  add column if not exists logo_right3 text check (logo_right3 is null or (logo_right3 like 'data:image/%' and length(logo_right3) < 1500000));

alter table public.settings
  add column if not exists address text not null default '';

notify pgrst, 'reload schema';
