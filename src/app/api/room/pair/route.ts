import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/room-server";
import { sha256hex } from "@/lib/room-logic";
import { deviceMqtt, validDeviceKey } from "@/lib/room-pairing";

/**
 * A door asks whether it has been connected to a room yet.
 *
 *   POST /api/room/pair
 *   x-device-key: <the key the device made for itself>
 *   { "connection": "wokwi" | "mqtt" }
 *
 * Not connected: { paired: false, code: "482913" }, which the door shows on its
 * screen until an admin types it into Connect a room. code is null if too many
 * doors are waiting. Connected: { paired: true, device_id, room, mqtt }.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: `Server not configured: ${cfg.missing}` }, { status: 500 });

  const key = req.headers.get("x-device-key");
  if (!validDeviceKey(key)) return NextResponse.json({ ok: false, error: "Missing or bad device key." }, { status: 401 });

  let connection: unknown;
  try { connection = (await req.json()).connection; } catch { /* the body is optional */ }

  const { data, error } = await cfg.db.rpc("room_pair_poll", {
    p_key_hash: sha256hex(key),
    p_connection: connection === "mqtt" ? "mqtt" : "wokwi",
  });
  if (error || !data) return NextResponse.json({ ok: false, error: "Could not check pairing." }, { status: 500 });

  // the broker login only ever goes to a door an admin has connected
  return NextResponse.json({ ok: true, ...data, ...(data.paired ? { mqtt: deviceMqtt(process.env) } : {}) });
}
