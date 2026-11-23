import { describe, expect, it } from "vitest";
import { blockTimes, ilikeExact, needsStaffUpgrade, validReason, walkInTimes } from "./staff-booking";
import type { FormRule } from "./booking-form";

const rule: FormRule = {
  open_time: "08:00:00", close_time: "22:00:00", slot_minutes: 30,
  min_duration_mins: 30, max_duration_mins: 120, max_advance_days: 14,
};
const at = (s: string) => new Date(s);

describe("walkInTimes", () => {
  it("offers the slot that is running now, then the later ones", () => {
    const t = walkInTimes(rule, "2026-11-05", 60, at("2026-11-05T10:10:00+08:00"));
    expect(t[0]).toBe("10:00");
    expect(t[1]).toBe("10:30");
    expect(t[t.length - 1]).toBe("21:00");
  });
  it("does not add a running slot on another day", () => {
    const t = walkInTimes(rule, "2026-11-06", 60, at("2026-11-05T10:10:00+08:00"));
    expect(t[0]).toBe("08:00");
  });
  it("skips the running slot when the booking would run past closing", () => {
    expect(walkInTimes(rule, "2026-11-05", 60, at("2026-11-05T21:40:00+08:00"))).toEqual([]);
  });
  it("offers nothing before a rule is loaded", () => {
    expect(walkInTimes(null, "2026-11-05", 60, at("2026-11-05T10:10:00+08:00"))).toEqual([]);
  });
});

describe("blockTimes", () => {
  it("runs from opening to closing on the slot grid", () => {
    const t = blockTimes(rule);
    expect(t[0]).toBe("08:00");
    expect(t[1]).toBe("08:30");
    expect(t[t.length - 1]).toBe("22:00");
  });
});

describe("small checks", () => {
  it("needs a real reason", () => {
    expect(validReason("  ")).toBe(false);
    expect(validReason("ok")).toBe(false);
    expect(validReason("Maintenance")).toBe(true);
  });
  it("matches an email literally", () => {
    expect(ilikeExact(" a_b%c@x.edu ")).toBe("a\\_b\\%c@x.edu");
  });
  it("recognises a database without the upgrade", () => {
    expect(needsStaffUpgrade(null)).toBe(false);
    expect(needsStaffUpgrade({ code: "PGRST202", message: "Could not find the function" })).toBe(true);
    expect(needsStaffUpgrade({ code: "23514", message: 'violates check constraint "reservations_cancel_reason_check"' })).toBe(true);
    expect(needsStaffUpgrade({ code: "23P01", message: "That time overlaps 1 existing booking." })).toBe(false);
  });
});
