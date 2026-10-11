import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { extendReason } from "@/lib/room-logic";
import { config } from "@/lib/room-server";
import { fmtTime } from "@/lib/time";

/**
 * A student extends THEIR running booking from the dashboard.
 *
 *   POST /api/bookings/extend   { "id": "<reservation id>" }
 *   Authorization: Bearer <the student's Supabase access token>
 *
 * extend_booking() runs as the student, so the database itself checks that
 * the booking is theirs. If the room has a smart door, the extension is also
 * written to room_events (with the service role) so the door's log and the
 * energy figures see it.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ ok: false, error: "Please sign in." }, { status: 401 });
  let body: { id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ ok: false, error: "Missing booking id." }, { status: 400 });

  const userDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } },
  );
  const { data, error } = await userDb.rpc("extend_booking", { p_id: body.id, p_mins: 30 });
  if (error) {
    const missing = /extend_booking/.test(error.message);
    return NextResponse.json({
      ok: false, error: missing ? "Extensions are not set up yet (run upgrade-room-end.sql)." : error.message,
    }, { status: missing ? 501 : 400 });
  }
  const r = data as { ok: boolean; reason?: string; added_mins?: number; new_end?: string; partial?: boolean };
  if (!r.ok) return NextResponse.json({ ok: false, reason: r.reason, error: extendReason(r.reason).app }, { status: 409 });

  // log against the door, if this room has one (optional - needs the service role)
  const cfg = config();
  if (cfg.ok) {
    const { data: b } = await cfg.db.from("reservations").select("facility_id").eq("id", body.id).maybeSingle();
    const { data: dev } = b
      ? await cfg.db.from("room_devices").select("id").eq("facility_id", b.facility_id).eq("active", true).maybeSingle()
      : { data: null };
    if (dev && b) {
      await cfg.db.from("room_events").insert({
        device_id: dev.id, facility_id: b.facility_id, reservation_id: body.id, kind: "extended",
        detail: { added_mins: r.added_mins, new_end: r.new_end, via: "app" },
      });
    }
  }

  return NextResponse.json({
    ok: true, added_mins: r.added_mins, new_end: r.new_end,
    message: `Extended by ${r.added_mins} min - now until ${fmtTime(new Date(r.new_end!))}` +
      (r.partial ? " (as far as the room allows)" : ""),
  });
}
