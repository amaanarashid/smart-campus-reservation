import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authDevice, config, logEvent, roomBookings, type Device } from "@/lib/room-server";
import { earlyReleaseDecision, isDeviceEvent, overstayBooking, type DoorBooking } from "@/lib/room-logic";
import { fmtTime } from "@/lib/time";

/**
 * People are still in the room after the booking ended. Logged every time;
 * the managers (or the admins, if the room has no manager) and the student
 * are notified once per booking. No penalty - a human decides what to do.
 */
async function overstay(db: SupabaseClient, device: Device, bookings: DoorBooking[], now: Date, detail: unknown) {
  const b = overstayBooking(bookings, now);
  if (!b) {
    await logEvent(db, device, "overstay", null, detail);
    return NextResponse.json({ ok: true, notified: false, reason: "no recent checked-in booking" });
  }
  const { count } = await db.from("room_events").select("id", { count: "exact", head: true })
    .eq("reservation_id", b.id).eq("kind", "overstay");
  const minsOver = Math.max(0, Math.round((now.getTime() - new Date(b.end_time).getTime()) / 60_000));
  await logEvent(db, device, "overstay", b.id, { minutes_over: minsOver, ...(typeof detail === "object" && detail ? detail : {}) });
  if ((count ?? 0) > 0) return NextResponse.json({ ok: true, notified: false, reason: "already notified" });

  const [{ data: res }, { data: fac }, { data: mgrs }] = await Promise.all([
    db.from("reservations").select("user_id").eq("id", b.id).maybeSingle(),
    db.from("facilities").select("name").eq("id", device.facility_id).maybeSingle(),
    db.from("facility_managers").select("manager_id").eq("facility_id", device.facility_id),
  ]);
  let staff = (mgrs ?? []).map((m) => m.manager_id as string);
  if (staff.length === 0) {
    const { data: admins } = await db.from("profiles").select("id").eq("role", "admin");
    staff = (admins ?? []).map((a) => a.id as string);
  }
  const room = fac?.name ?? "A room";
  const rows = staff.map((uid) => ({
    user_id: uid, title: "Room still occupied",
    body: `${room}: the booking ended at ${fmtTime(new Date(b.end_time))} but people are still inside ` +
      `(${minsOver} min over). Please check the room.`,
    type: "room_overstay", entity_id: b.id,
  }));
  if (res?.user_id) rows.push({
    user_id: res.user_id, title: "Your booking has ended",
    body: `Your booking for ${room} ended at ${fmtTime(new Date(b.end_time))}. Please leave the room ` +
      `so the next group can use it, or book more time in the app if it is free.`,
    type: "room_overstay", entity_id: b.id,
  });
  if (rows.length) await db.from("notifications").insert(rows);
  return NextResponse.json({ ok: true, notified: true, minutes_over: minsOver });
}

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

  if (body.kind === "overstay") return overstay(db, device, bookings, now, detail);

  if (body.kind === "booking_ended") {
    // the booking that just ended, not whatever is running now
    const ended = overstayBooking(bookings, now) ??
      bookings.filter((b) => new Date(b.end_time).getTime() <= t).sort((a, b) => b.end_time.localeCompare(a.end_time))[0];
    await logEvent(db, device, "booking_ended", ended?.id ?? null, detail);
    return NextResponse.json({ ok: true });
  }

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
