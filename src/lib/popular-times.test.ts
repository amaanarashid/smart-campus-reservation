import { describe, it, expect } from "vitest";
import { busyLabel, popularByHour, type PopularBooking } from "./popular-times";
import { myAt } from "./time";

// 2026-10-22 is a Thursday (weekday 4) in Malaysia
const b = (fac: string, day: string, s: string, e: string, status = "approved"): PopularBooking =>
  ({ facility_id: fac, start_time: myAt(day, s).toISOString(), end_time: myAt(day, e).toISOString(), status });

describe("popularByHour", () => {
  const rows = [
    b("A", "2026-10-22", "14:00", "16:00"),          // Thu 2-4 pm
    b("B", "2026-10-22", "14:30", "15:30"),          // Thu 2:30-3:30 pm, other room
    b("A", "2026-10-15", "15:00", "16:00", "pending"),// last Thu 3-4 pm
    b("A", "2026-10-23", "14:00", "15:00"),          // Friday - ignored for Thursday
    b("A", "2026-10-22", "09:00", "10:00", "cancelled"),
  ];

  it("counts bookings covering each hour of the weekday, in Malaysia time, across rooms", () => {
    const c = popularByHour(rows, 4, 8, 18);
    expect(c[14 - 8]).toBe(2);   // 2-3 pm: A and B
    expect(c[15 - 8]).toBe(3);   // 3-4 pm: A, B (till 3:30), last week's A
    expect(c[9 - 8]).toBe(0);    // cancelled ignored
    expect(c.length).toBe(10);
  });

  it("can focus on one room", () => {
    expect(popularByHour(rows, 4, 8, 18, ["B"])[15 - 8]).toBe(1);
    expect(popularByHour(rows, 5, 8, 18, ["A"])[14 - 8]).toBe(1);   // Friday
  });

  it("labels busyness", () => {
    expect(busyLabel(0)).toBe("Usually not busy");
    expect(busyLabel(1)).toBe("As busy as it gets");
  });
});
