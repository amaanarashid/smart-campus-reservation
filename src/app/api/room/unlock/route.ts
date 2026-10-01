import { NextRequest, NextResponse } from "next/server";
import { authDevice, config, logEvent, roomBookings } from "@/lib/room-server";
import {
  checkCode, display, LOCKOUT_WINDOW_MINS, MAX_FAILED_ATTEMPTS, OPEN_MS,
} from "@/lib/room-logic";
import { fmtTime } from "@/lib/time";

/**
 * The door keypad posts here.
 *
 *   POST /api/room/unlock
 *   x-device-key: <key>
 *   { "device_id": "<uuid>", "code": "123456" }
 *
 * On a correct code for a booking that is running (or starts within 5
 * minutes) the device opens the lock, and the booking is checked in - which
 * is what stops the auto-release job from cancelling it. Five wrong codes in
 * five minutes lock the keypad for the rest of that window.
 *
 * Responses always include `display` (two short lines for the OLED), and never
 * include anyone's name.
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

  // lockout: too many wrong codes recently on this door
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINS * 60_000).toISOString();
  const { count } = await db.from("room_events")
    .select("id", { count: "exact", head: true })
    .eq("device_id", device.id).eq("kind", "unlock_denied").gte("at", since);
  if ((count ?? 0) >= MAX_FAILED_ATTEMPTS) {
    return NextResponse.json({
      ok: false, reason: "locked_out", retry_after_s: LOCKOUT_WINDOW_MINS * 60,
      display: display("Too many attempts", `Try again in ${LOCKOUT_WINDOW_MINS} min`),
    }, { status: 429 });
  }

  const code = String(body.code ?? "").trim();
  const result = checkCode(code, await roomBookings(db, device.facility_id, now), now, secret);

  if (!result.ok) {
    if (result.reason !== "bad_format") await logEvent(db, device, "unlock_denied", null, { reason: result.reason });
    const left = Math.max(0, MAX_FAILED_ATTEMPTS - (count ?? 0) - 1);
    const msg = {
      no_booking_now: display("No booking now", "Book in the app"),
      wrong_code: display("Wrong code", `${left} tries left`),
      bad_format: display("Enter 6 digits", "then press #"),
    }[result.reason];
    return NextResponse.json({ ok: false, reason: result.reason, attempts_left: left, display: msg });
  }

  const b = result.booking;
  if (result.firstCheckIn) {
    await db.from("reservations")
      .update({ checked_in_at: now.toISOString(), no_show: false })
      .eq("id", b.id).is("checked_in_at", null);
  }
  await logEvent(db, device, "unlock_ok", b.id, { first_check_in: result.firstCheckIn });

  const minutesLeft = Math.max(0, Math.ceil((new Date(b.end_time).getTime() - now.getTime()) / 60_000));
  return NextResponse.json({
    ok: true,
    open_ms: OPEN_MS,
    checked_in: true,
    first_check_in: result.firstCheckIn,
    ends_at: b.end_time,
    minutes_left: minutesLeft,
    display: display(result.firstCheckIn ? "Welcome! Checked in" : "Welcome back", `Until ${fmtTime(new Date(b.end_time))}`),
  });
}
