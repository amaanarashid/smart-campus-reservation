-- Fix: students could promote themselves to admin.
--
-- The policy `profiles_update ... using (id = auth.uid())` lets a signed-in
-- user update any column of their own profile row, including `role`. From the
-- browser console:
--
--   supabase.from('profiles').update({ role: 'admin' }).eq('id', myId)
--
-- The insert path was already closed (profiles_insert requires role =
-- 'student'); the update path was not.
--
-- This trigger refuses any change to `role` made directly by an ordinary
-- signed-in user who is not an admin. It still allows:
--   * admins changing roles from the admin console (is_admin() is true)
--   * claim_demo_role(), which runs as SECURITY DEFINER, so current_user is the
--     function owner rather than 'authenticated'
--   * the service role and the SQL editor
--
-- Safe to re-run.

create or replace function public.guard_profile_role()
returns trigger
language plpgsql
as $$
begin
  if new.role is distinct from old.role
     and current_user = 'authenticated'
     and not public.is_admin() then
    raise exception 'Only an administrator can change a user''s role.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_role on public.profiles;
create trigger trg_guard_profile_role
  before update of role on public.profiles
  for each row execute function public.guard_profile_role();

-- The same hole on `id` would let a user re-key their row; block that too.
create or replace function public.guard_profile_id()
returns trigger
language plpgsql
as $$
begin
  if new.id is distinct from old.id then
    raise exception 'Profile id cannot be changed.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_profile_id on public.profiles;
create trigger trg_guard_profile_id
  before update of id on public.profiles
  for each row execute function public.guard_profile_id();

-- To confirm the fix, sign in as a student and run in the browser console:
--   await supabase.from('profiles').update({ role: 'admin' }).eq('id', (await supabase.auth.getUser()).data.user.id)
-- It should return an error mentioning "Only an administrator".
