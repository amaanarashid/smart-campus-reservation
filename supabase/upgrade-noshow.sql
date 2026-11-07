-- =========================================================================
--  Upgrade: no-show prediction ("Still coming?" reminders + manager badge)
-- =========================================================================
--  Run in the Supabase SQL editor AFTER upgrade-access-limits.sql.
--  Safe to re-run.
--
--  For every booking starting in the next 24 hours the database estimates
--  p = probability the student will not turn up, with the same maths as
--  src/lib/noshow.ts (checked to 1e-6 by scripts/eval/noshow-db.ts).
--
--  1. noshow_model   the trained model (weights, means, stds, metrics,
--                    reminder threshold). Admins only. The newest version is
--                    the active one; no row = "baseline" mode.
--  2. booking_risk   one score per booking + plain-English reasons. Admins
--                    and that room's managers only - students never see a
--                    score, not even their own.
--  3. score_upcoming_bookings()  pg_cron, every 10 minutes: scores bookings
--                    in the next 24 h and sends ONE "Still coming?" note
--                    ~1 hour before a high-risk booking. Nothing else.
--
--  It never blocks, penalises, auto-cancels or overbooks anyone. The
--  no-overlap constraint is untouched.
--
--  No leakage: a booking's history only counts bookings that ENDED before
--  its start - 24 h, so it never sees its own outcome.
-- =========================================================================

-- ------------------------------------------------------------------ tables --
create table if not exists public.noshow_model (
  id         bigint generated always as identity primary key,
  version    int not null unique,
  mode       text not null check (mode in ('baseline', 'logreg')),
  weights    jsonb not null default '{}'::jsonb,   -- {"bias": b, "user_rate": w1, ...}
  means      jsonb not null default '{}'::jsonb,
  stds       jsonb not null default '{}'::jsonb,
  metrics    jsonb not null default '{}'::jsonb,   -- test scores vs baselines
  threshold  double precision not null default 0.35 check (threshold > 0 and threshold < 1),
  trained_at timestamptz not null default now(),
  n_train    int not null default 0
);

create table if not exists public.booking_risk (
  reservation_id uuid primary key references public.reservations(id) on delete cascade,
  risk           double precision not null check (risk >= 0 and risk <= 1),
  reasons        jsonb not null default '[]'::jsonb,
  model_version  int not null default 0,
  mode           text not null default 'baseline',
  scored_at      timestamptz not null default now(),
  reminded_at    timestamptz                       -- the one "Still coming?" note
);
-- the reminder threshold in force when scored, so managers' badges match it
alter table public.booking_risk add column if not exists threshold double precision not null default 0.35;

-- history lookups per student
create index if not exists reservations_user_end_idx on public.reservations (user_id, end_time);

-- --------------------------------------------------------------------- RLS --
alter table public.noshow_model enable row level security;
alter table public.booking_risk enable row level security;

drop policy if exists noshow_model_select on public.noshow_model;
create policy noshow_model_select on public.noshow_model for select to authenticated
  using (public.is_admin());

drop policy if exists booking_risk_select on public.booking_risk;
create policy booking_risk_select on public.booking_risk for select to authenticated
  using (
    public.is_admin()
    or exists (select 1
                 from public.reservations r
                 join public.facility_managers fm on fm.facility_id = r.facility_id
                where r.id = booking_risk.reservation_id and fm.manager_id = auth.uid())
  );

-- written only by the scorer (SECURITY DEFINER) and the service role
revoke all on public.noshow_model from anon;
revoke all on public.booking_risk from anon;
revoke insert, update, delete on public.noshow_model from authenticated;
revoke insert, update, delete on public.booking_risk from authenticated;

-- ---------------------------------------------------------------- features --
-- Same features as buildFeatures() in src/lib/noshow.ts. Times are cut to
-- milliseconds and spans computed in whole milliseconds, like JavaScript.
create or replace function public.noshow_features(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  b        record;
  v_cutoff timestamptz;
  v_n bigint; v_k bigint; v_nc bigint; v_kc bigint; v_nu bigint; v_ku bigint;
  v_lastn bigint; v_lastk bigint;
  v_campus float8; v_cat float8; v_user float8;
  v_lead float8; v_dur float8; v_hour int; v_dow int; v_sugg boolean;
begin
  select r.id, r.user_id, r.participants,
         date_trunc('milliseconds', r.start_time) as start_time,
         date_trunc('milliseconds', r.end_time)   as end_time,
         date_trunc('milliseconds', r.created_at) as created_at,
         f.category_id, f.capacity, coalesce(e.auto_approve, false) as auto_approve
    into b
    from public.reservations r
    join public.facilities f on f.id = r.facility_id
    left join public.effective_facility_rules e on e.facility_id = r.facility_id
   where r.id = p_id;
  if not found then return null; end if;

  v_cutoff := b.start_time - interval '24 hours';

  -- labelled history (no-show = 1, checked in = 0) that ended before the cutoff
  select count(*), count(*) filter (where r.no_show) into v_n, v_k
    from public.reservations r
   where (r.no_show or r.checked_in_at is not null) and r.end_time < v_cutoff;

  select count(*), count(*) filter (where r.no_show) into v_nc, v_kc
    from public.reservations r join public.facilities f on f.id = r.facility_id
   where f.category_id = b.category_id
     and (r.no_show or r.checked_in_at is not null) and r.end_time < v_cutoff;

  select count(*), count(*) filter (where r.no_show) into v_nu, v_ku
    from public.reservations r
   where r.user_id = b.user_id
     and (r.no_show or r.checked_in_at is not null) and r.end_time < v_cutoff;

  select count(*), count(*) filter (where t.no_show) into v_lastn, v_lastk
    from (select r.no_show from public.reservations r
           where r.user_id = b.user_id
             and (r.no_show or r.checked_in_at is not null) and r.end_time < v_cutoff
           order by r.end_time desc, r.id desc limit 4) t;

  -- Beta-smoothed rates: campus prior 1/10, student strength 5, room type 10
  v_campus := (v_k + 1)::float8 / (v_n + 10)::float8;
  v_cat    := (v_kc::float8 + 10 * v_campus) / (v_nc + 10)::float8;
  v_user   := (v_ku::float8 + 5 * v_campus) / (v_nu + 5)::float8;

  v_lead := greatest(0::float8,
              (extract(epoch from (b.start_time - b.created_at)) * 1000)::float8) / 3600000::float8;
  v_dur  := (extract(epoch from (b.end_time - b.start_time)) * 1000)::float8 / 3600000::float8;
  v_hour := extract(hour from b.start_time at time zone 'Asia/Kuala_Lumpur')::int;
  v_dow  := extract(dow  from b.start_time at time zone 'Asia/Kuala_Lumpur')::int;
  v_sugg := exists (select 1 from public.evaluation_events ev
                     where ev.kind = 'rec_accepted' and ev.user_id = b.user_id
                       and abs(extract(epoch from (date_trunc('milliseconds', ev.at) - b.created_at))) <= 300);

  return jsonb_build_object(
    'x', jsonb_build_object(
      'user_rate',       v_user,
      'user_log_n',      ln(1 + v_nu::float8),
      'first_booking',   case when v_nu = 0 then 1 else 0 end,
      'category_rate',   v_cat,
      'lead_log_h',      ln(1 + v_lead),
      'early_morning',   case when v_hour < 10 then 1 else 0 end,
      'evening',         case when v_hour >= 18 then 1 else 0 end,
      'weekend',         case when v_dow in (0, 6) then 1 else 0 end,
      'duration_h',      v_dur,
      'party_ratio',     least(b.participants::float8 / greatest(1, b.capacity)::float8, 2::float8),
      'needed_approval', case when b.auto_approve then 0 else 1 end,
      'from_suggestion', case when v_sugg then 1 else 0 end),
    'raw', jsonb_build_object(
      'campus_rate', v_campus, 'user_k', v_ku, 'user_n', v_nu,
      'last_k', v_lastk, 'last_n', v_lastn, 'lead_hours', v_lead,
      'participants', b.participants, 'capacity', b.capacity));
end;
$$;
revoke all on function public.noshow_features(uuid) from public, anon, authenticated;

-- ----------------------------------------------------------------- reasons --
-- Same wording as reasonText() in src/lib/noshow.ts. Rounding is
-- floor(x + 0.5), like Math.round for positive numbers.
create or replace function public.noshow_reason(p_name text, p_high boolean, x jsonb, raw jsonb)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_h float8; v_n int; v_unit text;
begin
  case p_name
    when 'user_rate' then
      if not p_high or (raw->>'user_k')::int = 0 then return null; end if;
      if (raw->>'last_k')::int > 0 then
        return 'Missed ' || (raw->>'last_k') || ' of last ' || (raw->>'last_n')
               || case when (raw->>'last_n')::int = 1 then ' booking' else ' bookings' end;
      end if;
      return 'Missed ' || (raw->>'user_k') || ' of ' || (raw->>'user_n')
             || case when (raw->>'user_n')::int = 1 then ' past booking' else ' past bookings' end;
    when 'user_log_n' then return case when p_high then null else 'Few past bookings' end;
    when 'first_booking' then return case when p_high then 'First booking' end;
    when 'category_rate' then
      if not p_high then return null; end if;
      return 'Rooms of this type are often missed ('
             || floor((x->>'category_rate')::float8 * 100 + 0.5)::int || '%)';
    when 'lead_log_h' then
      if not p_high then return 'Booked at short notice'; end if;
      v_h := (raw->>'lead_hours')::float8;
      if v_h < 48 then v_n := floor(v_h + 0.5); v_unit := 'hour';
      elsif v_h / 24 < 14 then v_n := floor(v_h / 24 + 0.5); v_unit := 'day';
      else v_n := floor(v_h / 24 / 7 + 0.5); v_unit := 'week';
      end if;
      return 'Booked ' || v_n || ' ' || v_unit || case when v_n = 1 then '' else 's' end || ' ahead';
    when 'early_morning' then return case when p_high then 'Early-morning start' end;
    when 'evening' then return case when p_high then 'Evening start' end;
    when 'weekend' then return case when p_high then 'Weekend booking' end;
    when 'duration_h' then
      if not p_high then return 'Short booking'; end if;
      return 'Long booking (' || (floor((x->>'duration_h')::float8 * 10 + 0.5) / 10)::float8::text || ' h)';
    when 'party_ratio' then
      return case when p_high then 'Large' else 'Small' end || ' group ('
             || (raw->>'participants') || ' of ' || (raw->>'capacity') || ' seats)';
    when 'needed_approval' then
      return case when p_high then 'Needed manager approval' else 'Instant booking' end;
    when 'from_suggestion' then return case when p_high then 'Booked from a suggestion' end;
    else return null;
  end case;
end;
$$;
revoke all on function public.noshow_reason(text, boolean, jsonb, jsonb) from public, anon, authenticated;

-- ------------------------------------------------------------------- score --
-- {"risk": p, "reasons": [...], "model_version": n, "mode": "logreg"|"baseline"}
create or replace function public.noshow_score(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  f   jsonb; x jsonb; raw jsonb;
  m   record;
  v_names text[] := array['user_rate', 'user_log_n', 'first_booking', 'category_rate', 'lead_log_h',
                          'early_morning', 'evening', 'weekend', 'duration_h', 'party_ratio',
                          'needed_approval', 'from_suggestion'];
  v_w float8; v_mu float8; v_sd float8; v_zi float8;
  v_c float8[] := '{}'; v_high boolean[] := '{}';
  z   float8;
  p   float8;
  v_version int := 0;
  v_mode text := 'baseline';
  v_reasons jsonb := '[]'::jsonb;
  v_txt text;
  rec record;
begin
  f := public.noshow_features(p_id);
  if f is null then return null; end if;
  x := f->'x'; raw := f->'raw';

  select * into m from public.noshow_model order by version desc limit 1;
  if found then v_version := m.version; v_mode := m.mode; end if;

  if v_mode = 'logreg' then
    z := coalesce((m.weights->>'bias')::float8, 0);
    for i in 1 .. array_length(v_names, 1) loop
      v_w  := coalesce((m.weights->>v_names[i])::float8, 0);
      v_mu := coalesce((m.means->>v_names[i])::float8, 0);
      v_sd := coalesce((m.stds->>v_names[i])::float8, 1);
      z := z + v_w * ((x->>v_names[i])::float8 - v_mu) / v_sd;
      v_zi := ((x->>v_names[i])::float8 - v_mu) / v_sd;
      v_c := v_c || (v_w * v_zi);
      v_high := v_high || (v_zi > 0);
    end loop;
    p := 1 / (1 + exp(-greatest(-30::float8, least(30::float8, z))));
    -- top 3 contributions that push the risk up, biggest first
    for rec in select t.c, t.high, t.i::int as i
                 from unnest(v_c, v_high) with ordinality as t(c, high, i)
                where t.c > 1e-9 order by t.c desc, t.i loop
      v_txt := public.noshow_reason(v_names[rec.i], rec.high, x, raw);
      if v_txt is not null then v_reasons := v_reasons || to_jsonb(v_txt); end if;
      exit when jsonb_array_length(v_reasons) = 3;
    end loop;
  else
    -- baseline: the student's smoothed rate x (room type rate / campus rate)
    p := least(0.999::float8, greatest(0.001::float8,
           (x->>'user_rate')::float8 * ((x->>'category_rate')::float8 / (raw->>'campus_rate')::float8)));
    v_txt := public.noshow_reason('user_rate', true, x, raw);
    if v_txt is not null then v_reasons := v_reasons || to_jsonb(v_txt); end if;
    if (raw->>'user_n')::int = 0 then v_reasons := v_reasons || to_jsonb('First booking'::text); end if;
    if (x->>'category_rate')::float8 > (raw->>'campus_rate')::float8 then
      v_reasons := v_reasons || to_jsonb(public.noshow_reason('category_rate', true, x, raw));
    end if;
  end if;

  return jsonb_build_object('risk', p, 'reasons', v_reasons, 'model_version', v_version, 'mode', v_mode);
end;
$$;
revoke all on function public.noshow_score(uuid) from public, anon, authenticated;

-- -------------------------------------------------- score + one reminder --
-- Scores pending/approved bookings starting in the next 24 h, then sends ONE
-- "Still coming?" note for approved, not-yet-checked-in bookings at or above
-- the model's threshold that start in 15-70 minutes (the job runs every 10,
-- so the note lands about an hour before). reminded_at stops duplicates.
-- Returns the number of reminders sent.
create or replace function public.score_upcoming_bookings()
returns int
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  rec record;
  s   jsonb;
  v_threshold float8;
  n   int := 0;
begin
  select threshold into v_threshold from public.noshow_model order by version desc limit 1;
  v_threshold := coalesce(v_threshold, 0.35);

  for rec in
    select r.id from public.reservations r
     where r.status in ('pending', 'approved')
       and r.start_time > now() and r.start_time <= now() + interval '24 hours'
  loop
    s := public.noshow_score(rec.id);
    continue when s is null;
    insert into public.booking_risk (reservation_id, risk, reasons, model_version, mode, threshold, scored_at)
    values (rec.id, (s->>'risk')::float8, s->'reasons', (s->>'model_version')::int, s->>'mode', v_threshold, now())
    on conflict (reservation_id) do update
       set risk = excluded.risk, reasons = excluded.reasons, model_version = excluded.model_version,
           mode = excluded.mode, threshold = excluded.threshold, scored_at = excluded.scored_at;
  end loop;

  for rec in
    update public.booking_risk br
       set reminded_at = now()
      from public.reservations r
     where r.id = br.reservation_id
       and br.reminded_at is null
       and br.risk >= v_threshold
       and r.status = 'approved'
       and r.checked_in_at is null
       and r.start_time >  now() + interval '15 minutes'
       and r.start_time <= now() + interval '70 minutes'
    returning r.id, r.user_id, r.facility_id, r.start_time
  loop
    insert into public.notifications (user_id, title, body, type, entity_id)
    values (
      rec.user_id,
      'Still coming?',
      'Still coming to ' || coalesce((select name from public.facilities where id = rec.facility_id), 'your booking')
        || ' at ' || to_char(rec.start_time at time zone 'Asia/Kuala_Lumpur', 'FMHH12:MI am')
        || '? If not, please cancel so someone else can use it.',
      'noshow_check',
      rec.id
    );
    n := n + 1;
  end loop;
  return n;
end;
$$;
revoke all on function public.score_upcoming_bookings() from public, anon, authenticated;

-- --------------------------------------------------------------- schedule --
create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'score-upcoming-bookings') then
    perform cron.unschedule('score-upcoming-bookings');
  end if;
  perform cron.schedule('score-upcoming-bookings', '*/10 * * * *', 'select public.score_upcoming_bookings()');
end $$;

-- Check:  select jobname, schedule, active from cron.job;
--         select * from public.booking_risk order by scored_at desc limit 20;
