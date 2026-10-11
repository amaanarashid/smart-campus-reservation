import { NextRequest, NextResponse } from "next/server";
import { authDevice, config, logEvent, roomBookings } from "@/lib/room-server";
import {
  checkCode, display, extendReason, LOCKOUT_WINDOW_MINS, MAX_FAILED_ATTEMPTS,
} from "@/lib/room-logic";
import { fmtTime } from "@/lib/time";

/**
 * Extend the booking running now from the door keypad: A, the booking's code, #.
 *
 *   POST /api/room/extend
 *   x-device-key: <key>
 *   { "device_id": "<uuid>", "code": "123456" }
 *
 * The code is required so that someone outside cannot extend a booking that
 * is not theirs. Wrong codes count towards the same lockout as the door.
 * The extension itself is extend_booking() in the database: +30 minutes,
 * approved at once if the room is free next, never past closing time or the
 * room's maximum booking length.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: `Server not configured: ${cfg.missing}` }, { status: 500 });
  const { db, secret } = cfg;

  let body: { device_id?: string; code?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const auth = await authDevice(db, body.device_id ?? null, req.headers.get("x-device-key"));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const device = auth.device;
  const now = new Date();

  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINS * 60_000).toISOString();
  const { count } = await db.from("room_events")
    .select("id", { count: "exact", head: true })
    .eq("device_id", device.id).eq("kind", "unlock_denied").gte("at", since);
  if ((count ?? 0) >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json({
      ok: false, reason: "locked_out",
      display: display("Too many attempts", `Try again in ${LOCKOUT_WINDOW_MINS} min`),
    }, { status: 429 });
  }

  const bookings = await roomBookings(db, device.facility_id, now);
  const t = now.getTime();
  const running = bookings.find((b) => new Date(b.start_time).getTime() <= t && t < new Date(b.end_time).getTime());
  if (!running) {
    return NextResponse.json({ ok: false, reason: "not_running", display: display("No booking now", "") });
  }

  // the code must be the RUNNING booking's code, not the next group's
  const result = checkCode(String(body.code ?? "").trim(), [running], now, secret);
  if (!result.ok) {
    if (result.reason === "wrong_code") await logEvent(db, device, "unlock_denied", null, { reason: "wrong_code", for: "extend" });
    return NextResponse.json({
      ok: false, reason: result.reason,
      display: result.reason === "bad_format" ? display("Enter 6 digits", "then press #") : display("Wrong code", "Not extended"),
    });
  }

  const { data, error } = await db.rpc("extend_booking", { p_id: running.id, p_mins: 30 });
  if (error) {
    return NextResponse.json({
      ok: false, error: error.message,
      display: display("Can't extend now", "Run upgrade-room-end"),
    }, { status: 500 });
  }
  const r = data as { ok: boolean; reason?: string; added_mins?: number; new_end?: string };
  if (!r.ok) {
    await logEvent(db, device, "extend_denied", running.id, { reason: r.reason });
    const m = extendReason(r.reason);
    return NextResponse.json({ ok: false, reason: r.reason, display: display(m.line1, m.line2) });
  }

  const newEnd = new Date(r.new_end!);
  await logEvent(db, device, "extended", running.id, { added_mins: r.added_mins, new_end: r.new_end, via: "keypad" });
  return NextResponse.json({
    ok: true, added_mins: r.added_mins, new_end: r.new_end,
    display: display(`Extended +${r.added_mins} min`, `Now until ${fmtTime(newEnd)}`),
  });
}
