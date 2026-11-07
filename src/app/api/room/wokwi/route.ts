import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { config, requireAdmin } from "@/lib/room-server";
import { DOOR_KIT, checkConfig, parseConfig } from "@/lib/room-config";
import { mergeFlash } from "@/lib/esp-image";
import { connectRoom, personalise, publishedFile, publishedManifest } from "@/lib/firmware-build";
import { wokwiDiagram } from "@/lib/wokwi-diagram";
import { makeZip } from "@/lib/zip";

/**
 * A simulated device made for one room, ready to run: Admin -> Smart room ->
 * Connect a room -> Simulated (Wokwi) -> pick the parts -> Download.
 *
 *   POST /api/room/wokwi
 *   Authorization: Bearer <an admin's Supabase access token>
 *   { "facility_id": "<uuid>", "config": { ...parts and pins } }   (config: door kit if left out)
 *
 * Makes a new device key, connects the room to it with this setup (replacing
 * any device the room had), writes the key and the setup into the published
 * Wokwi build (public/firmware/wokwi, from `pio run -e wokwi-web`), draws the
 * circuit for exactly these parts, and returns a zip: the flash image, the
 * circuit and wokwi.toml. Open the folder in VS Code with the Wokwi extension
 * and start the simulator: no build, no pairing code.
 *
 * The zip holds the device's key, so it is a credential: whoever has it can act
 * as that room's device. Downloading again replaces the key; the old zip stops working.
 */
export const runtime = "nodejs";

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

export async function POST(req: NextRequest) {
  const cfg = config();
  if (!cfg.ok) return json({ ok: false, error: `Server not configured: ${cfg.missing}` }, 500);
  const { db } = cfg;

  const admin = await requireAdmin(db, req.headers.get("authorization"));
  if (!admin.ok) return json({ ok: false, error: admin.error }, admin.status);
  let body: { facility_id?: string; config?: unknown };
  try { body = await req.json(); } catch { return json({ ok: false, error: "Invalid JSON." }, 400); }
  if (!body.facility_id) return json({ ok: false, error: "Pick a room first." }, 400);
  const setup = body.config === undefined ? DOOR_KIT : parseConfig(body.config);
  if (!setup) return json({ ok: false, error: "Bad room setup." }, 400);
  const check = checkConfig("wokwi-door", setup);
  if (check.errors.length) return json({ ok: false, error: check.errors[0] }, 400);

  const { data: fac } = await db.from("facilities").select("id, name").eq("id", body.facility_id).maybeSingle();
  if (!fac) return json({ ok: false, error: "That room no longer exists." }, 404);

  const key = randomBytes(24).toString("hex");
  let flash: Uint8Array;
  try {
    const origin = req.nextUrl.origin;
    const manifest = await publishedManifest(origin, "wokwi-door");
    const parts = await Promise.all(manifest.builds[0].parts.map(async (p) => ({
      offset: p.offset,
      data: p.path === "firmware.bin"
        ? personalise(await publishedFile(origin, "wokwi-door", p.path), key, setup)
        : await publishedFile(origin, "wokwi-door", p.path),
    })));
    flash = mergeFlash(parts);
  } catch (e) {
    return json({
      ok: false,
      error: `The simulation build is missing or out of date (${e instanceof Error ? e.message : "unknown"}). ` +
        "Build it with pio run -e wokwi-web, commit public/firmware and deploy.",
    }, 501);
  }

  const saved = await connectRoom(db, fac, key, "wokwi-door", setup);
  if (!saved.ok) return json({ ok: false, error: saved.error }, 500);

  const slug = fac.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
  const zip = makeZip([
    { name: "wokwi.toml", data: "[wokwi]\nversion = 1\nfirmware = 'firmware.bin'\n" },
    { name: "diagram.json", data: JSON.stringify(wokwiDiagram(setup, "Campus Reserve"), null, 2) },
    { name: "firmware.bin", data: flash },
    { name: "README.txt", data: readme(fac.name, !!setup.lock) },
  ]);
  return new NextResponse(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="campus-${slug}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}

const readme = (room: string, door: boolean) => `Simulated ${door ? "door" : "room device"} for ${room}
${"=".repeat((door ? 15 : 22) + room.length)}

Made for ${room}, with the parts picked in the app, and already connected.
Nothing to build or type in.

1. Unzip this folder.
2. In VS Code, install the "Wokwi Simulator" extension (once). Press F1 and run
   "Wokwi: Request a New License" (free, renew every 30 days).
3. File > Open Folder, and open this folder.
4. Press F1 and run "Wokwi: Start Simulator".

Within a few seconds the room shows Online in Admin > Smart room.

This file holds the device's key: anyone with it can act as this room's
device. Keep it to yourself. Downloading a new one from the app replaces the
key, and this copy then stops working.
`;
