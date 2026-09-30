import { describe, it, expect } from "vitest";
import { addDays, daysBetween, fmtDay, fmtRelativeDay, fmtTime, myAt, myDateKey, myHour, myWeekday } from "./time";

describe("Malaysia time helpers", () => {
  it("gives the Malaysia date, not the UTC date, in the early morning", () => {
    // 01:00 on 2 Oct in Malaysia is still 1 Oct in UTC
    const d = new Date("2026-10-01T17:00:00Z");
    expect(d.toISOString().slice(0, 10)).toBe("2026-10-01");   // the old bug
    expect(myDateKey(d)).toBe("2026-10-02");                    // the fix
  });

  it("builds an instant from Malaysia wall-clock time", () => {
    expect(myAt("2026-10-02", "15:00").toISOString()).toBe("2026-10-02T07:00:00.000Z");
    expect(myAt("2026-10-02", "08:30:00".slice(0, 5)).toISOString()).toBe("2026-10-02T00:30:00.000Z");
  });

  it("reads hours and weekdays in Malaysia time", () => {
    const d = myAt("2026-10-02", "15:30");
    expect(myHour(d)).toBe(15.5);
    expect(myWeekday(d)).toBe(5); // Friday
  });

  it("adds days across month and year ends", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-30", "2026-11-02")).toBe(3);
  });

  it("formats times and days for people", () => {
    expect(fmtTime(myAt("2026-10-02", "15:00"))).toBe("3:00 pm");
    expect(fmtTime(myAt("2026-10-02", "00:15"))).toBe("12:15 am");
    expect(fmtTime(myAt("2026-10-02", "12:00"))).toBe("12:00 pm");
    expect(fmtDay("2026-10-02")).toBe("Fri 2 Oct");
    const now = myAt("2026-10-02", "09:00");
    expect(fmtRelativeDay("2026-10-02", now)).toBe("today");
    expect(fmtRelativeDay("2026-10-03", now)).toBe("tomorrow");
    expect(fmtRelativeDay("2026-10-05", now)).toBe("Mon 5 Oct");
  });
});
