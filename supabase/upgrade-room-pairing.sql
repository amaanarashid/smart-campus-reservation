-- =========================================================================
--  Smart room: connect a door by pairing code (re-runnable)
--  Run after upgrade-room-connect.sql.
--
--  Every room runs the same firmware. A door that is not connected yet makes
--  its own key and shows a 6-digit code on its screen. An admin picks the room
--  and types the code: nothing is copied into the device.
--
--    device  POST /api/room/pair  ->  room_pair_poll()      (service role)
--    admin   Connect a room       ->  claim_room_pairing()  (admins only)
--
--  The key never leaves the device except in its own request header. Only its
--  SHA-256 is stored, as before. A code on its own is useless: only an admin
--  can claim it, and it only ever links the device that is showing it.
-- =========================================================================

-- Doors waiting to be connected. No policies: only the functions below use it.
create table if not exists public.room_pairings (
  key_hash   text primary key check (key_hash ~ '^[0-9a-f]{64}$'),
  code       text not null unique check (code ~ '^[0-9]{6}$'),
  connection text not null default 'wokwi' check (connection in ('wokwi', 'mqtt')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.room_pairings enable row level security;
revoke all on public.room_pairings from public, anon, authenticated;

-- One key can only run one room at a time.
create unique index if not exists room_devices_active_key
  on public.room_devices (key_hash) where active;

-- A door asks "am I connected yet?" every few seconds. Its code stays the same
-- for as long as it keeps asking, and lapses 10 minutes after it stops.
create or replace function public.room_pair_poll(p_key_hash text, p_connection text default 'wokwi')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_label text;
  v_code  text;
  v_conn  text := case when p_connection = 'mqtt' then 'mqtt' else 'wokwi' end;
  v_until timestamptz := now() + interval '10 minutes';
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Bad device key.';
  end if;

  select id, label into v_id, v_label
    from public.room_devices where key_hash = p_key_hash and active;
  if found then
    update public.room_devices set last_seen_at = now() where id = v_id;
    return jsonb_build_object('paired', true, 'device_id', v_id, 'room', v_label);
  end if;

  delete from public.room_pairings where expires_at < now();

  update public.room_pairings set expires_at = v_until, connection = v_conn
   where key_hash = p_key_hash returning code into v_code;
  if found then
    return jsonb_build_object('paired', false, 'code', v_code);
  end if;

  -- anyone can reach this endpoint, so keep the table small
  if (select count(*) from public.room_pairings) >= 200 then
    return jsonb_build_object('paired', false, 'code', null);
  end if;

  for i in 1..20 loop
    -- gen_random_uuid() is cryptographically random, unlike random()
    v_code := lpad((('x' || substr(md5(gen_random_uuid()::text), 1, 8))::bit(32)::bigint % 1000000)::text, 6, '0');
    begin
      insert into public.room_pairings (key_hash, code, connection, expires_at)
      values (p_key_hash, v_code, v_conn, v_until);
      return jsonb_build_object('paired', false, 'code', v_code);
    exception when unique_violation then
      -- the same door asking twice at once: use the code it already got
      select code into v_code from public.room_pairings where key_hash = p_key_hash;
      if found then
        return jsonb_build_object('paired', false, 'code', v_code);
      end if;
      -- otherwise another door holds this code: try a different one
    end;
  end loop;
  raise exception 'Could not make a pairing code.';
end;
$$;
revoke all on function public.room_pair_poll(text, text) from public, anon, authenticated;
grant execute on function public.room_pair_poll(text, text) to service_role;

-- An admin links the door showing this code to a room. A room that already has
-- a device keeps its id and history; the old device's key stops working.
create or replace function public.claim_room_pairing(p_code text, p_facility uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_hash text;
  v_conn text;
  v_id   uuid;
begin
  if not public.is_admin() then
    raise exception 'Only admins can connect rooms.' using errcode = '42501';
  end if;
  select name into v_name from public.facilities where id = p_facility;
  if not found then
    raise exception 'That room no longer exists.';
  end if;
  delete from public.room_pairings
   where code = p_code and expires_at >= now()
   returning key_hash, connection into v_hash, v_conn;
  if not found then
    raise exception 'That code was not found. Check the code on the door screen and try again.';
  end if;
  insert into public.room_devices (facility_id, label, key_hash, active, connection, last_seen_at)
  values (p_facility, v_name || ' door', v_hash, true, v_conn, null)
  on conflict (facility_id) do update
    set key_hash = excluded.key_hash, active = true,
        connection = excluded.connection, last_seen_at = null
  returning id into v_id;
  return v_id;
end;
$$;
revoke all on function public.claim_room_pairing(text, uuid) from public, anon;
grant execute on function public.claim_room_pairing(text, uuid) to authenticated;
