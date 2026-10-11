import { addDays, myAt, myDateKey } from "./time";

/**
 * Energy figures for a smart room, computed from what the room device
 * reported (room_events) and what was booked (reservations). Pure, so it runs
 * the same in the admin console and in the unit tests.
 *
 *   ACTUAL    lights and air-con on-time, from their *_on / *_off events
 *   BASELINE  a conventional room: lights and air-con run for every booked
 *             minute, including bookings nobody turned up to and the tail of
 *             bookings people left early
 *   SAVED     baseline - actual
 *
 *   E = P x t        (kWh = kW x hours)
 *
 * Power ratings are assumptions for a small discussion room; state them in the
 * report and change them here if you measure or cite different values.
 */
export const LIGHT_KW = 0.12;   // e.g. 4 x 30 W LED panels
export const AC_KW = 1.1;       // e.g. 1.5 hp split unit, electrical input
/** Grid emission factor (kg CO2 per kWh). An assumption: replace with the figure you cite. */
export const CO2_KG_PER_KWH = 0.585;

export interface EnergyEvent { at: string; kind: string; reservation_id: string | null; detail?: unknown }
export interface EnergyBooking {
  id: string; start_time: string; end_time: string; status: string;
  checked_in_at: string | null; cancel_reason?: string | null;
}
export type Interval = [number, number];   // ms epoch, [start, end)

/**
 * On-intervals of one output from its on/off events (sorted or not). An
 * output still on at `until` is closed there; a repeated "on" is ignored.
 */
export function onIntervals(events: EnergyEvent[], onKind: string, offKind: string, until: number): Interval[] {
  const out: Interval[] = [];
  let since: number | null = null;
  const evs = events
    .filter((e) => e.kind === onKind || e.kind === offKind)
    .map((e) => ({ t: new Date(e.at).getTime(), on: e.kind === onKind }))
    .sort((a, b) => a.t - b.t);
  for (const e of evs) {
    if (e.t > until) break;
    if (e.on && since === null) since = e.t;
    else if (!e.on && since !== null) { if (e.t > since) out.push([since, e.t]); since = null; }
  }
  if (since !== null && until > since) out.push([since, until]);
  return out;
}

/** Minutes of `intervals` that fall inside [from, to). */
export function minutesIn(intervals: Interval[], from: number, to: number): number {
  let ms = 0;
  for (const [s, e] of intervals) ms += Math.max(0, Math.min(e, to) - Math.max(s, from));
  return ms / 60_000;
}

/**
 * Booked time a conventional room would have powered: every approved booking
 * (as it ended up), plus no-shows released by the check-in rule (the whole
 * slot), plus the minutes given back by early releases (from the
 * released_early event, since the booking's end was moved forward).
 */
export function bookedIntervals(bookings: EnergyBooking[], events: EnergyEvent[]): Interval[] {
  const out: Interval[] = [];
  for (const b of bookings) {
    const counts = b.status === "approved" || (b.status === "cancelled" && b.cancel_reason === "no_checkin");
    if (!counts) continue;
    const s = new Date(b.start_time).getTime();
    let e = new Date(b.end_time).getTime();
    const rel = events.find((x) => x.kind === "released_early" && x.reservation_id === b.id &&
      typeof x.detail === "object" && x.detail !== null && (x.detail as { released?: boolean }).released);
    if (rel) e += Number((rel.detail as { freed_mins?: number }).freed_mins ?? 0) * 60_000;
    if (e > s) out.push([s, e]);
  }
  return out;
}

const kwh = (mins: number, kw: number) => (mins / 60) * kw;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface EnergyDay {
  day: string;                 // YYYY-MM-DD, Malaysia time
  bookedMins: number; usedMins: number; lightsMins: number; acMins: number;
  baselineKwh: number; actualKwh: number; savedKwh: number;
}
export interface EnergyReport {
  days: EnergyDay[];
  totals: Omit<EnergyDay, "day"> & { savedPct: number; co2Kg: number };
  counts: { noShowsReleased: number; earlyReleases: number; overstays: number; extensions: number; reminders: number };
}

/**
 * The report for the Malaysia-time days fromDay..toDay inclusive. `now`
 * closes any output still switched on.
 */
export function energyReport(
  events: EnergyEvent[], bookings: EnergyBooking[], fromDay: string, toDay: string, now: Date,
): EnergyReport {
  const t = now.getTime();
  const lights = onIntervals(events, "lights_on", "lights_off", t);
  const ac = onIntervals(events, "ac_on", "ac_off", t);
  const used = onIntervals(events, "presence_on", "presence_off", t);
  const booked = bookedIntervals(bookings, events);

  const days: EnergyDay[] = [];
  for (let d = fromDay; d <= toDay; d = addDays(d, 1)) {
    const a = myAt(d, "00:00").getTime(), b = myAt(addDays(d, 1), "00:00").getTime();
    const bookedMins = minutesIn(booked, a, b), lightsMins = minutesIn(lights, a, b), acMins = minutesIn(ac, a, b);
    const baselineKwh = kwh(bookedMins, LIGHT_KW + AC_KW);
    const actualKwh = kwh(lightsMins, LIGHT_KW) + kwh(acMins, AC_KW);
    days.push({
      day: d, bookedMins: Math.round(bookedMins), usedMins: Math.round(minutesIn(used, a, b)),
      lightsMins: Math.round(lightsMins), acMins: Math.round(acMins),
      baselineKwh: r2(baselineKwh), actualKwh: r2(actualKwh), savedKwh: r2(baselineKwh - actualKwh),
    });
  }

  const sum = (k: keyof Omit<EnergyDay, "day">) => days.reduce((s, x) => s + x[k], 0);
  const baselineKwh = r2(sum("baselineKwh")), actualKwh = r2(sum("actualKwh"));
  const savedKwh = r2(baselineKwh - actualKwh);
  const inRange = (e: EnergyEvent) => myDateKey(new Date(e.at)) >= fromDay && myDateKey(new Date(e.at)) <= toDay;
  const count = (kind: string, pred: (e: EnergyEvent) => boolean = () => true) =>
    events.filter((e) => e.kind === kind && inRange(e) && pred(e)).length;

  return {
    days,
    totals: {
      bookedMins: sum("bookedMins"), usedMins: sum("usedMins"),
      lightsMins: sum("lightsMins"), acMins: sum("acMins"),
      baselineKwh, actualKwh, savedKwh,
      savedPct: baselineKwh > 0 ? Math.round((savedKwh / baselineKwh) * 100) : 0,
      co2Kg: r2(savedKwh * CO2_KG_PER_KWH),
    },
    counts: {
      noShowsReleased: bookings.filter((b) => b.status === "cancelled" && b.cancel_reason === "no_checkin" &&
        myDateKey(new Date(b.start_time)) >= fromDay && myDateKey(new Date(b.start_time)) <= toDay).length,
      earlyReleases: count("released_early", (e) =>
        typeof e.detail === "object" && e.detail !== null && !!(e.detail as { released?: boolean }).released),
      overstays: count("overstay"),
      extensions: count("extended"),
      reminders: count("reminder"),
    },
  };
}

/** Today and the 6 days before it, as Malaysia-time date keys. */
export function lastWeek(now: Date): { fromDay: string; toDay: string } {
  const toDay = myDateKey(now);
  return { fromDay: addDays(toDay, -6), toDay };
}
