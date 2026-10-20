import { NextRequest, NextResponse } from "next/server";
import { authDevice, config, roomBookings } from "@/lib/room-server";
import { extensionAvailability, roomStatus } from "@/lib/room-logic";

/**
 * The door device polls this every ~30 s.
 *
 *   GET /api/room/status?device_id=<uuid>
 *   x-device-key: <key>
 *
 * Returns whether the room is free / booked (waiting for check-in) / in use,
 * the current booking's end and minutes left (for end-of-booking reminders),
 * the next booking's start and minutes until (for pre-cooling), and two lines
 * for the OLED. No names, no codes.
 */
// Route handlers are not cached by default in Next.js 16, so no `dynamic`
// export is needed (and it is removed when Cache Components is enabled).
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: `Server not configured: ${cfg.missing}` }, { status: 500 });

  const auth = await authDevice(cfg.db, req.nextUrl.searchParams.get("device_id"), req.headers.get("x-device-key"));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const now = new Date();
  const bookings = await roomBookings(cfg.db, auth.device.facility_id, now);
  const status = roomStatus(bookings, now);

  // For the room's ambient light in the last 10 minutes: can the group extend?
  let extension: ReturnType<typeof extensionAvailability> | null = null;
  if (status.current) {
    const [{ data: next }, { data: rule }] = await Promise.all([
      cfg.db.from("reservations").select("start_time")
        .eq("facility_id", auth.device.facility_id).in("status", ["pending", "approved"])
        .gte("start_time", status.current.ends_at).order("start_time").limit(1).maybeSingle(),
      cfg.db.from("effective_facility_rules").select("close_time, max_duration_mins")
        .eq("facility_id", auth.device.facility_id).maybeSingle(),
    ]);
    // the running booking's own start is needed for the max-length limit
    const running = bookings.find((b) => b.end_time === status.current!.ends_at);
    if (running) extension = extensionAvailability(running, next?.start_time ?? null, rule ?? null);
  }

  return NextResponse.json({
    ok: true, room: auth.device.label, now: now.toISOString(), ...status,
    current: status.current && {
      ...status.current,
      can_extend: extension?.ok ?? false,
      extend_mins: extension?.mins ?? 0,
      extend_reason: extension?.reason ?? null,
    },
  });
}
