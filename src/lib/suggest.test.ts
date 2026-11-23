import { describe, it, expect } from "vitest";
import { usualHour, diversify, explainSlot, learningSummary, hourLabel, MIN_PERSONALISED } from "./suggest";
import { initBandit, update, PRIOR_THETA } from "./bandit";

// Fixture times carry an explicit +08:00 so the result is the same anywhere.
const MY = (s: string) => new Date(`${s}+08:00`);
const at = (s: string, status = "approved") => ({ start_time: MY(s).toISOString(), status });

describe("usualHour", () => {
  it("is null with too little history", () => {
    expect(usualHour([])).toBeNull();
    expect(usualHour([at("2026-08-01T14:00:00"), at("2026-08-02T14:00:00")])).toBeNull();
  });

  it("returns the most common Malaysia hour", () => {
    expect(usualHour([
      at("2026-08-01T14:00:00"), at("2026-08-02T14:30:00"), at("2026-08-03T10:00:00"),
    ])).toBe(14);
  });

  it("reads the hour in Malaysia time, not UTC", () => {
    // 07:00 +08:00 is 23:00 UTC the day before
    expect(usualHour([
      at("2026-08-01T07:00:00"), at("2026-08-02T07:00:00"), at("2026-08-03T07:15:00"),
    ])).toBe(7);
  });

  it("breaks a tie with the hour booked most recently", () => {
    expect(usualHour([
      at("2026-08-01T10:00:00"), at("2026-08-02T10:00:00"),
      at("2026-08-03T16:00:00"), at("2026-08-04T16:00:00"),
    ])).toBe(16);
  });

  it("ignores cancelled and declined bookings", () => {
    expect(usualHour([
      at("2026-08-01T09:00:00", "cancelled"), at("2026-08-02T09:00:00", "cancelled"),
      at("2026-08-03T09:00:00", "rejected"), at("2026-08-04T15:00:00"),
    ])).toBeNull();
    expect(usualHour([
      at("2026-08-01T09:00:00", "cancelled"), at("2026-08-02T09:00:00", "cancelled"),
      at("2026-08-03T15:00:00"), at("2026-08-04T15:00:00"), at("2026-08-05T11:00:00", "pending"),
    ])).toBe(15);
  });
});

describe("diversify", () => {
  const slot = (facilityId: string, start: string, mins = 60) => {
    const s = MY(start);
    return { facilityId, start: s, end: new Date(s.getTime() + mins * 60_000) };
  };

  it("drops slots that overlap a better one in the same room", () => {
    const out = diversify([
      slot("a", "2026-08-01T14:00:00"),
      slot("a", "2026-08-01T14:30:00"),
      slot("a", "2026-08-01T15:00:00"),
      slot("a", "2026-08-01T13:30:00"),
    ], 3);
    expect(out.map((s) => s.start.toISOString())).toEqual([
      MY("2026-08-01T14:00:00").toISOString(),
      MY("2026-08-01T15:00:00").toISOString(),
    ]);
  });

  it("keeps the same hour in a different room", () => {
    const out = diversify([slot("a", "2026-08-01T14:00:00"), slot("b", "2026-08-01T14:00:00")], 3);
    expect(out).toHaveLength(2);
  });

  it("keeps ranking order and stops at the limit", () => {
    const ranked = [
      slot("a", "2026-08-01T14:00:00"), slot("b", "2026-08-01T14:00:00"),
      slot("a", "2026-08-01T16:00:00"), slot("b", "2026-08-01T16:00:00"),
    ];
    expect(diversify(ranked, 3)).toEqual(ranked.slice(0, 3));
  });
});

describe("explainSlot", () => {
  const perfect = { features: [1, 1, 1, 1, 1, 1] };

  it("uses the prior weights when there is no model yet", () => {
    const f = explainSlot(perfect, null);
    expect(f).toHaveLength(5);
    expect(f[0].key).toBe("time");
    expect(f[0].weight).toBeCloseTo(PRIOR_THETA[1], 10);
    expect(f.map((x) => x.contribution)).toEqual([...f.map((x) => x.contribution)].sort((a, b) => b - a));
  });

  it("matches a fresh bandit, whose estimate is the prior", () => {
    const a = explainSlot(perfect, null);
    const b = explainSlot(perfect, initBandit());
    a.forEach((x, i) => {
      expect(b[i].key).toBe(x.key);
      expect(b[i].weight).toBeCloseTo(x.weight, 9);
    });
  });

  it("weight shares add up to 1", () => {
    const sum = explainSlot(perfect, null).reduce((s, x) => s + x.weightShare, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it("describes each feature value in plain words", () => {
    // T = 0.75 is 2 h away; C < 1; peak hour; other room; next day (A = 1/2)
    const f = explainSlot({ features: [1, 0.75, 0.6, 0.3, 0, 0.5] }, null);
    const by = Object.fromEntries(f.map((x) => [x.key, x.detail]));
    expect(by.time).toBe("2 hours from the time you want");
    expect(by.capacity).toBe("bigger than your group needs");
    expect(by.offpeak).toBe("usually a busy hour");
    expect(by.same_facility).toBe("another room of the same type");
    expect(by.day).toBe("1 day later");
  });

  it("handles the exact time, half hours and the picked day", () => {
    const by = (features: number[]) =>
      Object.fromEntries(explainSlot({ features }, null).map((x) => [x.key, x.detail]));
    expect(by([1, 1, 1, 1, 1, 1]).time).toBe("the time you want");
    expect(by([1, 1 - 0.5 / 8, 1, 1, 1, 1]).time).toBe("30 min from the time you want");
    expect(by([1, 1 - 1 / 8, 1, 1, 1, 1]).time).toBe("1 hour from the time you want");
    expect(by([1, 1, 1, 1, 1, 1]).day).toBe("the day you picked");
    expect(by([1, 1, 1, 1, 1, 1 / 3]).day).toBe("2 days later");
  });

  it("does not claim a time match when no preferred hour was known", () => {
    const f = explainSlot({ features: [1, 0.5, 1, 1, 1, 1] }, null, { hasPreferredHour: false });
    expect(f.find((x) => x.key === "time")!.detail).toBe("no usual time known yet");
  });

  it("clamps out-of-range feature values", () => {
    const f = explainSlot({ features: [1, 1.4, -0.2, 1, 1, 1] }, null);
    expect(f.find((x) => x.key === "time")!.value).toBe(1);
    expect(f.find((x) => x.key === "capacity")!.value).toBe(0);
  });
});

describe("learningSummary", () => {
  it("says defaults are in use for a new student", () => {
    for (const b of [null, initBandit()]) {
      const s = learningSummary(b);
      expect(s.personalised).toBe(false);
      expect(s.observations).toBe(0);
      expect(s.leaning).toBeNull();
      expect(s.text).toMatch(/campus defaults/);
    }
  });

  it("is not called personalised below the minimum", () => {
    let b = initBandit();
    for (let i = 0; i < MIN_PERSONALISED - 1; i++) b = update(b, [1, 1, 1, 1, 1, 1], 1);
    expect(learningSummary(b).personalised).toBe(false);
  });

  it("reports the factor the student has leaned towards", () => {
    // always takes the off-peak slot in another room, passes over the on-time peak one
    let b = initBandit();
    for (let i = 0; i < 12; i++) {
      b = update(b, [1, 1, 1, 0.3, 1, 1], 0);
      b = update(b, [1, 0.5, 1, 1, 0, 1], 1);
    }
    const s = learningSummary(b);
    expect(s.personalised).toBe(true);
    expect(s.observations).toBe(24);
    expect(s.leaning).toBe("offpeak");
    expect(s.text).toBe("Adapted from 24 suggestions you booked or skipped: you tend to pick quiet hours.");
  });

  it("names no leaning when no weight has risen clearly", () => {
    let b = initBandit();
    for (let i = 0; i < 4; i++) b = update(b, [1, 1, 1, 1, 1, 1], 0);
    const s = learningSummary(b);
    expect(s.personalised).toBe(true);
    expect(s.leaning).toBeNull();
    expect(s.text).toBe("Adapted from 4 suggestions you booked or skipped.");
  });
});

describe("hourLabel", () => {
  it("formats 12-hour labels", () => {
    expect(hourLabel(0)).toBe("12 am");
    expect(hourLabel(9)).toBe("9 am");
    expect(hourLabel(12)).toBe("12 pm");
    expect(hourLabel(14)).toBe("2 pm");
  });
});
