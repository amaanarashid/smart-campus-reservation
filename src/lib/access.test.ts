import { describe, it, expect } from "vitest";
import { canBook, accessLabel, accessMessage, limitsLabel, limitProblem, weekStart } from "./access";

const iso = (s: string) => new Date(s).toISOString();
const NOW = new Date("2026-10-21T09:00:00+08:00"); // Wednesday

describe("who can book", () => {
  it("defaults to everyone", () => {
    expect(canBook(null, "undergraduate")).toBe(true);
    expect(canBook({ allowed_members: [] }, undefined)).toBe(true);
    expect(accessLabel({})).toBeNull();
  });
  it("respects a staff-only type", () => {
    const r = { allowed_members: ["staff" as const] };
    expect(canBook(r, "undergraduate")).toBe(false);
    expect(canBook(r, "staff")).toBe(true);
    expect(accessLabel(r)).toBe("Staff only");
    expect(accessMessage("Meeting Room", r)).toBe("Meeting Room can only be booked by staff.");
    expect(accessLabel({ allowed_members: ["staff", "postgraduate"] })).toBe("Postgraduates and staff");
  });
});

describe("fair-use limits", () => {
  it("summarises limits", () => {
    expect(limitsLabel({})).toBeNull();
    expect(limitsLabel({ max_upcoming: 2, max_hours_week: 4 })).toBe("max 2 upcoming · 4 h/week");
  });
  it("weeks run Monday to Sunday in Malaysia time", () => {
    expect(weekStart(NOW).toISOString()).toBe(iso("2026-10-19T00:00:00+08:00"));
    expect(weekStart(new Date("2026-10-25T23:30:00+08:00")).toISOString()).toBe(iso("2026-10-19T00:00:00+08:00"));
    expect(weekStart(new Date("2026-10-26T00:10:00+08:00")).toISOString()).toBe(iso("2026-10-26T00:00:00+08:00"));
  });
  it("counts upcoming bookings of the same type only", () => {
    const mine = [
      { start_time: iso("2026-10-22T10:00:00+08:00"), end_time: iso("2026-10-22T11:00:00+08:00"), status: "approved", sameType: true },
      { start_time: iso("2026-10-22T12:00:00+08:00"), end_time: iso("2026-10-22T13:00:00+08:00"), status: "approved", sameType: false },
      { start_time: iso("2026-10-23T12:00:00+08:00"), end_time: iso("2026-10-23T13:00:00+08:00"), status: "cancelled", sameType: true },
    ];
    const s = new Date("2026-10-24T10:00:00+08:00"), e = new Date("2026-10-24T11:00:00+08:00");
    expect(limitProblem("Squash", { max_upcoming: 1 }, mine, s, e, NOW)).toBe("You already have 1 upcoming Squash booking. The limit is 1.");
    expect(limitProblem("Squash", { max_upcoming: 2 }, mine, s, e, NOW)).toBeNull();
  });
  it("adds up hours within the week", () => {
    const mine = [{ start_time: iso("2026-10-20T10:00:00+08:00"), end_time: iso("2026-10-20T11:30:00+08:00"), status: "pending", sameType: true }];
    const sameWeek = [new Date("2026-10-23T10:00:00+08:00"), new Date("2026-10-23T11:00:00+08:00")] as const;
    const nextWeek = [new Date("2026-10-27T10:00:00+08:00"), new Date("2026-10-27T11:00:00+08:00")] as const;
    expect(limitProblem("Studio", { max_hours_week: 2 }, mine, ...sameWeek, NOW)).toBe("Weekly limit for Studio is 2.0 h. You already have 1.5 h booked that week.");
    expect(limitProblem("Studio", { max_hours_week: 2.5 }, mine, ...sameWeek, NOW)).toBeNull();
    expect(limitProblem("Studio", { max_hours_week: 2 }, mine, ...nextWeek, NOW)).toBeNull();
  });
});
