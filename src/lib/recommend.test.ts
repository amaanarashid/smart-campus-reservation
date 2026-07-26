import { describe, it, expect } from "vitest";
import { recommendSlots, updateWeights, DEFAULT_WEIGHTS, ScoredSlot } from "./recommend";
import { Facility, FacilityRule, Reservation } from "./types";

// ---- fixtures ----
const facility: Facility = {
  id: "f1", name: "Discussion Room A", type: "discussion_room",
  location: "Library", venue: "Library", capacity: 10,
  description: null, manager_id: null, status: "active",
};

const rule: FacilityRule = {
  id: "r1", facility_id: "f1", open_time: "08:00", close_time: "22:00",
  slot_minutes: 60, min_duration_mins: 30, max_duration_mins: 120,
  max_advance_days: 14, cancellation_hours: 12, auto_approve: false,
  allowed_roles: ["student", "facility_manager", "admin"],
};

const NOW = new Date("2026-08-01T00:00:00");
const DAY = new Date("2026-08-01T00:00:00");

function res(status: Reservation["status"], start: string, end: string): Reservation {
  return {
    id: Math.random().toString(), facility_id: "f1", user_id: "u1",
    start_time: start, end_time: end, participants: 2, purpose: null,
    status, checked_in_at: null, no_show: false, created_at: NOW.toISOString(),
  };
}

function base(over: Partial<Parameters<typeof recommendSlots>[0]> = {}) {
  return {
    facility, rule, reservations: [] as Reservation[], date: DAY,
    durationMins: 60, participants: 2, preferredHour: null as number | null,
    now: NOW, ...over,
  };
}

// ---- rule enforcement ----
describe("recommendSlots - rule enforcement", () => {
  it("rejects when the group exceeds capacity", () => {
    const r = recommendSlots(base({ participants: 20 }));
    expect(r.slots).toHaveLength(0);
    expect(r.rejectedReason).toMatch(/Capacity is 10/);
  });

  it("rejects a duration longer than the facility's maximum", () => {
    const r = recommendSlots(base({ durationMins: 180 }));
    expect(r.rejectedReason).toMatch(/Maximum booking duration is 120/);
  });

  it("rejects an inactive facility", () => {
    const r = recommendSlots(base({ facility: { ...facility, status: "maintenance" } }));
    expect(r.rejectedReason).toMatch(/not available/);
  });

  it("rejects a date beyond the advance-booking window", () => {
    const r = recommendSlots(base({ date: new Date("2026-09-01T00:00:00") }));
    expect(r.rejectedReason).toMatch(/14 days in advance/);
  });
});

// ---- slot generation ----
describe("recommendSlots - slot generation", () => {
  it("generates slots only within operating hours", () => {
    const r = recommendSlots(base());
    expect(r.slots.length).toBeGreaterThan(0);
    for (const s of r.slots) {
      expect(s.start.getHours()).toBeGreaterThanOrEqual(8);
      expect(s.end.getTime()).toBeLessThanOrEqual(new Date("2026-08-01T22:00:00").getTime());
    }
  });

  it("excludes slots that overlap an existing pending/approved booking", () => {
    const r = recommendSlots(base({ reservations: [res("approved", "2026-08-01T10:00:00", "2026-08-01T11:00:00")] }));
    expect(r.slots.find((s) => s.start.getHours() === 10)).toBeUndefined();
  });

  it("ignores cancelled and rejected bookings when checking conflicts", () => {
    const r = recommendSlots(base({ reservations: [res("cancelled", "2026-08-01T10:00:00", "2026-08-01T11:00:00")] }));
    expect(r.slots.find((s) => s.start.getHours() === 10)).toBeDefined();
  });

  it("does not generate slots in the past", () => {
    const midday = new Date("2026-08-01T13:00:00");
    const r = recommendSlots(base({ now: midday }));
    for (const s of r.slots) expect(s.start.getTime()).toBeGreaterThanOrEqual(midday.getTime());
  });
});

// ---- scoring & ranking ----
describe("recommendSlots - scoring and ranking", () => {
  it("ranks the slot closest to the preferred time first", () => {
    const r = recommendSlots(base({ preferredHour: 15 }));
    expect(r.slots[0].start.getHours()).toBe(15);
  });

  it("returns slots sorted by descending score", () => {
    const r = recommendSlots(base({ preferredHour: 15 }));
    for (let i = 1; i < r.slots.length; i++) {
      expect(r.slots[i - 1].score).toBeGreaterThanOrEqual(r.slots[i].score);
    }
  });

  it("attaches an explanation to every suggestion (explainable AI)", () => {
    const r = recommendSlots(base({ preferredHour: 9 }));
    const nine = r.slots.find((s) => s.start.getHours() === 9)!;
    expect(nine.reasons.length).toBeGreaterThan(0);
    expect(nine.reasons).toContain("off-peak, likely quieter");
  });

  it("scores an off-peak slot (09:00) higher than a peak slot (13:00)", () => {
    const r = recommendSlots(base());
    const nine = r.slots.find((s) => s.start.getHours() === 9)!;
    const one = r.slots.find((s) => s.start.getHours() === 13)!;
    expect(nine.score).toBeGreaterThan(one.score);
  });
});

// ---- adaptive weights ----
describe("updateWeights - adaptive learning", () => {
  it("keeps weights normalised (sum stays ~1)", () => {
    const accepted: ScoredSlot = {
      start: new Date("2026-08-01T09:00:00"), end: new Date("2026-08-01T10:00:00"),
      score: 1, reasons: [],
    };
    const w = updateWeights(DEFAULT_WEIGHTS, accepted, null);
    expect(w.time + w.capacity + w.offpeak).toBeCloseTo(1, 2);
  });

  it("shifts weight toward off-peak when an off-peak slot is accepted", () => {
    const accepted: ScoredSlot = {
      start: new Date("2026-08-01T09:00:00"), end: new Date("2026-08-01T10:00:00"),
      score: 1, reasons: [],
    };
    const w = updateWeights(DEFAULT_WEIGHTS, accepted, null);
    expect(w.offpeak).toBeGreaterThan(DEFAULT_WEIGHTS.offpeak);
  });

  it("shifts weight toward time when a slot near the preferred hour is accepted", () => {
    const accepted: ScoredSlot = {
      start: new Date("2026-08-01T15:00:00"), end: new Date("2026-08-01T16:00:00"),
      score: 1, reasons: [],
    };
    const w = updateWeights(DEFAULT_WEIGHTS, accepted, 15);
    expect(w.time).toBeGreaterThan(DEFAULT_WEIGHTS.time);
  });
});
