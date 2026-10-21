import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { config } from "@/lib/room-server";
import {
  COMMAND_TTL_S, commandTopic, describeCommand, signCommand, validateCommand,
} from "@/lib/room-commands";
import { mqttConfigured, publish } from "@/lib/mqtt-publish";

/**
 * Remote control: an admin or a manager of the room sends a command to its
 * smart-room device.
 *
 *   POST /api/room/command
 *   Authorization: Bearer <the user's Supabase access token>
 *   { "facility_id": "<uuid>", "kind": "lights", "args": { "state": "off", "mins": 30 } }
 *
 * The command is checked, saved (status 'sent'), signed with the device's key
 * hash, and published over MQTT. If MQTT is not configured or the broker is
 * unreachable, the device still gets it over HTTP on its next status poll.
 */
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return json({ ok: false, error: `Server not configured: ${cfg.missing}` }, 500);
  const { db } = cfg;

  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return json({ ok: false, error: "Please sign in." }, 401);
  let body: { facility_id?: string; kind?: unknown; args?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON." }, 400); }
  if (!body.facility_id) return json({ ok: false, error: "Missing facility_id." }, 400);

  const v = validateCommand(body.kind, body.args);
  if (!v.ok) return json({ ok: false, error: v.error }, 400);

  // who is asking?
  const userDb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } });
  const { data: u } = await userDb.auth.getUser(token);
  const uid = u?.user?.id;
  if (!uid) return json({ ok: false, error: "Session expired - sign in again." }, 401);

  const [{ data: prof }, { data: mgr }, { data: dev }] = await Promise.all([
    db.from("profiles").select("role").eq("id", uid).maybeSingle(),
    db.from("facility_managers").select("id").eq("facility_id", body.facility_id).eq("manager_id", uid).maybeSingle(),
    db.from("room_devices").select("id, key_hash, active").eq("facility_id", body.facility_id).maybeSingle(),
  ]);
  if (prof?.role !== "admin" && !mgr) return json({ ok: false, error: "Only admins and this room's managers can control it." }, 403);
  if (!dev || !dev.active) return json({ ok: false, error: "This room has no active smart device." }, 404);

  // save, sign, publish
  const id = randomUUID();
  const nowS = Math.floor(Date.now() / 1000);
  const signed = signCommand(id, v.value, dev.key_hash, nowS);
  const { error: insErr } = await db.from("room_commands").insert({
    id, device_id: dev.id, facility_id: body.facility_id, kind: v.value.kind, args: v.value.args,
    issued_by: uid, expires_at: new Date(signed.exp * 1000).toISOString(),
  });
  if (insErr) {
    const missing = /room_commands/.test(insErr.message);
    return json({ ok: false, error: missing ? "Remote control is not set up yet (run upgrade-room-commands.sql)." : insErr.message }, missing ? 501 : 500);
  }

  let delivery: "mqtt" | "http" = "http";
  let mqttError: string | null = null;
  if (mqttConfigured()) {
    const r = await publish(commandTopic(dev.id), JSON.stringify({ cmd: signed.cmd, sig: signed.sig }));
    if (r.ok) delivery = "mqtt"; else mqttError = r.error;
  }

  return json({
    ok: true, id, delivery, mqtt_error: mqttError,
    message: `${describeCommand(v.value.kind, v.value.args)} - ` +
      (delivery === "mqtt" ? "sent to the room" : `the room picks it up within 30 s`),
    expires_in_s: COMMAND_TTL_S,
  });
}
