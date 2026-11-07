import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { config, requireAdmin } from "@/lib/room-server";
import { checkConfig, isBoard, parseConfig } from "@/lib/room-config";
import { LINK_TTL_S, linkKey, makeLink } from "@/lib/firmware-link";
import { connectRoom } from "@/lib/firmware-build";

/**
 * Firmware made for one room, for a real board: Admin -> Smart room -> Connect
 * a room -> board -> parts -> Install.
 *
 *   POST /api/room/firmware
 *   Authorization: Bearer <an admin's Supabase access token>
 *   { "facility_id": "<uuid>", "board": "esp32-cam", "config": { ...parts and pins } }
 *   -> { ok: true, manifest: "/api/room/firmware/<token>/manifest.json", expires_at }
 *
 * Connects the room to a new device key with this board and setup (replacing
 * any device the room had) and returns a link for ESP Web Tools, valid for 15
 * minutes. The browser installer fetches the manifest and parts from that link
 * (firmware/[token]/[file]/route.ts); the firmware it gets already holds the
 * key and the setup, so the board comes up connected, with the right parts.
 */
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return json({ ok: false, error: `Server not configured: ${cfg.missing}` }, 500);
  const { db } = cfg;

  const admin = await requireAdmin(db, req.headers.get("authorization"));
  if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status);
  let body: { facility_id?: string; board?: unknown; config?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON." }, 400); }
  if (!body.facility_id) return json({ ok: false, error: "Pick a room first." }, 400);
  if (!isBoard(body.board) || body.board === "wokwi-door") return json({ ok: false, error: "Pick the board." }, 400);
  const board = body.board;
  const setup = parseConfig(body.config);
  if (!setup) return json({ ok: false, error: "Bad room setup." }, 400);
  const check = checkConfig(board, setup);
  if (check.errors.length) return json({ ok: false, error: check.errors[0] }, 400);
  if (JSON.stringify(setup).length > 1024) return json({ ok: false, error: "This setup is too large to put in the firmware." }, 400);

  const { data: fac } = await db.from("facilities").select("id, name").eq("id", body.facility_id).maybeSingle();
  if (!fac) return json({ ok: false, error: "That room no longer exists." }, 404);

  const link = { facility: fac.id, board, nonce: randomBytes(12).toString("hex"), exp: Math.floor(Date.now() / 1000) + LINK_TTL_S };
  const saved = await connectRoom(db, fac, linkKey(cfg.secret, link), board, setup);
  if (!saved.ok) return json({ ok: false, error: saved.error }, 500);

  return json({
    ok: true,
    manifest: `/api/room/firmware/${makeLink(cfg.secret, link)}/manifest.json`,
    expires_at: new Date(link.exp * 1000).toISOString(),
  });
}
