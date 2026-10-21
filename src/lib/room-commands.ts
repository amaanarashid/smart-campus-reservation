import { createHmac } from "node:crypto";
import { safeEqual } from "./room-logic";
import { COMMAND_KINDS, COMMAND_TTL_S, type CommandArgs, type CommandKind } from "./room-commands-shared";

export * from "./room-commands-shared";

/**
 * Remote control of a smart room: an admin or the room's manager sends a
 * command, the server signs it and publishes it over MQTT, the ESP32 checks
 * the signature and acts. Server-only (node:crypto), free of I/O, unit-tested.
 *
 * Signing key = SHA-256 of the device key, i.e. the key_hash already stored
 * in room_devices. The device knows its own key, so it can derive the same
 * value; no new secret has to be shared.
 *
 * Wire format, published to campus/rooms/<device id>/cmd:
 *   { "cmd": "<JSON string>", "sig": "<hex HMAC-SHA256(keyHash, cmd)>" }
 * The device verifies the HMAC over the exact bytes of `cmd` before parsing
 * it, so no canonical-JSON tricks are needed. `cmd` carries a one-time id and
 * an expiry, so a copied message cannot be replayed later.
 */

export interface SignedCommand { cmd: string; sig: string; exp: number }

const hmacHex = (key: string, msg: string) => createHmac("sha256", key).update(msg).digest("hex");

/** Build the signed message for one command. `nowS` = unix seconds; `expS` re-signs a stored command with its own expiry. */
export function signCommand(id: string, c: CommandArgs, keyHash: string, nowS: number, expS?: number): SignedCommand {
  const exp = expS ?? nowS + COMMAND_TTL_S;
  const cmd = JSON.stringify({ id, kind: c.kind, args: c.args, exp });
  return { cmd, sig: hmacHex(keyHash, cmd), exp };
}

/** What the device does on arrival (mirrored in the firmware): signature, expiry, not seen before. */
export function verifyCommand(msg: { cmd?: unknown; sig?: unknown }, keyHash: string, nowS: number, seen: Set<string>):
  { ok: true; id: string; kind: CommandKind; args: Record<string, unknown> } | { ok: false; reason: "bad_signature" | "expired" | "replayed" | "malformed" } {
  if (typeof msg.cmd !== "string" || typeof msg.sig !== "string") return { ok: false, reason: "malformed" };
  if (!safeEqual(hmacHex(keyHash, msg.cmd), msg.sig.toLowerCase())) return { ok: false, reason: "bad_signature" };
  let c: { id?: unknown; kind?: unknown; args?: unknown; exp?: unknown };
  try { c = JSON.parse(msg.cmd); } catch { return { ok: false, reason: "malformed" }; }
  if (typeof c.id !== "string" || typeof c.exp !== "number" || !COMMAND_KINDS.includes(c.kind as CommandKind))
    return { ok: false, reason: "malformed" };
  if (c.exp < nowS) return { ok: false, reason: "expired" };
  if (seen.has(c.id)) return { ok: false, reason: "replayed" };
  seen.add(c.id);
  return { ok: true, id: c.id, kind: c.kind as CommandKind, args: (c.args ?? {}) as Record<string, unknown> };
}

