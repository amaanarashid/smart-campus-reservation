import { myAt } from "./time";
import { timeOptions, type FormRule } from "./booking-form";

/**
 * Helpers for bookings made by staff at the desk: a walk-in for a student, or
 * a block that takes a room out of use (upgrade-staff-bookings.sql). The
 * database function staff_create_booking() does the real checks; these only
 * decide what the dialog offers.
 */

const pad = (n: number) => String(n).padStart(2, "0");
const toMins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const stepOf = (rule: Pick<FormRule, "slot_minutes"> | null | undefined) =>
  rule?.slot_minutes && rule.slot_minutes >= 15 ? rule.slot_minutes : 30;

/**
 * Start times for a walk-in. Same as a student's choices, plus the slot that
 * is running right now: someone standing at the desk at 10:10 can take the
 * 10:00 slot, which the online form no longer offers.
 */
export function walkInTimes(rule: FormRule | null | undefined, dateKey: string, durationMins: number, now: Date): string[] {
  if (!rule) return [];
  const later = timeOptions(rule, dateKey, durationMins, now);
  const step = stepOf(rule);
  const close = toMins(rule.close_time);
  for (let t = toMins(rule.open_time); t + durationMins <= close; t += step) {
    const start = myAt(dateKey, hhmm(t)).getTime();
    if (start <= now.getTime() && now.getTime() < start + step * 60_000) return [hhmm(t), ...later];
  }
  return later;
}

/** Every slot boundary in the opening hours, for the "from" and "to" of a block. */
export function blockTimes(rule: FormRule | null | undefined): string[] {
  const open = rule ? toMins(rule.open_time) : 8 * 60;
  const close = rule ? toMins(rule.close_time) : 22 * 60;
  const step = stepOf(rule);
  const out: string[] = [];
  for (let t = open; t < close; t += step) out.push(hhmm(t));
  out.push(hhmm(close));
  return out;
}

/** Quick picks for the reason a manager must give. Free text is always allowed. */
export const CANCEL_REASONS = ["Maintenance in the room", "Room closed", "Needed for an event", "Double booking"];
export const REJECT_REASONS = ["Room not available then", "Group too large for the room", "Not a permitted use", "The requested time has passed"];
export const BLOCK_REASONS = ["Maintenance", "Cleaning", "Event", "Closed"];

/** A reason must say something: at least 3 characters after trimming. */
export const validReason = (s: string) => s.trim().length >= 3;

type DbError = { code?: string; message: string } | null;

/**
 * True when the database has not had upgrade-staff-bookings.sql run yet:
 * the function or a column is unknown, or the old cancel_reason check
 * refuses the value 'staff'.
 */
export function needsStaffUpgrade(err: DbError): boolean {
  if (!err) return false;
  if (err.code === "PGRST202" || err.code === "PGRST204" || err.code === "42703" || err.code === "42883") return true;
  return /staff_create_booking|staff_note|booking_kind|cancel_reason/i.test(err.message);
}

export const UPGRADE_HINT = "Run supabase/upgrade-staff-bookings.sql in the Supabase SQL editor first.";

/** Escape % and _ so an email is matched literally by ilike (case-insensitive equals). */
export const ilikeExact = (s: string) => s.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
