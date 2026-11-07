import { createHmac, timingSafeEqual } from "node:crypto";
import { isBoard, type Board } from "./room-config";

/**
 * Short-lived links for installing a room's own firmware from the browser.
 *
 * ESP Web Tools fetches the manifest and each firmware part with plain GETs (no
 * login), so the admin gets a signed link instead: /api/room/firmware/<token>/...
 * The token names the room, the board, a random nonce and an expiry, signed
 * with ROOM_CODE_SECRET. The device key is derived from the token the same way,
 * so it is never stored or written in a URL; only its SHA-256 is saved on the
 * room. A new link for the room replaces the key, and older links stop working.
 *
 * Pure (node:crypto only), unit-tested.
 */

export const LINK_TTL_S = 15 * 60;

export interface FirmwareLink { facility: string; board: Board; nonce: string; exp: number }

const b64 = (s: string) => Buffer.from(s).toString("base64url");
const sign = (secret: string, payload: string) => createHmac("sha256", secret).update(`fw-link:${payload}`).digest("base64url").slice(0, 32);

export function makeLink(secret: string, l: FirmwareLink): string {
  const payload = b64(JSON.stringify({ f: l.facility, b: l.board, n: l.nonce, e: l.exp }));
  return `${payload}.${sign(secret, payload)}`;
}

export function readLink(secret: string, token: string, nowS: number):
  { ok: true; link: FirmwareLink } | { ok: false; reason: "bad" | "expired" } {
  const [payload, sig] = token.split(".");
  if (!payload || !sig || sig.length !== 32) return { ok: false, reason: "bad" };
  const want = Buffer.from(sign(secret, payload));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "bad" };
  let p: { f?: unknown; b?: unknown; n?: unknown; e?: unknown };
  try { p = JSON.parse(Buffer.from(payload, "base64url").toString()); } catch { return { ok: false, reason: "bad" }; }
  if (typeof p.f !== "string" || !isBoard(p.b) || typeof p.n !== "string" || typeof p.e !== "number") return { ok: false, reason: "bad" };
  if (p.e < nowS) return { ok: false, reason: "expired" };
  return { ok: true, link: { facility: p.f, board: p.b, nonce: p.n, exp: p.e } };
}

/** The device key for a link: 64 hex characters, the size of the firmware's key slot. */
export const linkKey = (secret: string, l: Pick<FirmwareLink, "facility" | "nonce">) =>
  createHmac("sha256", secret).update(`device-key:${l.facility}:${l.nonce}`).digest("hex");
