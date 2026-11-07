import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/room-server";
import { sha256hex } from "@/lib/room-logic";
import { deviceMqtt, validDeviceKey } from "@/lib/room-pairing";
import { defaultConfig, isBoard, parseConfig, parseReport, type Board } from "@/lib/room-config";
import { emqxApi, ensureDeviceAccount } from "@/lib/mqtt-accounts";

/**
 * A device asks whether it has been connected to a room yet, and says what it is.
 *
 *   POST /api/room/pair
 *   x-device-key: <the key the device made for itself>
 *   { "connection": "wokwi" | "mqtt", "board": "esp32-cam", "report": { firmware, parts, i2c, ir } }
 *
 * Not connected: { paired: false, code: "482913" }, which the device shows (on
 * its screen or over USB) until an admin types it into Connect a room. code is
 * null if too many devices are waiting. Connected: { paired: true, device_id,
 * room, mqtt, config, config_version } - config = which parts the room has and
 * on which pins (src/lib/room-config.ts). The device calls this again after
 * starting its parts, with what works, and whenever the config version changes.
 * mqtt = the device's own broker login when the EMQX API is set up
 * (src/lib/mqtt-accounts.ts), else the shared one.
 */
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return NextResponse.json({ ok: false, error: `Server not configured: ${cfg.missing}` }, { status: 500 });

  const key = req.headers.get("x-device-key");
  if (!validDeviceKey(key)) return NextResponse.json({ ok: false, error: "Missing or bad device key." }, { status: 401 });

  let body: { connection?: unknown; board?: unknown; report?: unknown } = {};
  try { body = await req.json(); } catch { /* the body is optional */ }
  const connection = body.connection === "mqtt" ? "mqtt" : "wokwi";
  const board: Board = isBoard(body.board) ? body.board : connection === "mqtt" ? "esp32-devkit" : "wokwi-door";
  const report = body.report === undefined ? null : parseReport(body.report, board);

  let { data, error } = await cfg.db.rpc("room_pair_poll", {
    p_key_hash: sha256hex(key), p_connection: connection, p_board: board, p_report: report,
  });
  // before upgrade-room-config.sql: the old function, and every room is a door kit
  if (error && /room_pair_poll/.test(error.message))
    ({ data, error } = await cfg.db.rpc("room_pair_poll", { p_key_hash: sha256hex(key), p_connection: connection }));
  if (error || !data) return NextResponse.json({ ok: false, error: "Could not check pairing." }, { status: 500 });

  if (!data.paired) return NextResponse.json({ ok: true, ...data });
  // the broker login and the setup only ever go to a device an admin has connected
  return NextResponse.json({
    ok: true, ...data,
    config: parseConfig(data.config) ?? defaultConfig(board),
    config_version: data.config_version ?? 1,
    mqtt: await brokerLogin(data.device_id, sha256hex(key), cfg.secret),
  });
}

/**
 * The device's own broker login (EMQX API set up: allowed only its own topic),
 * or the shared one if the API is not set up or does not answer.
 */
async function brokerLogin(deviceId: string, keyHash: string, secret: string) {
  const shared = deviceMqtt(process.env);
  const api = emqxApi();
  if (!shared || !api) return shared;
  try {
    const own = await ensureDeviceAccount(api, secret, deviceId, keyHash);
    return { ...shared, ...own };
  } catch (e) {
    console.error("Per-device MQTT login failed, using the shared one:", e instanceof Error ? e.message : e);
    return shared;
  }
}
