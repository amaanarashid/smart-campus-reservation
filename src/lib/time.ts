/**
 * Campus time. Every date and hour in the booking logic is Malaysia time,
 * whatever machine the code runs on.
 *
 * Why this exists: JavaScript's getHours() and setHours() use the clock of the
 * machine running the code. In a Malaysian browser that is UTC+8, on a cloud
 * server it is usually UTC, and new Date().toISOString() is always UTC. So
 * "today" computed with toISOString() is yesterday between midnight and 8am,
 * and the same recommender gives different answers in the browser and on the
 * server. These helpers remove that dependence.
 *
 * Malaysia has observed a fixed UTC+8 with no daylight saving since 1982, so a
 * constant offset is exact and needs no timezone database.
 */

export const CAMPUS_TZ = "Asia/Kuala_Lumpur";
const OFFSET_MS = 8 * 60 * 60 * 1000;
const OFFSET_STR = "+08:00";

/** Shift an instant so its UTC fields read as Malaysia wall-clock fields. */
function wall(d: Date): Date {
  return new Date(d.getTime() + OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Calendar date in Malaysia as "YYYY-MM-DD". */
export function myDateKey(d: Date = new Date()): string {
  const w = wall(d);
  return `${w.getUTCFullYear()}-${pad(w.getUTCMonth() + 1)}-${pad(w.getUTCDate())}`;
}

/** The instant at which Malaysia wall-clock reads `hhmm` on `dateKey`. */
export function myAt(dateKey: string, hhmm: string): Date {
  const [h, m = "00"] = hhmm.split(":");
  return new Date(`${dateKey}T${pad(Number(h))}:${pad(Number(m))}:00${OFFSET_STR}`);
}

/** Hour of day in Malaysia as a fraction, e.g. 15.5 for 3:30 pm. */
export function myHour(d: Date): number {
  const w = wall(d);
  return w.getUTCHours() + w.getUTCMinutes() / 60;
}

/** Whole hour of day in Malaysia, 0-23. */
export function myWholeHour(d: Date): number {
  return wall(d).getUTCHours();
}

/** Day of week in Malaysia, 0 = Sunday. */
export function myWeekday(d: Date): number {
  return wall(d).getUTCDay();
}

/** Add whole days to a date key. */
export function addDays(dateKey: string, n: number): string {
  const d = myAt(dateKey, "12:00"); // midday avoids any edge at midnight
  return myDateKey(new Date(d.getTime() + n * 86_400_000));
}

/** Whole days from `a` to `b`, both date keys. */
export function daysBetween(a: string, b: string): number {
  return Math.round((myAt(b, "12:00").getTime() - myAt(a, "12:00").getTime()) / 86_400_000);
}

/** "3:00 pm" in Malaysia time. */
export function fmtTime(d: Date): string {
  const w = wall(d);
  const h = w.getUTCHours();
  const m = w.getUTCMinutes();
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "am" : "pm"}`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Fri 2 Oct" for a date key. */
export function fmtDay(dateKey: string): string {
  const d = myAt(dateKey, "12:00");
  const w = wall(d);
  return `${DAYS[w.getUTCDay()]} ${w.getUTCDate()} ${MONTHS[w.getUTCMonth()]}`;
}

/** "today", "tomorrow", or "Fri 2 Oct", relative to `now`. */
export function fmtRelativeDay(dateKey: string, now: Date = new Date()): string {
  const diff = daysBetween(myDateKey(now), dateKey);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  return fmtDay(dateKey);
}
