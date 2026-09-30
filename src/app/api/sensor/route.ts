import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

/**
 * Occupancy ingest endpoint for ESP32-CAM room sensors.
 *
 * The device performs the whole signal chain on-board - capture, spatial
 * decimation, frame differencing, IIR low-pass, Schmitt trigger, dwell timer -
 * and posts only the resulting numbers. No image data is accepted here, and
 * none is stored anywhere in the system. A request carrying anything that
 * looks like image data is rejected.
 *
 * Auth is a per-device shared key. Only its SHA-256 digest is held in the
 * database, so a dump of occupancy_devices does not let anyone impersonate a
 * sensor.
 *
 *   POST /api/sensor
 *   x-device-key: <key>
 *   { "device_id": uuid, "metric_raw": 4.13, "metric_ema": 3.28,
 *     "occupied": true, "is_change": true, "uptime_s": 812 }
 */

export const runtime = "nodejs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

type Payload = {
  device_id?: string;
  metric_raw?: number;
  metric_ema?: number;
  occupied?: boolean;
  is_change?: boolean;
  uptime_s?: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Constant-time compare so a wrong key cannot be found by timing the reply. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Per-device rate limit. A sensor posting on state change plus a 60 s
// heartbeat should never approach this.
const hits = new Map<string, { n: number; t: number }>();
function rateLimited(id: string, limit = 120, windowMs = 60_000): boolean {
  const now = Date.now();
  const h = hits.get(id);
  if (!h || now - h.t > windowMs) {
    hits.set(id, { n: 1, t: now });
    return false;
  }
  h.n += 1;
  return h.n > limit;
}

export async function POST(req: NextRequest) {
  if (!SERVICE_KEY) {
    return NextResponse.json(
      { error: "Server not configured: SUPABASE_SERVICE_ROLE_KEY is missing." },
      { status: 500 }
    );
  }

  const key = req.headers.get("x-device-key");
  if (!key) return NextResponse.json({ error: "Missing device key." }, { status: 401 });

  let body: Payload;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  // Refuse anything image-shaped. Nothing upstream should ever send one, and
  // silently accepting it would break the privacy claim the design rests on.
  for (const k of ["image", "frame", "jpeg", "jpg", "photo", "b64", "data"]) {
    if (k in (body as Record<string, unknown>)) {
      return NextResponse.json(
        { error: "Image data is not accepted by this endpoint." },
        { status: 400 }
      );
    }
  }

  const { device_id, metric_raw, metric_ema, occupied, is_change, uptime_s } = body;

  if (!device_id || !UUID.test(device_id))
    return NextResponse.json({ error: "Bad device_id." }, { status: 400 });
  if (typeof metric_raw !== "number" || !Number.isFinite(metric_raw))
    return NextResponse.json({ error: "Bad metric_raw." }, { status: 400 });
  if (typeof metric_ema !== "number" || !Number.isFinite(metric_ema))
    return NextResponse.json({ error: "Bad metric_ema." }, { status: 400 });
  if (typeof occupied !== "boolean")
    return NextResponse.json({ error: "Bad occupied." }, { status: 400 });

  if (rateLimited(device_id))
    return NextResponse.json({ error: "Too many readings." }, { status: 429 });

  const db = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: device, error: devErr } = await db
    .from("occupancy_devices")
    .select("id, facility_id, key_hash, active, sample_ms, alpha, t_high, t_low, dwell_s")
    .eq("id", device_id)
    .single();

  if (devErr || !device)
    return NextResponse.json({ error: "Unknown device." }, { status: 401 });
  if (!safeEqual(sha256(key), device.key_hash))
    return NextResponse.json({ error: "Bad device key." }, { status: 401 });
  if (!device.active)
    return NextResponse.json({ error: "Device is disabled." }, { status: 403 });

  const now = new Date().toISOString();

  await db.from("occupancy_readings").insert({
    device_id: device.id,
    facility_id: device.facility_id,
    recorded_at: now,
    metric_raw,
    metric_ema,
    occupied,
    is_change: Boolean(is_change),
    uptime_s: typeof uptime_s === "number" ? Math.trunc(uptime_s) : null,
  });

  await db
    .from("facilities")
    .update({ sensor_occupied: occupied, sensor_updated_at: now })
    .eq("id", device.facility_id);

  await db
    .from("occupancy_devices")
    .update({ last_seen_at: now })
    .eq("id", device.id);

  // First time the room is seen occupied inside an approved booking, that
  // booking is checked in. Attendance stops being a button someone remembers
  // to press.
  let checked_in: string | null = null;
  if (occupied) {
    const { data } = await db.rpc("sensor_mark_attendance", {
      p_facility_id: device.facility_id,
      p_at: now,
    });
    checked_in = (data as string | null) ?? null;
  }

  // The device re-reads its tuning on every reply, so thresholds can be
  // changed from the admin console without reflashing.
  return NextResponse.json({
    ok: true,
    checked_in,
    config: {
      sample_ms: device.sample_ms,
      alpha: Number(device.alpha),
      t_high: Number(device.t_high),
      t_low: Number(device.t_low),
      dwell_s: device.dwell_s,
    },
  });
}

export async function GET() {
  return NextResponse.json({ error: "POST only." }, { status: 405 });
}
