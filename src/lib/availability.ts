import { timeOptions, type FormRule } from "./booking-form";
import { myAt } from "./time";

/**
 * The availability grid on the student page: one row per room, one cell per
 * slot of a day, coloured free / taken. Pure so it can be tested; the
 * component only fetches busy times and draws these cells.
 */
export type CellState = "free" | "taken" | "closed" | "past";

export interface GridCell {
  /** "HH:MM" start of the cell, Malaysia time. */
  time: string;
  state: CellState;
  /** A booking of the asked length can start here (on the room's grid, inside hours, nothing in the way). */
  canStart: boolean;
  /** On the room's start grid and still ahead, even if taken: asking for it brings up suggestions. */
  onGrid: boolean;
}

type Busy = { start_time: string; end_time: string };

const pad = (n: number) => String(n).padStart(2, "0");
const toMins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const hhmm = (mins: number) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;

/** Cell size for a set of rooms: the smallest slot any of them uses (min 15, default 30). */
export function gridStep(rules: (Pick<FormRule, "slot_minutes"> | null | undefined)[]): number {
  const steps = rules.map((r) => (r?.slot_minutes && r.slot_minutes >= 15 ? r.slot_minutes : 30));
  return steps.length ? Math.min(...steps) : 30;
}

/** Column start times from openHour to closeHour. */
export function gridColumns(openHour: number, closeHour: number, step: number): string[] {
  const out: string[] = [];
  for (let t = openHour * 60; t + step <= closeHour * 60; t += step) out.push(hhmm(t));
  return out;
}

function overlaps(busy: Busy[], start: number, end: number): boolean {
  return busy.some((b) => new Date(b.start_time).getTime() < end && new Date(b.end_time).getTime() > start);
}

/** One room's cells for a day. */
export function rowCells(
  rule: FormRule | null | undefined,
  dateKey: string,
  columns: string[],
  step: number,
  busy: Busy[],
  durationMins: number,
  now: Date,
): GridCell[] {
  const starts = new Set(timeOptions(rule, dateKey, durationMins, now));
  const open = rule ? toMins(rule.open_time) : 0;
  const close = rule ? toMins(rule.close_time) : 0;
  return columns.map((time) => {
    const m = toMins(time);
    const cellStart = myAt(dateKey, time).getTime();
    const cellEnd = cellStart + step * 60_000;
    let state: CellState;
    if (!rule || m < open || m + step > close) state = "closed";
    else if (cellEnd <= now.getTime()) state = "past";
    else state = overlaps(busy, cellStart, cellEnd) ? "taken" : "free";
    const canStart = state === "free" && starts.has(time) &&
      !overlaps(busy, cellStart, cellStart + durationMins * 60_000);
    const onGrid = starts.has(time) && (state === "free" || state === "taken");
    return { time, state, canStart, onGrid };
  });
}

/** True when `time` falls inside a booking that starts at `start` and lasts `durationMins`. */
export function inRange(time: string, start: string, durationMins: number): boolean {
  if (!start) return false;
  const t = toMins(time);
  const s = toMins(start);
  return t >= s && t < s + durationMins;
}

/** How many cells a room still has free (not past) on the day. */
export const freeCount = (cells: GridCell[]) => cells.filter((c) => c.state === "free").length;
