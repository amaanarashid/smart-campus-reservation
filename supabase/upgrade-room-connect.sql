-- =========================================================================
--  Smart room: connect rooms from the admin console (re-runnable)
--  Run after upgrade-room-end.sql.
--
--  Admin -> Smart room -> "Connect a room" picks an existing room, chooses
--  how it is connected and generates a device key in the browser. Only the
--  SHA-256 of the key is stored (as before); the key is shown once.
--    wokwi = ESP32 simulated in Wokwi (firmware/door-wokwi)
--    mqtt  = a real board on the MQTT broker (same API + signed commands)
--  Writes go through the existing admin-only policy on room_devices.
-- =========================================================================

alter table public.room_devices
  add column if not exists connection text not null default 'wokwi';

do $$ begin
  alter table public.room_devices
    add constraint room_devices_connection_check check (connection in ('wokwi', 'mqtt'));
exception when duplicate_object then null; end $$;

-- same view as upgrade-room-end.sql, with the connection type added at the end
create or replace view public.room_devices_visible as
  select d.id, d.facility_id, d.label, d.active, d.last_seen_at, d.connection
    from public.room_devices d
   where public.is_admin()
      or exists (select 1 from public.facility_managers fm
                  where fm.facility_id = d.facility_id and fm.manager_id = auth.uid());
revoke all on public.room_devices_visible from anon;
grant select on public.room_devices_visible to authenticated;
