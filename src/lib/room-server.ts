import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { safeEqual, sha256hex } from "./room-logic";
import { capabilities, parseConfig, type Capabilities, type RoomConfig } from "./room-config";

/**
 * Server-only helpers for the smart-room endpoints. Device endpoints use the
 * service role because devices are not users; everything they may do is
 * decided here, in code, after the device key has been checked.
 *
 * Needs on Vercel (Settings -> Environment Variables), never NEXT_PUBLIC_:
 *   SUPABASE_SERVICE_ROLE_KEY   Supabase -> Settings -> API -> service_role
 *   ROOM_CODE_SECRET            any long random string; changing it changes every door code
 */

export function config(): { ok: true; secret: string; db: SupabaseClient } | { ok: false; missing: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const secret = process.env.ROOM_CODE_SECRET;
  if (!url) return { ok: false, missing: "NEXT_PUBLIC_SUPABASE_URL" };
  if (!service) return { ok: false, missing: "SUPABASE_SERVICE_ROLE_KEY" };
  if (!secret || secret.length < 16) return { ok: false, missing: "ROOM_CODE_SECRET (16+ characters)" };
  const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  return { ok: true, secret, db };
}

export interface Device { id: string; facility_id: string; label: string; active: boolean }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Check a device id + key. Returns the device, or an HTTP status and message. */
export async function authDevice(
  db: SupabaseClient, deviceId: string | null, key: string | null
): Promise<{ ok: true; device: Device } | { ok: false; status: number; error: string }> {
  if (!deviceId || !UUID.test(deviceId) || !key) return { ok: false, status: 401, error: "Missing or bad device credentials." };
  const { data } = await db.from("room_devices")
    .select("id, facility_id, label, active, key_hash").eq("id", deviceId).maybeSingle();
  // same response for "no such device" and "wrong key", so ids cannot be probed
  if (!data || !safeEqual(sha256hex(key), data.key_hash)) return { ok: false, status: 401, error: "Unknown device or wrong key." };
  if (!data.active) return { ok: false, status: 403, error: "Device disabled." };
  await db.from("room_devices").update({ last_seen_at: new Date().toISOString() }).eq("id", data.id);
  return { ok: true, device: { id: data.id, facility_id: data.facility_id, label: data.label, active: data.active } };
}

/** Approved bookings for a room from 1 day ago to 1 day ahead. */
export async function roomBookings(db: SupabaseClient, facilityId: string, now: Date) {
  const { data } = await db.from("reservations")
    .select("id, start_time, end_time, status, checked_in_at")
    .eq("facility_id", facilityId).eq("status", "approved")
    .gt("end_time", new Date(now.getTime() - 86_400_000).toISOString())
    .lt("start_time", new Date(now.getTime() + 86_400_000).toISOString())
    .order("start_time");
  return data ?? [];
}

export async function logEvent(
  db: SupabaseClient, device: Device, kind: string, reservationId: string | null = null, detail: unknown = null
) {
  await db.from("room_events").insert({
    device_id: device.id, facility_id: device.facility_id, reservation_id: reservationId, kind, detail,
  });
}

export interface RoomDevice {
  id: string; key_hash: string; active: boolean;
  config: RoomConfig | null; config_version: number; caps: Capabilities;
}

/**
 * A room's device with its setup and what it can do. Works before
 * upgrade-room-config.sql has run (no setup stored = the door kit).
 */
export async function roomDevice(db: SupabaseClient, facilityId: string, activeOnly = false): Promise<RoomDevice | null> {
  type Row = { id: string; key_hash: string; active: boolean; config?: unknown; config_version?: number };
  const read = async (cols: string) => {
    let q = db.from("room_devices").select(cols).eq("facility_id", facilityId);
    if (activeOnly) q = q.eq("active", true);
    const { data, error } = await q.maybeSingle();
    return { row: data as unknown as Row | null, error };
  };
  const first = await read("id, key_hash, active, config, config_version");
  const row = first.error ? (await read("id, key_hash, active")).row : first.row;
  if (!row) return null;
  const config = parseConfig(row.config);
  return {
    id: row.id, key_hash: row.key_hash, active: row.active, config,
    config_version: row.config_version ?? 1, caps: capabilities(config),
  };
}

/**
 * The signed-in admin making this request (Authorization: Bearer <access
 * token>), or an HTTP status and message.
 */
export async function requireAdmin(db: SupabaseClient, authHeader: string | null):
  Promise<{ ok: true; uid: string } | { ok: false; status: number; error: string }> {
  const token = authHeader?.replace("Bearer ", "");
  if (!token) return { ok: false, status: 401, error: "Please sign in." };
  const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } });
  const { data: u } = await userDb.auth.getUser(token);
  if (!u?.user) return { ok: false, status: 401, error: "Session expired - sign in again." };
  const { data: prof } = await db.from("profiles").select("role").eq("id", u.user.id).maybeSingle();
  if (prof?.role !== "admin") return { ok: false, status: 403, error: "Only admins can connect rooms." };
  return { ok: true, uid: u.user.id };
}
