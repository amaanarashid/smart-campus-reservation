import { NextRequest, NextResponse } from "next/server";
import { authDevice, config } from "@/lib/room-server";

/**
 * The room device confirms a remote command.
 *
 *   POST /api/room/ack
 *   x-device-key: <key>
 *   { "device_id": "<uuid>", "command_id": "<uuid>", "ok": true, "via": "mqtt", "detail": { ... } }
 *
 * Moves the command from 'sent' to 'done' (or 'failed', e.g. lights kept on
 * because people are inside). Only the device the command was for can confirm it.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: `Server not configured: ${cfg.missing}` }, { status: 500 });

  let body: { device_id?: string; command_id?: string; ok?: boolean; via?: string; detail?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ ok: false, error: "Invalid JSON." }, { status: 400 }); }

  const auth = await authDevice(cfg.db, body.device_id ?? null, req.headers.get("x-device-key"));
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });
  if (!body.command_id) return NextResponse.json({ ok: false, error: "Missing command_id." }, { status: 400 });
  const detail = body.detail === undefined ? null : body.detail;
  if (detail !== null && JSON.stringify(detail).length > 1000)
    return NextResponse.json({ ok: false, error: "Detail too large." }, { status: 413 });

  const { data, error } = await cfg.db.from("room_commands")
    .update({
      status: body.ok === false ? "failed" : "done",
      via: body.via === "mqtt" || body.via === "http" ? body.via : null,
      result: detail, done_at: new Date().toISOString(),
    })
    .eq("id", body.command_id).eq("device_id", auth.device.id).eq("status", "sent")
    .select("id").maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, updated: !!data });
}
