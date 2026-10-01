import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { codeWindow, doorCode } from "@/lib/room-logic";
import { config } from "@/lib/room-server";
import { fmtTime } from "@/lib/time";

/**
 * A student fetches the door code for one of THEIR bookings.
 *
 *   GET /api/bookings/code?id=<reservation id>
 *   Authorization: Bearer <the student's Supabase access token>
 *
 * Ownership is checked explicitly: the reservations table is readable by every
 * signed-in user, so "the row came back" does not mean "the caller owns it".
 */
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return NextResponse.json({ error: `Server not configured: ${cfg.missing}` }, { status: 500 });

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing booking id." }, { status: 400 });

  const userDb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } }
  );
  const { data: u } = await userDb.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return NextResponse.json({ error: "Session expired - sign in again." }, { status: 401 });

  const { data: b } = await cfg.db.from("reservations")
    .select("id, user_id, facility_id, start_time, end_time, status").eq("id", id).maybeSingle();
  if (!b || b.user_id !== uid) return NextResponse.json({ error: "Booking not found." }, { status: 404 });
  if (b.status !== "approved") return NextResponse.json({ error: "Codes are issued once a booking is approved." }, { status: 409 });
  if (new Date(b.end_time) <= new Date()) return NextResponse.json({ error: "This booking has ended." }, { status: 410 });

  const { data: door } = await cfg.db.from("room_devices").select("id").eq("facility_id", b.facility_id).eq("active", true).maybeSingle();
  if (!door) return NextResponse.json({ error: "This room has no smart door." }, { status: 404 });

  const { from, until } = codeWindow(b);
  return NextResponse.json({
    code: doorCode(b.id, cfg.secret),
    valid_from: from.toISOString(),
    valid_until: until.toISOString(),
    hint: `Works from ${fmtTime(from)} to ${fmtTime(until)}. Enter it on the door keypad, then press #.`,
  });
}
