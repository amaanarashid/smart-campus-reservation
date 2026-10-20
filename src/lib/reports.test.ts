import { describe, it, expect } from "vitest";
import { canReport, issuesByFacility, sortForInbox, validateReport, waitingFor } from "./reports";
import { myAt } from "./time";

const day = "2026-10-20";
const at = (hhmm: string) => myAt(day, hhmm).toISOString();
const T = (hhmm: string) => myAt(day, hhmm).getTime();
const booking = { status: "approved", start_time: at("14:00"), end_time: at("15:00") };

describe("validateReport", () => {
  it("needs a category and a few words", () => {
    expect(validateReport({ category: "aircon", description: "Air-con not cooling" })).toEqual({ ok: true });
    expect(validateReport({ description: "something" }).ok).toBe(false);
    expect(validateReport({ category: "made_up", description: "something" }).ok).toBe(false);
    expect(validateReport({ category: "other", description: "  hi  " }).ok).toBe(false);
    expect(validateReport({ category: "other", description: "x".repeat(1001) }).ok).toBe(false);
    expect(validateReport({ category: "other", urgency: "panic", description: "something" }).ok).toBe(false);
  });
});

describe("canReport", () => {
  it("opens 15 min before the start and closes a day after the end", () => {
    expect(canReport(booking, T("13:44"))).toBe(false);
    expect(canReport(booking, T("13:46"))).toBe(true);
    expect(canReport(booking, T("14:30"))).toBe(true);
    expect(canReport(booking, myAt("2026-10-21", "14:59").getTime())).toBe(true);
    expect(canReport(booking, myAt("2026-10-21", "15:01").getTime())).toBe(false);
  });
  it("works for bookings released for no check-in (maybe the door was broken), not for others", () => {
    expect(canReport({ ...booking, status: "cancelled", cancel_reason: "no_checkin" }, T("14:30"))).toBe(true);
    expect(canReport({ ...booking, status: "cancelled", cancel_reason: "user" }, T("14:30"))).toBe(false);
    expect(canReport({ ...booking, status: "pending" }, T("14:30"))).toBe(false);
    expect(canReport({ ...booking, status: "rejected" }, T("14:30"))).toBe(false);
  });
});

describe("issuesByFacility", () => {
  it("counts open issues per room, keeps distinct categories, flags urgent", () => {
    const m = issuesByFacility([
      { facility_id: "A", category: "aircon", urgency: "normal" },
      { facility_id: "A", category: "aircon", urgency: "urgent" },
      { facility_id: "A", category: "lighting", urgency: "low" },
      { facility_id: "B", category: "noise", urgency: "low" },
    ]);
    expect(m.A).toEqual({ count: 3, urgent: true, categories: ["aircon", "lighting"] });
    expect(m.B.urgent).toBe(false);
  });
});

describe("sortForInbox", () => {
  it("open first, urgent first, then oldest waiting; closed ones last, newest first", () => {
    const rows = [
      { id: "resolved-old", status: "resolved" as const, urgency: "urgent" as const, created_at: at("08:00") },
      { id: "open-normal-old", status: "open" as const, urgency: "normal" as const, created_at: at("09:00") },
      { id: "progress", status: "in_progress" as const, urgency: "urgent" as const, created_at: at("08:30") },
      { id: "open-urgent-new", status: "open" as const, urgency: "urgent" as const, created_at: at("11:00") },
      { id: "open-normal-new", status: "open" as const, urgency: "normal" as const, created_at: at("10:00") },
      { id: "resolved-new", status: "resolved" as const, urgency: "low" as const, created_at: at("12:00") },
    ];
    expect(sortForInbox(rows).map((r) => r.id)).toEqual([
      "open-urgent-new", "open-normal-old", "open-normal-new", "progress", "resolved-new", "resolved-old",
    ]);
  });
});

describe("waitingFor", () => {
  it("shows minutes, hours, then days", () => {
    expect(waitingFor(at("14:00"), T("14:25"))).toBe("25 min");
    expect(waitingFor(at("10:00"), T("15:30"))).toBe("5 h");
    expect(waitingFor(myAt("2026-10-17", "10:00").toISOString(), T("10:00"))).toBe("3 d");
  });
});
