import { NextRequest, NextResponse } from "next/server";
import { config, requireAdmin } from "@/lib/room-server";
import { emqxApi, removeDeviceAccount } from "@/lib/mqtt-accounts";

/**
 * Admin -> Smart room -> a room -> Disconnect.
 *
 *   POST /api/room/disconnect
 *   Authorization: Bearer <an admin's Supabase access token>
 *   { "device_id": "<uuid>" }
 *
 * Switches the device off (it shows a pairing code again; the room keeps its
 * history) and, with the EMQX API set up, deletes its own broker login, so it
 * cannot listen for commands either.
 */
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return json({ ok: false, error: `Server not configured: ${cfg.missing}` }, 500);
  const admin = await requireAdmin(cfg.db, req.headers.get("authorization"));
  if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status);
  let body: { device_id?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON." }, 400); }
  if (!body.device_id) return json({ ok: false, error: "Missing device_id." }, 400);

  const { data, error } = await cfg.db.from("room_devices").update({ active: false }).eq("id", body.device_id).select("id").maybeSingle();
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!data) return json({ ok: false, error: "That device no longer exists." }, 404);

  let broker: string | null = null;
  const api = emqxApi();
  if (api) {
    try { await removeDeviceAccount(api, body.device_id); broker = "removed"; }
    catch (e) { broker = e instanceof Error ? e.message : String(e); }
  }
  return json({ ok: true, broker });
}
