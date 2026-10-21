import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authDevice, config, roomBookings } from "@/lib/room-server";
import { extensionAvailability, roomStatus } from "@/lib/room-logic";
import { signCommand, type CommandArgs } from "@/lib/room-commands";

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

  // Remote commands: anything still waiting (the HTTP fallback for MQTT), and
  // the lockdown state, so a device that restarts comes back locked down.
  const remote = await pendingCommands(cfg.db, auth.device.id, now);

  return NextResponse.json({
    ok: true, room: auth.device.label, now: now.toISOString(), ...status,
    commands: remote.commands, lockdown: remote.lockdown,
    current: status.current && {
      ...status.current,
      can_extend: extension?.ok ?? false,
      extend_mins: extension?.mins ?? 0,
      extend_reason: extension?.reason ?? null,
    },
  });
}

/** Signed pending commands for the device, and whether it is locked down. Tolerates the table not existing yet. */
async function pendingCommands(db: SupabaseClient, deviceId: string, now: Date) {
  const nowIso = now.toISOString();
  // housekeeping: anything past its expiry and never confirmed
  await db.from("room_commands").update({ status: "expired" })
    .eq("device_id", deviceId).eq("status", "sent").lt("expires_at", nowIso);
  const [{ data: pend, error }, { data: dev }, { data: lock }] = await Promise.all([
    db.from("room_commands").select("id, kind, args, expires_at")
      .eq("device_id", deviceId).eq("status", "sent").gte("expires_at", nowIso).order("issued_at").limit(10),
    db.from("room_devices").select("key_hash").eq("id", deviceId).maybeSingle(),
    db.from("room_commands").select("args").eq("device_id", deviceId).eq("kind", "lockdown")
      .in("status", ["sent", "done"]).order("issued_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (error || !dev) return { commands: [], lockdown: false };
  const nowS = Math.floor(now.getTime() / 1000);
  const commands = (pend ?? []).map((c) => {
    const s = signCommand(c.id, { kind: c.kind, args: c.args } as CommandArgs, dev.key_hash, nowS,
      Math.floor(new Date(c.expires_at).getTime() / 1000));
    return { cmd: s.cmd, sig: s.sig };
  });
  return { commands, lockdown: !!(lock?.args as { on?: boolean } | null)?.on };
}
