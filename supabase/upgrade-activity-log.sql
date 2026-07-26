-- Upgrade: system-wide activity log (audit trail) for administrators.
-- Database triggers record every meaningful action into one table, so the
-- admin has a complete, tamper-evident history regardless of how a change
-- was made. Run AFTER upgrade-lost-found.sql (safe to re-run).

create table if not exists public.activity_log (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  actor_id uuid,
  actor_name text,
  action text not null,      -- created | approved | rejected | cancelled | updated | deleted | assigned | unassigned | claimed | returned | disposed
  entity text not null,      -- reservation | facility | facility_rule | lost_and_found | equipment | facility_manager | profile
  entity_id uuid,
  summary text not null
);

create index if not exists activity_log_at_idx on public.activity_log (at desc);
create index if not exists activity_log_entity_idx on public.activity_log (entity);

alter table public.activity_log enable row level security;

-- only admins may read the log; nobody writes it directly (triggers do)
drop policy if exists activity_select on public.activity_log;
create policy activity_select on public.activity_log for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));

-- ---------- helper ----------
create or replace function public._actor_name() returns text
language sql security definer stable as $$
  select coalesce(
    (select full_name from public.profiles where id = auth.uid()),
    'system'
  );
$$;

-- ---------- trigger functions ----------
create or replace function public.log_reservation() returns trigger
language plpgsql security definer as $$
declare fname text; who text;
begin
  who := public._actor_name();
  select name into fname from public.facilities where id = coalesce(NEW.facility_id, OLD.facility_id);
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'reservation', NEW.id,
      who || ' booked ' || coalesce(fname,'a facility') || ' for ' ||
      to_char(NEW.start_time, 'DD Mon HH24:MI') || ' (' || NEW.status || ')');
  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, NEW.status, 'reservation', NEW.id,
      'Booking for ' || coalesce(fname,'a facility') || ' on ' ||
      to_char(NEW.start_time, 'DD Mon HH24:MI') || ' marked ' || NEW.status || ' by ' || who);
  end if;
  return NEW;
end $$;

create or replace function public.log_facility() returns trigger
language plpgsql security definer as $$
declare who text;
begin
  who := public._actor_name();
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'facility', NEW.id,
      who || ' added facility "' || NEW.name || '" (' || NEW.type || ') in ' || NEW.venue);
  elsif TG_OP = 'UPDATE' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'updated', 'facility', NEW.id,
      who || ' updated "' || NEW.name || '"' ||
      case when NEW.status is distinct from OLD.status then ' (status -> ' || NEW.status || ')' else '' end);
  elsif TG_OP = 'DELETE' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'deleted', 'facility', OLD.id, who || ' removed "' || OLD.name || '"');
    return OLD;
  end if;
  return NEW;
end $$;

create or replace function public.log_rule() returns trigger
language plpgsql security definer as $$
declare who text; fname text;
begin
  who := public._actor_name();
  select name into fname from public.facilities where id = NEW.facility_id;
  insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
  values (auth.uid(), who, 'updated', 'facility_rule', NEW.facility_id,
    who || ' changed booking rules for ' || coalesce(fname,'a facility'));
  return NEW;
end $$;

create or replace function public.log_lost_found() returns trigger
language plpgsql security definer as $$
declare who text;
begin
  who := public._actor_name();
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'lost_and_found', NEW.id,
      who || ' logged lost item "' || NEW.item_name || '"');
  elsif TG_OP = 'UPDATE' and NEW.status is distinct from OLD.status then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, NEW.status, 'lost_and_found', NEW.id,
      '"' || NEW.item_name || '" marked ' || NEW.status ||
      case when NEW.claimant_name is not null then ' (by ' || NEW.claimant_name || ')' else '' end);
  end if;
  return NEW;
end $$;

create or replace function public.log_manager() returns trigger
language plpgsql security definer as $$
declare who text; fname text; mname text;
begin
  who := public._actor_name();
  select name into fname from public.facilities where id = coalesce(NEW.facility_id, OLD.facility_id);
  select full_name into mname from public.profiles where id = coalesce(NEW.manager_id, OLD.manager_id);
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'assigned', 'facility_manager', NEW.facility_id,
      who || ' assigned ' || coalesce(mname,'a manager') || ' to ' || coalesce(fname,'a facility'));
  elsif TG_OP = 'DELETE' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'unassigned', 'facility_manager', OLD.facility_id,
      who || ' removed ' || coalesce(mname,'a manager') || ' from ' || coalesce(fname,'a facility'));
    return OLD;
  end if;
  return NEW;
end $$;

create or replace function public.log_equipment() returns trigger
language plpgsql security definer as $$
declare who text;
begin
  who := public._actor_name();
  if TG_OP = 'INSERT' then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'created', 'equipment', NEW.id,
      who || ' added equipment "' || NEW.name || '" x' || NEW.total_qty);
  elsif TG_OP = 'UPDATE' and NEW.total_qty is distinct from OLD.total_qty then
    insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
    values (auth.uid(), who, 'updated', 'equipment', NEW.id,
      who || ' set "' || NEW.name || '" inventory to ' || NEW.total_qty);
  end if;
  return NEW;
end $$;

create or replace function public.log_new_profile() returns trigger
language plpgsql security definer as $$
begin
  insert into public.activity_log(actor_id, actor_name, action, entity, entity_id, summary)
  values (NEW.id, NEW.full_name, 'created', 'profile', NEW.id,
    NEW.full_name || ' registered as ' || NEW.role);
  return NEW;
end $$;

-- ---------- attach triggers ----------
drop trigger if exists trg_log_reservation on public.reservations;
create trigger trg_log_reservation after insert or update on public.reservations
  for each row execute function public.log_reservation();

drop trigger if exists trg_log_facility on public.facilities;
create trigger trg_log_facility after insert or update or delete on public.facilities
  for each row execute function public.log_facility();

drop trigger if exists trg_log_rule on public.facility_rules;
create trigger trg_log_rule after update on public.facility_rules
  for each row execute function public.log_rule();

drop trigger if exists trg_log_lost_found on public.lost_and_found;
create trigger trg_log_lost_found after insert or update on public.lost_and_found
  for each row execute function public.log_lost_found();

drop trigger if exists trg_log_manager on public.facility_managers;
create trigger trg_log_manager after insert or delete on public.facility_managers
  for each row execute function public.log_manager();

drop trigger if exists trg_log_equipment on public.equipment;
create trigger trg_log_equipment after insert or update on public.equipment
  for each row execute function public.log_equipment();

drop trigger if exists trg_log_new_profile on public.profiles;
create trigger trg_log_new_profile after insert on public.profiles
  for each row execute function public.log_new_profile();
