import { NextRequest, NextResponse } from "next/server";
import { authDevice, config, roomBookings } from "@/lib/room-server";
import { roomStatus } from "@/lib/room-logic";

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
  const status = roomStatus(await roomBookings(cfg.db, auth.device.facility_id, now), now);
  return NextResponse.json({ ok: true, room: auth.device.label, now: now.toISOString(), ...status });
}
