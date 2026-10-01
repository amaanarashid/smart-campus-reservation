import { describe, it, expect } from "vitest";
import { checkCode, codeWindow, doorCode, openableNow, roomStatus, safeEqual, type DoorBooking } from "./room-logic";
import { myAt } from "./time";

const SECRET = "test-secret-at-least-16-chars";
const day = "2026-10-02";
const bk = (id: string, s: string, e: string, over: Partial<DoorBooking> = {}): DoorBooking => ({
  id, start_time: myAt(day, s).toISOString(), end_time: myAt(day, e).toISOString(),
  status: "approved", checked_in_at: null, ...over,
});

describe("door codes", () => {
  it("are 6 digits and the same every time for the same booking", () => {
    const c = doorCode("booking-1", SECRET);
    expect(c).toMatch(/^\d{6}$/);
    expect(doorCode("booking-1", SECRET)).toBe(c);
  });

  it("differ between bookings, and change completely with the secret", () => {
    const codes = new Set(Array.from({ length: 200 }, (_, i) => doorCode(`b-${i}`, SECRET)));
    expect(codes.size).toBeGreaterThan(195);       // collisions possible but rare
    expect(doorCode("booking-1", "another-secret-16chars")).not.toBe(doorCode("booking-1", SECRET));
  });

  it("keep leading zeros", () => {
    const withZero = Array.from({ length: 5000 }, (_, i) => doorCode(`z-${i}`, SECRET)).find((c) => c.startsWith("0"));
    expect(withZero).toMatch(/^0\d{5}$/);
  });

  it("compare in constant time without false positives", () => {
    expect(safeEqual("123456", "123456")).toBe(true);
    expect(safeEqual("123456", "123457")).toBe(false);
    expect(safeEqual("12345", "123456")).toBe(false);
  });
});

describe("when a code opens the door", () => {
  const b = bk("b1", "15:00", "16:00");
  const code = doorCode("b1", SECRET);

  it("works from 5 minutes before the start until the end", () => {
    const { from, until } = codeWindow(b);
    expect(from.toISOString()).toBe(myAt(day, "14:55").toISOString());
    expect(until.toISOString()).toBe(myAt(day, "16:00").toISOString());
    expect(checkCode(code, [b], myAt(day, "14:54"), SECRET)).toMatchObject({ ok: false, reason: "no_booking_now" });
    expect(checkCode(code, [b], myAt(day, "14:55"), SECRET)).toMatchObject({ ok: true });
    expect(checkCode(code, [b], myAt(day, "15:59"), SECRET)).toMatchObject({ ok: true });
    expect(checkCode(code, [b], myAt(day, "16:00"), SECRET)).toMatchObject({ ok: false, reason: "no_booking_now" });
  });

  it("rejects the wrong code and a malformed one", () => {
    const wrong = code === "000000" ? "111111" : "000000";
    expect(checkCode(wrong, [b], myAt(day, "15:10"), SECRET)).toMatchObject({ ok: false, reason: "wrong_code" });
    expect(checkCode("12ab", [b], myAt(day, "15:10"), SECRET)).toMatchObject({ ok: false, reason: "bad_format" });
  });

  it("does not open for a cancelled (e.g. auto-released) or pending booking", () => {
    for (const status of ["cancelled", "pending", "rejected"])
      expect(checkCode(code, [{ ...b, status }], myAt(day, "15:10"), SECRET)).toMatchObject({ ok: false, reason: "no_booking_now" });
  });

  it("reports first check-in only once", () => {
    const r1 = checkCode(code, [b], myAt(day, "15:10"), SECRET);
    const r2 = checkCode(code, [{ ...b, checked_in_at: myAt(day, "15:10").toISOString() }], myAt(day, "15:20"), SECRET);
    expect(r1).toMatchObject({ ok: true, firstCheckIn: true });
    expect(r2).toMatchObject({ ok: true, firstCheckIn: false });
  });

  it("at a changeover, each group's own code works and only theirs", () => {
    const first = bk("A", "14:00", "15:00");
    const second = bk("B", "15:00", "16:00");
    const now = myAt(day, "14:57");  // A still running, B in its early-entry window
    expect(openableNow([first, second], now).map((x) => x.id)).toEqual(["A", "B"]);
    expect(checkCode(doorCode("A", SECRET), [first, second], now, SECRET)).toMatchObject({ ok: true, booking: { id: "A" } });
    expect(checkCode(doorCode("B", SECRET), [first, second], now, SECRET)).toMatchObject({ ok: true, booking: { id: "B" } });
  });
});

describe("room status for the door display", () => {
  const b = bk("b1", "15:00", "16:00");
  const later = bk("b2", "17:00", "18:00");

  it("free, showing the next booking", () => {
    const s = roomStatus([b, later], myAt(day, "14:00"));
    expect(s.state).toBe("free");
    expect(s.next).toMatchObject({ starts_local: "3:00 pm", minutes_until: 60 });
    expect(s.display.line2).toBe("Next: 3:00 pm");
  });

  it("booked but nobody checked in yet", () => {
    const s = roomStatus([b, later], myAt(day, "15:05"));
    expect(s.state).toBe("booked");
    expect(s.current).toMatchObject({ minutes_left: 55, checked_in: false, ends_local: "4:00 pm" });
    expect(s.display.line1).toContain("enter code");
  });

  it("in use once checked in, with minutes left for reminders", () => {
    const s = roomStatus([{ ...b, checked_in_at: myAt(day, "15:02").toISOString() }], myAt(day, "15:50"));
    expect(s.state).toBe("in_use");
    expect(s.current!.minutes_left).toBe(10);
  });

  it("ignores cancelled bookings, and keeps display lines short enough for the OLED", () => {
    const s = roomStatus([{ ...b, status: "cancelled" }], myAt(day, "15:10"));
    expect(s.state).toBe("free");
    expect(s.display.line1.length).toBeLessThanOrEqual(21);
    expect(s.display.line2.length).toBeLessThanOrEqual(21);
  });
});
