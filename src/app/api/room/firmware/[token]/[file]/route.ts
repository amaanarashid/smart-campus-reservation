import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/room-server";
import { sha256hex } from "@/lib/room-logic";
import { parseConfig } from "@/lib/room-config";
import { linkKey, readLink } from "@/lib/firmware-link";
import { FIRMWARE_PARTS, personalise, publishedFile, publishedManifest } from "@/lib/firmware-build";

/**
 * The browser installer (ESP Web Tools) fetches a room's firmware here, from
 * the link POST /api/room/firmware handed out:
 *
 *   GET /api/room/firmware/<token>/manifest.json   the board's manifest, named for the room
 *   GET /api/room/firmware/<token>/firmware.bin    the app with the room's key and setup in it
 *   GET /api/room/firmware/<token>/bootloader.bin  (and the other parts, as published)
 *
 * The link is signed and expires after 15 minutes. If the room has since been
 * given another device, the link no longer matches its key and is refused.
 */
export const runtime = "nodejs";

const refuse = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string; file: string }> }) {
  const cfg = config();
  if (!cfg.ok) return refuse(500, `Server not configured: ${cfg.missing}`);
  const { token, file } = await params;
  if (!(FIRMWARE_PARTS as readonly string[]).includes(file)) return refuse(404, "No such file.");

  const r = readLink(cfg.secret, token, Math.floor(Date.now() / 1000));
  if (!r.ok) return refuse(r.reason === "expired" ? 410 : 403, r.reason === "expired"
    ? "This install link has expired. Start again from Connect a room." : "Bad install link.");
  const { link } = r;
  const key = linkKey(cfg.secret, link);

  const { data: dev } = await cfg.db.from("room_devices").select("key_hash, config, active")
    .eq("facility_id", link.facility).maybeSingle();
  if (!dev || !dev.active || dev.key_hash !== sha256hex(key))
    return refuse(410, "This room has been given another device since. Start again from Connect a room.");

  const origin = req.nextUrl.origin;
  const headers = { "Cache-Control": "no-store" };
  try {
    if (file === "manifest.json") {
      const { data: fac } = await cfg.db.from("facilities").select("name").eq("id", link.facility).maybeSingle();
      const m = await publishedManifest(origin, link.board);
      return NextResponse.json({ ...m, name: `${m.name} for ${fac?.name ?? "this room"}` }, { headers });
    }
    let data = await publishedFile(origin, link.board, file);
    if (file === "firmware.bin") {
      const setup = parseConfig(dev.config);
      if (!setup) return refuse(409, "This room has no setup saved. Start again from Connect a room.");
      data = personalise(data, key, setup);
    }
    return new NextResponse(Buffer.from(data), { headers: { ...headers, "Content-Type": "application/octet-stream" } });
  } catch (e) {
    return refuse(501, `The firmware for this board is missing (${e instanceof Error ? e.message : "unknown"}). ` +
      "Build it with PlatformIO, commit public/firmware and deploy.");
  }
}
