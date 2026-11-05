import { describe, expect, it } from "vitest";
import {
  clampDuration, durationOptions, firstSlot, fmtDuration, nearestTime, recentFacilityIds, timeOptions, type FormRule,
} from "./booking-form";

const rule: FormRule = {
  open_time: "08:00:00", close_time: "22:00:00", slot_minutes: 30,
  min_duration_mins: 30, max_duration_mins: 120, max_advance_days: 14,
};
const at = (s: string) => new Date(s);

describe("durations", () => {
  it("offers only what the room allows, in slot steps", () => {
    expect(durationOptions(rule)).toEqual([30, 60, 90, 120]);
    expect(durationOptions({ ...rule, min_duration_mins: 60, slot_minutes: 60 })).toEqual([60, 120]);
  });
  it("moves a wanted length to the closest allowed one", () => {
    expect(clampDuration(60, { ...rule, min_duration_mins: 90 })).toBe(90);
    expect(clampDuration(300, rule)).toBe(120);
  });
  it("reads naturally", () => {
    expect(fmtDuration(30)).toBe("30 min");
    expect(fmtDuration(120)).toBe("2 h");
    expect(fmtDuration(90)).toBe("1 h 30 min");
  });
});

describe("timeOptions", () => {
  const now = at("2026-11-05T10:10:00+08:00");

  it("skips times already past today", () => {
    expect(timeOptions(rule, "2026-11-05", 60, now)[0]).toBe("10:30");
  });
  it("keeps the whole booking inside opening hours", () => {
    const opts = timeOptions(rule, "2026-11-06", 120, now);
    expect(opts[0]).toBe("08:00");
    expect(opts[opts.length - 1]).toBe("20:00");
  });
  it("is empty when nothing fits today", () => {
    expect(timeOptions(rule, "2026-11-05", 60, at("2026-11-05T21:30:00+08:00"))).toEqual([]);
  });
  it("stops at the advance-booking limit", () => {
    const short = { ...rule, max_advance_days: 1 };
    const opts = timeOptions(short, "2026-11-06", 60, now);
    expect(opts[opts.length - 1]).toBe("10:00");
    expect(timeOptions(short, "2026-11-07", 60, now)).toEqual([]);
  });
  it("is empty without a rule", () => {
    expect(timeOptions(null, "2026-11-06", 60, now)).toEqual([]);
  });
});

describe("firstSlot", () => {
  it("defaults to the soonest start today", () => {
    expect(firstSlot(rule, 60, at("2026-11-05T10:10:00+08:00"))).toEqual({ date: "2026-11-05", time: "10:30" });
  });
  it("rolls to tomorrow once today is over (Malaysia time, not UTC)", () => {
    expect(firstSlot(rule, 60, at("2026-11-05T22:30:00+08:00"))).toEqual({ date: "2026-11-06", time: "08:00" });
  });
  it("gives no time when nothing can be booked", () => {
    expect(firstSlot({ ...rule, max_advance_days: 0 }, 60, at("2026-11-05T22:30:00+08:00")))
      .toEqual({ date: "2026-11-05", time: "" });
  });
});

describe("nearestTime", () => {
  it("keeps the student's time as close as it can", () => {
    expect(nearestTime(["08:00", "15:00", "16:00"], "15:20")).toBe("15:00");
    expect(nearestTime(["08:00", "09:00"], "")).toBe("08:00");
    expect(nearestTime([], "15:00")).toBe("");
  });
});

describe("recentFacilityIds", () => {
  it("lists distinct live bookings, newest first, up to the limit", () => {
    const b = (facility_id: string, status = "approved") => ({ facility_id, status });
    expect(recentFacilityIds([b("a"), b("x", "cancelled"), b("a"), b("b", "pending"), b("c"), b("d")]))
      .toEqual(["a", "b", "c"]);
  });
});
