-- Bootstrap an administrator.
--
-- Public signup only ever creates students, so a fresh database (or one just
-- rebuilt with setup-all.sql) has no admin. Run this once to promote your own
-- account, then sign out and back in.
--
-- 1. Find your account:
select id, email, full_name, role from public.profiles order by created_at;

-- 2. Promote it (replace the email):
-- update public.profiles set role = 'admin' where email = 'your@email.com';
