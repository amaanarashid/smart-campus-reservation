import { describe, it, expect } from "vitest";
import {
  recommendSlots, recommendAcross, learnPeakHours, updateWeights, isPeak,
  DEFAULT_WEIGHTS, DEFAULT_PEAKS, DEFAULT_PEAK_HOURS,
} from "./recommend";
import { myWholeHour } from "./time";
import { Facility, FacilityRule, Reservation } from "./types";

// All fixture times carry an explicit +08:00, so these tests give the same
// result on a Malaysian laptop, a UTC CI runner, or anywhere else.
const MY = (s: string) => new Date(`${s}+08:00`);
const hourOf = (d: Date) => myWholeHour(d);

// ---- fixtures ----
function fac(id: string, over: Partial<Facility> = {}): Facility {
  return {
    id, name: `Room ${id}`, type: "discussion_room",
    category_id: "c1", category_name: "Discussion Room",
    location: "Library", venue: "Library", capacity: 10,
    description: null, status: "active", ...over,
  };
}
function ruleFor(facility_id: string, over: Partial<FacilityRule> = {}): FacilityRule {
  return {
    facility_id, category_id: "c1", category_name: "Discussion Room",
    type: "discussion_room", venue: "Library",
    open_time: "08:00", close_time: "22:00",
    slot_minutes: 60, min_duration_mins: 30, max_duration_mins: 120,
    max_advance_days: 14, cancellation_hours: 12, auto_approve: false,
    has_override: false, ...over,
  };
}

const facility = fac("f1");
const rule = ruleFor("f1");
const NOW = MY("2026-08-01T00:00:00");
const DAY = "2026-08-01";

function res(status: Reservation["status"], start: string, end: string, facility_id = "f1"): Reservation {
  return {
    id: Math.random().toString(), facility_id, user_id: "u1",
    start_time: MY(start).toISOString(), end_time: MY(end).toISOString(),
    participants: 2, purpose: null, status, checked_in_at: null, no_show: false,
    created_at: NOW.toISOString(),
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

  it("rejects a duration shorter than the facility's minimum", () => {
    const r = recommendSlots(base({ durationMins: 15 }));
    expect(r.slots).toHaveLength(0);
    expect(r.rejectedReason).toMatch(/Minimum booking duration is 30/);
  });

  it("rejects an inactive facility", () => {
    const r = recommendSlots(base({ facility: { ...facility, status: "maintenance" } }));
    expect(r.rejectedReason).toMatch(/not available/);
  });

  it("rejects a date beyond the advance-booking window", () => {
    const r = recommendSlots(base({ date: "2026-09-01" }));
    expect(r.rejectedReason).toMatch(/14 days in advance/);
  });
});

// ---- slot generation ----
describe("recommendSlots - slot generation", () => {
  it("generates slots only within operating hours (Malaysia time)", () => {
    const r = recommendSlots(base());
    expect(r.slots.length).toBeGreaterThan(0);
    for (const s of r.slots) {
      expect(hourOf(s.start)).toBeGreaterThanOrEqual(8);
      expect(s.end.getTime()).toBeLessThanOrEqual(MY("2026-08-01T22:00:00").getTime());
    }
  });

  it("reads a Date argument as its Malaysia calendar day", () => {
    // 23:30 UTC on 31 July is 07:30 on 1 August in Malaysia
    const r = recommendSlots(base({ date: new Date("2026-07-31T23:30:00Z") }));
    expect(r.slots[0].dateKey).toBe("2026-08-01");
  });

  it("excludes slots that overlap an existing pending/approved booking", () => {
    const r = recommendSlots(base({ reservations: [res("approved", "2026-08-01T10:00:00", "2026-08-01T11:00:00")] }));
    expect(r.slots.find((s) => hourOf(s.start) === 10)).toBeUndefined();
  });

  it("ignores cancelled and rejected bookings when checking conflicts", () => {
    const r = recommendSlots(base({ reservations: [res("cancelled", "2026-08-01T10:00:00", "2026-08-01T11:00:00")] }));
    expect(r.slots.find((s) => hourOf(s.start) === 10)).toBeDefined();
  });

  it("does not generate slots in the past", () => {
    const midday = MY("2026-08-01T13:00:00");
    const r = recommendSlots(base({ now: midday }));
    for (const s of r.slots) expect(s.start.getTime()).toBeGreaterThanOrEqual(midday.getTime());
  });

  it("tags every slot with its facility, day and a 6-element feature vector", () => {
    const r = recommendSlots(base());
    for (const s of r.slots) {
      expect(s.facilityId).toBe("f1");
      expect(s.dateKey).toBe(DAY);
      expect(s.features).toHaveLength(6);
      expect(s.features[0]).toBe(1);
    }
  });
});

// ---- scoring & ranking ----
describe("recommendSlots - scoring and ranking", () => {
  it("ranks the slot closest to the preferred time first", () => {
    const r = recommendSlots(base({ preferredHour: 15 }));
    expect(hourOf(r.slots[0].start)).toBe(15);
  });

  it("returns slots sorted by descending score", () => {
    const r = recommendSlots(base({ preferredHour: 15 }));
    for (let i = 1; i < r.slots.length; i++) {
      expect(r.slots[i - 1].score).toBeGreaterThanOrEqual(r.slots[i].score);
    }
  });

  it("attaches an explanation to every suggestion (explainable AI)", () => {
    const r = recommendSlots(base({ preferredHour: 9 }));
    const nine = r.slots.find((s) => hourOf(s.start) === 9)!;
    expect(nine.reasons.length).toBeGreaterThan(0);
    expect(nine.reasons).toContain("off-peak, likely quieter");
  });

  it("scores an off-peak slot (09:00) higher than a peak slot (13:00)", () => {
    const r = recommendSlots(base());
    const nine = r.slots.find((s) => hourOf(s.start) === 9)!;
    const one = r.slots.find((s) => hourOf(s.start) === 13)!;
    expect(nine.score).toBeGreaterThan(one.score);
  });

  it("uses a supplied peak model instead of the defaults", () => {
    const eveningOnly = { hours: [20, 21], learned: true, basis: 100 };
    const r = recommendSlots(base({ peaks: eveningOnly }));
    const one = r.slots.find((s) => hourOf(s.start) === 13)!;
    expect(one.reasons).toContain("off-peak, likely quieter");
  });
});

// ---- learned peak hours ----
describe("learnPeakHours", () => {
  function evenings(n: number): Reservation[] {
    const out: Reservation[] = [];
    for (let i = 0; i < n; i++) {
      const d = String(1 + (i % 28)).padStart(2, "0");
      out.push(res("approved", `2026-07-${d}T19:00:00`, `2026-07-${d}T21:00:00`));
    }
    // a thin sprinkle of morning use so not every used hour is peak
    for (let i = 0; i < 5; i++) out.push(res("approved", `2026-07-0${i + 1}T09:00:00`, `2026-07-0${i + 1}T10:00:00`));
    return out;
  }

  it("keeps the campus defaults when history is too thin", () => {
    const p = learnPeakHours(evenings(3));
    expect(p.learned).toBe(false);
    expect(p.hours).toEqual(DEFAULT_PEAK_HOURS);
  });

  it("learns an evening peak from evening-heavy history", () => {
    const p = learnPeakHours(evenings(40));
    expect(p.learned).toBe(true);
    expect(p.hours).toContain(19);
    expect(p.hours).toContain(20);
    expect(p.hours).not.toContain(9);
    expect(p.hours).not.toContain(12);
  });

  it("ignores cancelled and rejected bookings", () => {
    const junk = Array.from({ length: 50 }, () => res("cancelled", "2026-07-10T09:00:00", "2026-07-10T10:00:00"));
    expect(learnPeakHours(junk).learned).toBe(false);
  });

  it("buckets by Malaysia hour, not the machine's hour", () => {
    const p = learnPeakHours(evenings(40));
    expect(isPeak(MY("2026-08-05T19:30:00"), p)).toBe(true);
    expect(isPeak(MY("2026-08-05T09:30:00"), p)).toBe(false);
  });
});

// ---- across facilities and days ----
describe("recommendAcross", () => {
  const f1 = fac("f1");
  const f2 = fac("f2");
  const f3 = fac("f3", { category_id: "c2", category_name: "Badminton", type: "badminton" });
  const rules = { f1: ruleFor("f1"), f2: ruleFor("f2"), f3: ruleFor("f3") };
  const common = {
    requested: f1, facilities: [f1, f2, f3], rules, date: DAY,
    durationMins: 60, participants: 2, preferredHour: 15, now: NOW,
  };

  it("offers another facility of the same category at the time asked for", () => {
    const out = recommendAcross({
      ...common,
      reservations: [res("approved", "2026-08-01T15:00:00", "2026-08-01T16:00:00", "f1")],
    });
    const f2AtThree = out.slots.find((s) => s.facilityId === "f2" && hourOf(s.start) === 15);
    expect(f2AtThree).toBeDefined();
    expect(f2AtThree!.reasons).toContain("same type of facility");
    expect(out.slots[0].facilityId).toBe("f2");  // exact time on a twin room beats the same room an hour off
  });

  it("never offers a facility from a different category", () => {
    const out = recommendAcross({ ...common, reservations: [] });
    expect(out.slots.some((s) => s.facilityId === "f3")).toBe(false);
  });

  it("checks each facility against its own rules", () => {
    const tight = { ...rules, f2: ruleFor("f2", { close_time: "12:00" }) };
    const out = recommendAcross({ ...common, rules: tight, reservations: [], limit: 50, perFacility: 50 });
    for (const s of out.slots.filter((x) => x.facilityId === "f2"))
      expect(s.end.getTime()).toBeLessThanOrEqual(MY("2026-08-01T12:00:00").getTime());
  });

  it("skips a facility too small for the group", () => {
    const small = fac("f2", { capacity: 2 });
    const out = recommendAcross({ ...common, facilities: [f1, small], participants: 6, reservations: [] });
    expect(out.slots.some((s) => s.facilityId === "f2")).toBe(false);
  });

  it("does not look ahead when the requested day has space", () => {
    const out = recommendAcross({ ...common, reservations: [] });
    expect(out.searchedDays).toEqual([DAY]);
    expect(out.usedLookAhead).toBe(false);
  });

  it("looks ahead to the next day when the requested day is full everywhere", () => {
    const full = [
      res("approved", "2026-08-01T08:00:00", "2026-08-01T22:00:00", "f1"),
      res("approved", "2026-08-01T08:00:00", "2026-08-01T22:00:00", "f2"),
    ];
    const out = recommendAcross({ ...common, reservations: full });
    expect(out.usedLookAhead).toBe(true);
    expect(out.slots[0].dateKey).toBe("2026-08-02");
    expect(out.slots[0].reasons).toContain("nearest day with space");
  });

  it("caps suggestions per facility so one cannot crowd out the rest", () => {
    const out = recommendAcross({ ...common, reservations: [], perFacility: 2, limit: 10 });
    const per = new Map<string, number>();
    for (const s of out.slots) per.set(s.facilityId, (per.get(s.facilityId) ?? 0) + 1);
    for (const n of per.values()) expect(n).toBeLessThanOrEqual(2);
  });

  it("explains the rejection when nothing at all is possible", () => {
    const out = recommendAcross({ ...common, participants: 50, reservations: [] });
    expect(out.slots).toHaveLength(0);
    expect(out.rejectedReason).toMatch(/Capacity/);
  });
});

// ---- adaptive weights ----
describe("updateWeights - adaptive learning", () => {
  it("keeps weights normalised (sum stays ~1)", () => {
    const accepted = { start: MY("2026-08-01T09:00:00"), reasons: [] };
    const w = updateWeights(DEFAULT_WEIGHTS, accepted, null);
    expect(w.time + w.capacity + w.offpeak).toBeCloseTo(1, 2);
  });

  it("shifts weight toward off-peak when an off-peak slot is accepted", () => {
    const accepted = { start: MY("2026-08-01T09:00:00"), reasons: [] };
    const w = updateWeights(DEFAULT_WEIGHTS, accepted, null);
    expect(w.offpeak).toBeGreaterThan(DEFAULT_WEIGHTS.offpeak);
  });

  it("shifts weight toward time when a slot near the preferred hour is accepted", () => {
    const accepted = { start: MY("2026-08-01T15:00:00"), reasons: [] };
    const w = updateWeights(DEFAULT_WEIGHTS, accepted, 15);
    expect(w.time).toBeGreaterThan(DEFAULT_WEIGHTS.time);
  });

  it("does not reward time when the accepted slot is far from what was asked", () => {
    const accepted = { start: MY("2026-08-01T09:00:00"), reasons: [] };
    const w = updateWeights(DEFAULT_WEIGHTS, accepted, 18);
    expect(w.time).toBeLessThan(DEFAULT_WEIGHTS.time);
  });

  it("reinforces capacity only when the slot actually fitted the group", () => {
    const without = updateWeights(DEFAULT_WEIGHTS, { start: MY("2026-08-01T13:00:00"), reasons: [] }, null);
    const withFit = updateWeights(
      DEFAULT_WEIGHTS, { start: MY("2026-08-01T13:00:00"), reasons: ["good fit for your group size"] }, null
    );
    expect(without.capacity).toBeCloseTo(DEFAULT_WEIGHTS.capacity, 3);
    expect(withFit.capacity).toBeGreaterThan(DEFAULT_WEIGHTS.capacity);
  });

  it("stays normalised and bounded over many updates", () => {
    let w = DEFAULT_WEIGHTS;
    for (let i = 0; i < 200; i++) w = updateWeights(w, { start: MY("2026-08-01T09:00:00"), reasons: [] }, null, DEFAULT_PEAKS);
    expect(w.time + w.capacity + w.offpeak).toBeCloseTo(1, 2);
    expect(w.offpeak).toBeLessThanOrEqual(1);
    expect(w.time).toBeGreaterThanOrEqual(0);
  });
});
