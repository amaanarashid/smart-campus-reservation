import { describe, it, expect } from "vitest";
import { twinReading, type TwinBooking, type TwinEvent } from "./twin-state";
import { myAt } from "./time";

const day = "2026-10-12";
const at = (hhmm: string, s = 0) => new Date(myAt(day, hhmm).getTime() + s * 1000).toISOString();
const ev = (hhmm: string, kind: string, s = 0): TwinEvent => ({ at: at(hhmm, s), kind });
const booking = (over: Partial<TwinBooking> = {}): TwinBooking =>
  ({ start_time: at("15:00"), end_time: at("16:00"), status: "approved", checked_in_at: null, ...over });
const base = { facilityActive: true, hasDevice: true, lastSeenAt: at("15:29"), now: new Date(at("15:30")) };

describe("twin reading from a device", () => {
  it("takes each output from its latest on/off event (events newest first)", () => {
    const events = [ev("15:20", "lights_off"), ev("15:10", "ac_on"), ev("15:05", "lights_on"), ev("15:05", "presence_on")];
    const r = twinReading({ ...base, events, bookings: [] });
    expect(r).toMatchObject({ source: "device", lights: false, ac: true, people: true, doorOpen: false, online: true });
  });

  it("status follows the booking: free, booked (waiting for check-in), in use", () => {
    expect(twinReading({ ...base, events: [], bookings: [] }).status).toBe("free");
    expect(twinReading({ ...base, events: [], bookings: [booking()] }).status).toBe("booked");
    expect(twinReading({ ...base, events: [], bookings: [booking({ checked_in_at: at("15:02") })] }).status).toBe("in_use");
    expect(twinReading({ ...base, events: [], bookings: [booking({ status: "cancelled" })] }).status).toBe("free");
  });

  it("shows the lock open just after a good code, until the door is shut", () => {
    const now = new Date(at("15:30", 5));
    expect(twinReading({ ...base, now, events: [ev("15:30", "unlock_ok")], bookings: [] }).unlocked).toBe(true);
    expect(twinReading({ ...base, now, events: [ev("15:30", "door_closed", 3), ev("15:30", "unlock_ok")], bookings: [] }).unlocked).toBe(false);
    expect(twinReading({ ...base, now: new Date(at("15:31")), events: [ev("15:30", "unlock_ok")], bookings: [] }).unlocked).toBe(false);
  });

  it("is offline when the device has not been heard from for 2 minutes", () => {
    expect(twinReading({ ...base, lastSeenAt: at("15:27"), events: [], bookings: [] }).online).toBe(false);
  });

  it("an offline-for-maintenance facility shows as inactive", () => {
    expect(twinReading({ ...base, facilityActive: false, events: [], bookings: [booking()] }).status).toBe("inactive");
  });
});

describe("twin reading without a device", () => {
  it("infers from the booking and says so", () => {
    const r = twinReading({ ...base, hasDevice: false, events: [], bookings: [booking({ checked_in_at: at("15:02") })] });
    expect(r).toMatchObject({ source: "bookings", people: true, lights: true, ac: true, online: false, status: "in_use" });
    const idle = twinReading({ ...base, hasDevice: false, events: [], bookings: [] });
    expect(idle).toMatchObject({ people: false, lights: false, ac: false, status: "free" });
  });
});
