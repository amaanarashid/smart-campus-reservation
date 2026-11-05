import { addDays, myAt, myDateKey } from "./time";
import type { FacilityRule } from "./types";

/**
 * What the booking form offers. These only decide which choices to show, so a
 * student picks from options that fit the room instead of typing a time and
 * being told off afterwards. The checks themselves stay where they were: the
 * student page's validateRules and the database trigger.
 */
export type FormRule = Pick<FacilityRule,
  "open_time" | "close_time" | "slot_minutes" | "min_duration_mins" | "max_duration_mins" | "max_advance_days">;

const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
const toMins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));

const slotStep = (rule: Pick<FormRule, "slot_minutes"> | null | undefined) =>
  rule?.slot_minutes && rule.slot_minutes >= 15 ? rule.slot_minutes : 30;

/** Durations the facility actually allows, in steps of its slot size. */
export function durationOptions(rule: FormRule | null | undefined): number[] {
  const min = rule?.min_duration_mins ?? 30;
  const max = rule?.max_duration_mins ?? 120;
  const step = slotStep(rule);
  const out: number[] = [];
  for (let d = Math.ceil(min / step) * step; d <= max && out.length < 16; d += step) out.push(d);
  if (out.length === 0) out.push(min);
  return out;
}

export function clampDuration(want: number, rule: FormRule | null | undefined): number {
  const opts = durationOptions(rule);
  return opts.reduce((best, d) => (Math.abs(d - want) < Math.abs(best - want) ? d : best), opts[0]);
}

/** "30 min", "1 h", "1 h 30 min". */
export function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins} min`;
  return mins % 60 === 0 ? `${mins / 60} h` : `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

/**
 * Start times ("HH:MM") that fit on a day: on the room's slot grid, inside its
 * opening hours for the whole booking, not already past, and within how far
 * ahead it can be booked. Empty when nothing fits (closed, or too late today).
 */
export function timeOptions(rule: FormRule | null | undefined, dateKey: string, durationMins: number, now: Date): string[] {
  if (!rule) return [];
  const close = toMins(rule.close_time);
  const step = slotStep(rule);
  const latest = now.getTime() + rule.max_advance_days * DAY_MS;
  const out: string[] = [];
  for (let t = toMins(rule.open_time); t + durationMins <= close; t += step) {
    const hhmm = `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
    const start = myAt(dateKey, hhmm).getTime();
    if (start > now.getTime() && start <= latest) out.push(hhmm);
  }
  return out;
}

/** The option closest to `want`, or the first one if there is no wish yet. */
export function nearestTime(options: string[], want: string): string {
  if (options.length === 0) return "";
  if (!want) return options[0];
  return options.reduce((best, t) =>
    Math.abs(toMins(t) - toMins(want)) < Math.abs(toMins(best) - toMins(want)) ? t : best, options[0]);
}

/** Sensible default: the soonest bookable start, today if possible. */
export function firstSlot(rule: FormRule | null | undefined, durationMins: number, now: Date): { date: string; time: string } {
  const today = myDateKey(now);
  for (let i = 0; i <= (rule?.max_advance_days ?? 0); i++) {
    const date = addDays(today, i);
    const options = timeOptions(rule, date, durationMins, now);
    if (options.length > 0) return { date, time: options[0] };
  }
  return { date: today, time: "" };
}

/** Rooms booked before, newest first, for one-click "book again". */
export function recentFacilityIds(bookings: { facility_id: string; status: string }[], limit = 3): string[] {
  const out: string[] = [];
  for (const b of bookings) {
    if ((b.status === "approved" || b.status === "pending") && !out.includes(b.facility_id)) out.push(b.facility_id);
    if (out.length === limit) break;
  }
  return out;
}
