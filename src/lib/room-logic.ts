import { createHmac, createHash } from "node:crypto";
import { fmtTime } from "./time";

/**
 * Smart-room access logic. Server-only (uses node:crypto) and free of I/O, so
 * every rule here is unit-tested.
 *
 * Door codes are DERIVED, never stored:
 *     code = HMAC-SHA256(secret, reservation id)  ->  6 digits
 * The server recomputes the code whenever it needs it. There is no table of
 * codes to leak, and knowing one booking's code tells you nothing about any
 * other booking's code without the secret.
 */

/** How early before the start a code starts working. */
export const EARLY_ENTRY_MINS = 5;
/** Wrong codes allowed per device inside LOCKOUT_WINDOW_MINS before locking. */
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MINS = 5;
/** How long the lock stays open after a good code, milliseconds. */
export const OPEN_MS = 8000;

export function doorCode(reservationId: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(`door:${reservationId}`).digest();
  // first 4 bytes as an unsigned integer, reduced to 6 digits
  const n = mac.readUInt32BE(0) % 1_000_000;
  return n.toString().padStart(6, "0");
}

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

/** Constant-time string compare, so a wrong code/key cannot be found by timing. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface DoorBooking {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  checked_in_at: string | null;
}

/** The window in which a booking's code opens the door. */
export function codeWindow(b: Pick<DoorBooking, "start_time" | "end_time">) {
  const from = new Date(new Date(b.start_time).getTime() - EARLY_ENTRY_MINS * 60_000);
  const until = new Date(b.end_time);
  return { from, until };
}

/** Approved bookings whose code works right now, soonest first. */
export function openableNow(bookings: DoorBooking[], now: Date): DoorBooking[] {
  return bookings
    .filter((b) => b.status === "approved")
    .filter((b) => {
      const { from, until } = codeWindow(b);
      return from <= now && now < until;
    })
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
}

export type UnlockResult =
  | { ok: true; booking: DoorBooking; firstCheckIn: boolean }
  | { ok: false; reason: "no_booking_now" | "wrong_code" | "bad_format" };

/**
 * Decide whether `code` opens the door right now. At a changeover two
 * bookings can be openable at once (one ending, the next within its early
 * entry window); the code may belong to either.
 */
export function checkCode(
  code: string, bookings: DoorBooking[], now: Date, secret: string
): UnlockResult {
  if (!/^\d{6}$/.test(code)) return { ok: false, reason: "bad_format" };
  const candidates = openableNow(bookings, now);
  if (candidates.length === 0) return { ok: false, reason: "no_booking_now" };
  for (const b of candidates) {
    if (safeEqual(doorCode(b.id, secret), code)) {
      return { ok: true, booking: b, firstCheckIn: !b.checked_in_at };
    }
  }
  return { ok: false, reason: "wrong_code" };
}

/** Two short lines for the 128x64 OLED at the door. */
export function display(line1: string, line2 = ""): { line1: string; line2: string } {
  return { line1: line1.slice(0, 21), line2: line2.slice(0, 21) };
}

export interface RoomStatus {
  state: "free" | "booked" | "in_use";
  current: null | {
    ends_at: string; ends_local: string; minutes_left: number; checked_in: boolean;
  };
  next: null | { starts_at: string; starts_local: string; minutes_until: number };
  display: { line1: string; line2: string };
}

/**
 * What the door should show and do now. `bookings` = approved bookings for the
 * room around now. "booked" means a booking is running but nobody has checked
 * in yet; "in_use" means checked in.
 */
export function roomStatus(bookings: DoorBooking[], now: Date): RoomStatus {
  const approved = bookings
    .filter((b) => b.status === "approved")
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const t = now.getTime();
  const cur = approved.find((b) => new Date(b.start_time).getTime() <= t && t < new Date(b.end_time).getTime());
  const nxt = approved.find((b) => new Date(b.start_time).getTime() > t);

  const current = cur ? {
    ends_at: cur.end_time,
    ends_local: fmtTime(new Date(cur.end_time)),
    minutes_left: Math.max(0, Math.ceil((new Date(cur.end_time).getTime() - t) / 60_000)),
    checked_in: !!cur.checked_in_at,
  } : null;
  const next = nxt ? {
    starts_at: nxt.start_time,
    starts_local: fmtTime(new Date(nxt.start_time)),
    minutes_until: Math.max(0, Math.ceil((new Date(nxt.start_time).getTime() - t) / 60_000)),
  } : null;

  const state: RoomStatus["state"] = !cur ? "free" : cur.checked_in_at ? "in_use" : "booked";
  const d =
    state === "free"
      ? display("FREE", next ? `Next: ${next.starts_local}` : "No more bookings")
      : state === "booked"
      ? display("BOOKED - enter code", `until ${current!.ends_local}`)
      : display("IN USE", `until ${current!.ends_local}`);
  return { state, current, next, display: d };
}
