import type { SupabaseClient } from "@supabase/supabase-js";
import { sha256hex } from "./room-logic";
import type { Board, RoomConfig } from "./room-config";
import { writeConfig, writeKey } from "./esp-image";

/**
 * Server side of "firmware made for a room": the published build for a board
 * (public/firmware/<folder>/, from PlatformIO) with the room's key and setup
 * written in, and the room's device record pointed at that key.
 */

export const FIRMWARE_FOLDER: Record<Board, string> = {
  "wokwi-door": "wokwi", "esp32-devkit": "esp32-devkit", "esp32-cam": "esp32-cam",
};
export const FIRMWARE_PARTS = ["bootloader.bin", "partitions.bin", "boot_app0.bin", "firmware.bin", "manifest.json"] as const;

export interface Manifest { name: string; version: string; builds: { chipFamily: string; parts: { path: string; offset: number }[] }[] }

/** One file of the published build, fetched from this site's own static files. */
export async function publishedFile(origin: string, board: Board, name: string): Promise<Uint8Array> {
  const r = await fetch(new URL(`/firmware/${FIRMWARE_FOLDER[board]}/${name}`, origin), { cache: "no-store" });
  if (!r.ok) throw new Error(`${FIRMWARE_FOLDER[board]}/${name} is missing`);
  return new Uint8Array(await r.arrayBuffer());
}

export async function publishedManifest(origin: string, board: Board): Promise<Manifest> {
  return JSON.parse(new TextDecoder().decode(await publishedFile(origin, board, "manifest.json")));
}

/** The app image with this room's key and setup in it. */
export const personalise = (app: Uint8Array, key: string, config: RoomConfig) => writeConfig(writeKey(app, key), config);

/**
 * Point the room's device record at a new key (the old device stops working;
 * the room keeps its id and history) with this board and setup.
 */
export async function connectRoom(db: SupabaseClient, f: { id: string; name: string }, key: string,
  board: Board, config: RoomConfig): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = {
    label: `${f.name} ${config.lock ? "door" : "room"}`, key_hash: sha256hex(key), active: true,
    connection: board === "wokwi-door" ? "wokwi" : "mqtt", last_seen_at: null,
  };
  const { data: existing } = await db.from("room_devices").select("id, config_version").eq("facility_id", f.id).maybeSingle();
  const full = { ...row, board, config, config_version: (existing?.config_version ?? 0) + 1 };
  const save = (r: Record<string, unknown>) => existing
    ? db.from("room_devices").update(r).eq("id", existing.id)
    : db.from("room_devices").insert({ facility_id: f.id, ...r });
  let { error } = await save(full);
  if (error && /board|config/.test(error.message)) ({ error } = await save(row));   // before upgrade-room-config.sql
  return error ? { ok: false, error: error.message } : { ok: true };
}
