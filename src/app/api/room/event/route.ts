import { NextRequest, NextResponse } from "next/server";
import { authDevice, config, logEvent, roomBookings } from "@/lib/room-server";
import { earlyReleaseDecision, isDeviceEvent } from "@/lib/room-logic";
import { fmtTime } from "@/lib/time";

/**
 * The room device reports what it did.
 *
 *   POST /api/room/event
 *   x-device-key: <key>
 *   { "device_id": "<uuid>", "kind": "lights_on", "detail": { ... } }
 *
 * Kinds: presence_on/off, lights_on/off, ac_on/off, door_open/closed,
 * reminder, released_early, heartbeat. Every event is logged against the
 * booking running at the time, which is the raw data for the energy and
 * booked-vs-used figures.
 *
 * "released_early" also acts: if the booking was checked in and the room has
 * since been empty, the rest of the booking is given back - it ends now and
 * the freed time becomes bookable - and the student is told why.
 *
 * The device decides WHEN things switch (that control loop runs on the
 * device, so it keeps working if the network drops); the server records it
 * and owns anything that changes a booking.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: `Server not configured: ${cfg.missing}` }, { status: 500 });
  const { db } = cfg;

  let body: { device_id?: string; kind?: unknown; detail?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const auth = await authDevice(db, body.device_id ?? null, req.headers.get("x-device-key"));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  const device = auth.device;

  if (!isDeviceEvent(body.kind))
    return NextResponse.json({ ok: false, error: "Unknown event kind." }, { status: 400 });
  const detail = body.detail === undefined ? null : body.detail;
  if (detail !== null && JSON.stringify(detail).length > 1000)
    return NextResponse.json({ ok: false, error: "Detail too large." }, { status: 413 });

  const now = new Date();
  const bookings = await roomBookings(db, device.facility_id, now);
  const t = now.getTime();
  const current = bookings.find((b) => new Date(b.start_time).getTime() <= t && t < new Date(b.end_time).getTime());

  if (body.kind !== "released_early") {
    await logEvent(db, device, body.kind, current?.id ?? null, detail);
    return NextResponse.json({ ok: true });
  }

  // ---- early release ----
  const decision = earlyReleaseDecision(current, now);
  if (!decision.ok) {
    await logEvent(db, device, "released_early", current?.id ?? null, { released: false, reason: decision.reason });
    return NextResponse.json({ ok: true, released: false, reason: decision.reason });
  }

  const b = current!;
  const { data: updated, error } = await db.from("reservations")
    .update({ end_time: decision.newEnd.toISOString(), cancel_reason: "early_leave", released_at: now.toISOString() })
    .eq("id", b.id).eq("status", "approved").not("checked_in_at", "is", null)
    .select("id, user_id, facility_id, end_time").maybeSingle();
  if (error || !updated)
    return NextResponse.json({ ok: false, error: error?.message ?? "Booking changed meanwhile." }, { status: 409 });

  const { data: fac } = await db.from("facilities").select("name").eq("id", updated.facility_id).maybeSingle();
  await db.from("notifications").insert({
    user_id: updated.user_id,
    title: "Booking ended early",
    body: `The room ${fac?.name ?? ""} has been empty, so your booking was ended at ` +
      `${fmtTime(decision.newEnd)} and the remaining ${decision.freedMins} minutes were released for others.`,
    type: "booking_released",
    entity_id: updated.id,
  });
  await logEvent(db, device, "released_early", b.id, { released: true, freed_mins: decision.freedMins, ...(typeof detail === "object" && detail ? detail : {}) });

  return NextResponse.json({ ok: true, released: true, freed_mins: decision.freedMins, new_end: decision.newEnd.toISOString() });
}
