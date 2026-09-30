-- Upgrade: per-student LinUCB state for the slot recommender.
-- Run in the Supabase SQL editor after setup-all.sql. Safe to re-run.
--
-- rec_bandit holds A^-1 (6x6) and b (6) for the student's bandit - 42 numbers
-- of model state, no personal data. Null means "not started yet"; the app then
-- starts from the prior, which matches the existing hand-set weights.
--
-- Students already may update their own profile row, which is how rec_weights
-- is written today, so no new policy is needed. Run fix-role-escalation.sql as
-- well: without it that same update permission lets a student change their own
-- role.

alter table public.profiles
  add column if not exists rec_bandit jsonb;

comment on column public.profiles.rec_bandit is
  'LinUCB state {v, Ainv, b, n, alpha, lambda} for slot ranking. Null = prior.';
