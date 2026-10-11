import { describe, it, expect } from "vitest";
import {
  AC_KW, LIGHT_KW, bookedIntervals, energyReport, minutesIn, onIntervals, type EnergyBooking, type EnergyEvent,
} from "./energy";
import { myAt } from "./time";

const day = "2026-10-12";
const at = (hhmm: string) => myAt(day, hhmm).toISOString();
const ev = (hhmm: string, kind: string, reservation_id: string | null = null, detail: unknown = null): EnergyEvent =>
  ({ at: at(hhmm), kind, reservation_id, detail });
const bk = (id: string, s: string, e: string, over: Partial<EnergyBooking> = {}): EnergyBooking =>
  ({ id, start_time: at(s), end_time: at(e), status: "approved", checked_in_at: at(s), ...over });
const T = (hhmm: string) => myAt(day, hhmm).getTime();

describe("on-intervals", () => {
  it("pairs on/off events, ignores repeats, closes an open interval at `until`", () => {
    const evs = [ev("10:00", "lights_on"), ev("10:05", "lights_on"), ev("10:30", "lights_off"), ev("11:00", "lights_on")];
    expect(onIntervals(evs, "lights_on", "lights_off", T("11:15"))).toEqual([[T("10:00"), T("10:30")], [T("11:00"), T("11:15")]]);
  });
  it("handles unsorted input and an off with no on", () => {
    const evs = [ev("10:30", "ac_off"), ev("10:00", "ac_on"), ev("09:00", "ac_off")];
    expect(onIntervals(evs, "ac_on", "ac_off", T("12:00"))).toEqual([[T("10:00"), T("10:30")]]);
  });
  it("clips minutes to a window", () => {
    expect(minutesIn([[T("09:30"), T("10:30")]], T("10:00"), T("11:00"))).toBe(30);
  });
});

describe("booked time (the conventional-room baseline)", () => {
  it("counts approved bookings and released no-shows, not user cancellations", () => {
    const b = [
      bk("A", "10:00", "11:00"),
      bk("N", "12:00", "13:00", { status: "cancelled", cancel_reason: "no_checkin", checked_in_at: null }),
      bk("C", "14:00", "15:00", { status: "cancelled", cancel_reason: "user" }),
    ];
    expect(bookedIntervals(b, []).length).toBe(2);
  });
  it("adds back the minutes an early release gave away", () => {
    const b = [bk("E", "10:00", "10:20")];   // was 10:00-11:00, released 40 min early
    const evs = [ev("10:20", "released_early", "E", { released: true, freed_mins: 40 })];
    expect(bookedIntervals(b, evs)).toEqual([[T("10:00"), T("11:00")]]);
  });
});

describe("energy report", () => {
  it("baseline runs lights + AC for every booked minute; actual uses the device's on-time", () => {
    // one 2 h booking; AC pre-cools 5 min, people leave after 1 h, lights follow presence
    const bookings = [bk("A", "10:00", "12:00")];
    const events = [
      ev("09:55", "ac_on"), ev("10:00", "presence_on", "A"), ev("10:00", "lights_on", "A"),
      ev("11:00", "presence_off", "A"), ev("11:00", "lights_off", "A"), ev("11:00", "ac_off", "A"),
    ];
    const r = energyReport(events, bookings, day, day, new Date(T("23:00")));
    const d = r.days[0];
    expect(d.bookedMins).toBe(120);
    expect(d.lightsMins).toBe(60);
    expect(d.acMins).toBe(65);
    expect(d.baselineKwh).toBeCloseTo(2 * (LIGHT_KW + AC_KW), 2);
    expect(d.actualKwh).toBeCloseTo(1 * LIGHT_KW + (65 / 60) * AC_KW, 2);
    expect(r.totals.savedKwh).toBeCloseTo(d.baselineKwh - d.actualKwh, 2);
    expect(r.totals.savedPct).toBeGreaterThan(40);
  });

  it("a no-show costs nothing in the smart room but a full slot in the baseline", () => {
    const b = [bk("N", "14:00", "15:00", { status: "cancelled", cancel_reason: "no_checkin", checked_in_at: null })];
    const r = energyReport([], b, day, day, new Date(T("23:00")));
    expect(r.totals.actualKwh).toBe(0);
    expect(r.totals.baselineKwh).toBeCloseTo(LIGHT_KW + AC_KW, 2);
    expect(r.counts.noShowsReleased).toBe(1);
  });

  it("splits by Malaysia day and counts room events", () => {
    const next = "2026-10-13";
    const events = [
      ev("23:30", "lights_on"), { at: myAt(next, "00:30").toISOString(), kind: "lights_off", reservation_id: null },
      ev("15:00", "overstay", "A"), ev("14:00", "extended", "A"), ev("13:50", "reminder", "A"),
    ];
    const r = energyReport(events, [], day, next, new Date(myAt(next, "12:00")));
    expect(r.days.map((d) => d.lightsMins)).toEqual([30, 30]);
    expect(r.counts).toMatchObject({ overstays: 1, extensions: 1, reminders: 1 });
    expect(r.totals.acMins).toBe(0);
    expect(AC_KW).toBeGreaterThan(LIGHT_KW);
  });
});
