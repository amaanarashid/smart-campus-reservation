import { describe, it, expect } from "vitest";
import {
  BookingRow, Example, Features, FEATURES, Model,
  auc, baselinePredict, brier, buildDataset, buildFeatures, buildHistory, calibration,
  explain, fmtLead, fromSuggestion, labelOf, logLoss, predict, riskLevel, shouldStore,
  train, trainAndEvaluate,
} from "./noshow";

// Every time carries an explicit +08:00 so results do not depend on the machine's timezone.
const MY = (s: string) => `${s}+08:00`;

let seq = 0;
function row(over: Partial<BookingRow> = {}): BookingRow {
  seq++;
  return {
    id: `r${String(seq).padStart(4, "0")}`, user_id: "u1", category_id: "c1",
    start_time: MY("2026-10-20T14:00:00"), end_time: MY("2026-10-20T15:00:00"),
    created_at: MY("2026-10-19T14:00:00"),
    participants: 2, capacity: 8, auto_approve: true, from_suggestion: false,
    status: "approved", no_show: false, checked_in_at: null, ...over,
  };
}
const showed = (start: string, over: Partial<BookingRow> = {}) =>
  row({ start_time: MY(`${start}T10:00:00`), end_time: MY(`${start}T11:00:00`), created_at: MY(`${start}T08:00:00`), checked_in_at: MY(`${start}T10:01:00`), ...over });
const missed = (start: string, over: Partial<BookingRow> = {}) =>
  row({ start_time: MY(`${start}T10:00:00`), end_time: MY(`${start}T11:00:00`), created_at: MY(`${start}T08:00:00`), no_show: true, status: "cancelled", ...over });

describe("labels", () => {
  it("no-show wins, check-in means showed, anything else is unknown", () => {
    expect(labelOf({ no_show: true, checked_in_at: null })).toBe(1);
    expect(labelOf({ no_show: false, checked_in_at: MY("2026-10-20T14:01:00") })).toBe(0);
    expect(labelOf({ no_show: false, checked_in_at: null })).toBeNull();
  });
  it("links a booking to a suggestion accepted within 5 minutes", () => {
    const ev = [{ user_id: "u1", at: MY("2026-10-19T14:03:00") }];
    expect(fromSuggestion("u1", MY("2026-10-19T14:00:00"), ev)).toBe(true);
    expect(fromSuggestion("u2", MY("2026-10-19T14:00:00"), ev)).toBe(false);
    expect(fromSuggestion("u1", MY("2026-10-19T13:50:00"), ev)).toBe(false);
  });
});

describe("feature maths", () => {
  it("first booking: priors only (campus 1/10)", () => {
    const b = row({ start_time: MY("2026-10-24T07:30:00"), end_time: MY("2026-10-24T09:30:00"),
      created_at: MY("2026-10-23T07:30:00"), participants: 6, capacity: 4, auto_approve: false });
    const { x, raw } = buildFeatures(b, buildHistory([b]));
    expect(raw.campus_rate).toBeCloseTo(0.1, 12);
    expect(x.user_rate).toBeCloseTo(0.1, 12);
    expect(x.category_rate).toBeCloseTo(0.1, 12);
    expect(x.first_booking).toBe(1);
    expect(x.user_log_n).toBe(0);
    expect(x.lead_log_h).toBeCloseTo(Math.log(25), 12);   // 24 h ahead
    expect(x.early_morning).toBe(1);                       // 7:30 am Malaysia time
    expect(x.evening).toBe(0);
    expect(x.weekend).toBe(1);                             // Sat 24 Oct 2026
    expect(x.duration_h).toBe(2);
    expect(x.party_ratio).toBe(1.5);
    expect(x.needed_approval).toBe(1);
  });

  it("smoothed rates: (k + a) / (n + a + b0) around the campus rate", () => {
    const hist = [
      missed("2026-10-01"), showed("2026-10-02"), missed("2026-10-03"), showed("2026-10-05"),
      showed("2026-10-06", { user_id: "u2", category_id: "c2" }),
    ];
    const b = row({ start_time: MY("2026-10-20T19:00:00"), end_time: MY("2026-10-20T20:00:00") });
    const { x, raw } = buildFeatures(b, buildHistory([...hist, b]));
    const campus = (2 + 1) / (5 + 10);
    expect(raw.campus_rate).toBeCloseTo(campus, 12);
    expect(x.category_rate).toBeCloseTo((2 + 10 * campus) / (4 + 10), 12);
    expect(x.user_rate).toBeCloseTo((2 + 5 * campus) / (4 + 5), 12);
    expect(x.user_log_n).toBeCloseTo(Math.log(5), 12);
    expect(x.first_booking).toBe(0);
    expect(x.evening).toBe(1);
    expect(raw.last_k).toBe(2);
    expect(raw.last_n).toBe(4);
  });

  it("never leaks: only bookings that ended before start - 24 h count, never its own outcome", () => {
    const before = missed("2026-10-18");                               // ended 18 Oct 11:00
    const inside = missed("2026-10-20", { start_time: MY("2026-10-20T09:30:00"), end_time: MY("2026-10-20T10:30:00") });
    const target = missed("2026-10-21");                               // cutoff 20 Oct 10:00, its own label is 1
    const h = buildHistory([before, inside, target]);
    const { raw } = buildFeatures(target, h);
    expect(raw.user_n).toBe(1);   // only `before`; `inside` ended after the cutoff
    expect(raw.user_k).toBe(1);
    // flipping the target's own outcome changes nothing about its features
    const flipped = { ...target, no_show: false, checked_in_at: MY("2026-10-21T10:01:00") };
    expect(buildFeatures(flipped, buildHistory([before, inside, flipped])).x).toEqual(buildFeatures(target, h).x);
  });

  it("dataset: only finished, labelled bookings, oldest first", () => {
    const rows = [showed("2026-10-05"), missed("2026-10-02"), row({ status: "cancelled" }), showed("2026-11-30")];
    const ds = buildDataset(rows, new Date(MY("2026-10-31T12:00:00")).getTime());
    expect(ds.map((e) => e.y)).toEqual([1, 0]);
  });
});

// ---- a separable toy set: one feature decides everything ----
function toy(n: number): Example[] {
  const base = {} as Features;
  FEATURES.forEach((f) => { base[f] = 0; });
  return Array.from({ length: n }, (_, i) => {
    const y = (i % 3 === 0 ? 1 : 0) as 0 | 1;
    return {
      id: `t${i}`, start: i, y,
      x: { ...base, user_rate: y ? 0.6 + (i % 7) / 100 : 0.1 + (i % 5) / 100, lead_log_h: (i % 4) / 2 },
      raw: { campus_rate: 0.1, user_k: 0, user_n: 0, last_k: 0, last_n: 0, lead_hours: 1, participants: 1, capacity: 4 },
    };
  });
}

describe("training", () => {
  it("converges on a separable set and is deterministic", () => {
    const ex = toy(300);
    const m = train(ex, { lambda: 0.001 });
    const p = ex.map((e) => predict(m, e.x, e.raw));
    expect(auc(p, ex.map((e) => e.y))).toBe(1);
    expect(m.weights.user_rate!).toBeGreaterThan(2);
    expect(Math.abs(m.weights.lead_log_h!)).toBeLessThan(Math.abs(m.weights.user_rate!) / 5);
    expect(train(ex, { lambda: 0.001 }).weights).toEqual(m.weights);
  });

  it("a constant feature gets std 1 and no weight", () => {
    const m = train(toy(60));
    expect(m.stds.weekend).toBe(1);
    expect(m.weights.weekend).toBe(0);
  });

  it("stronger L2 shrinks the weights", () => {
    const loose = train(toy(120), { lambda: 0.001 }), tight = train(toy(120), { lambda: 1 });
    expect(Math.abs(tight.weights.user_rate!)).toBeLessThan(Math.abs(loose.weights.user_rate!));
  });
});

describe("metrics against hand-computed values", () => {
  it("AUC (ties count half)", () => {
    expect(auc([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1])).toBe(0.75);
    expect(auc([0.5, 0.5, 0.5, 0.5], [0, 1, 0, 1])).toBe(0.5);
    expect(auc([0.2, 0.3], [0, 0])).toBeNull();
  });
  it("Brier and log loss", () => {
    expect(brier([0.1, 0.4, 0.35, 0.8], [0, 0, 1, 1])).toBeCloseTo((0.01 + 0.16 + 0.4225 + 0.04) / 4, 12);
    expect(logLoss([0.5, 0.5], [0, 1])).toBeCloseTo(Math.log(2), 12);
    expect(logLoss([0.9, 0.2], [1, 0])).toBeCloseTo(-(Math.log(0.9) + Math.log(0.8)) / 2, 12);
  });
  it("calibration in 5 bins", () => {
    const c = calibration([0.05, 0.15, 0.3, 0.9, 1], [0, 1, 0, 1, 1]);
    expect(c.map((b) => b.n)).toEqual([2, 1, 0, 0, 2]);
    expect(c[0].mean_p).toBeCloseTo(0.1, 12);
    expect(c[0].rate).toBe(0.5);
    expect(c[2].rate).toBeNull();
    expect(c[4].mean_p).toBeCloseTo(0.95, 12);
  });
});

describe("explain", () => {
  const raw = { campus_rate: 0.1, user_k: 3, user_n: 6, last_k: 2, last_n: 4, lead_hours: 21 * 24, participants: 9, capacity: 10 };
  const x = { user_rate: 0.45, user_log_n: Math.log(7), first_booking: 0, category_rate: 0.12, lead_log_h: Math.log(1 + 504),
    early_morning: 1, evening: 0, weekend: 0, duration_h: 1, party_ratio: 0.9, needed_approval: 1, from_suggestion: 0 } as Features;
  const m: Model = {
    mode: "logreg", version: 1, threshold: 0.35,
    weights: { bias: -2, user_rate: 1.2, lead_log_h: 0.8, early_morning: 0.3, party_ratio: 0.1 },
    means: { user_rate: 0.15, lead_log_h: 3, early_morning: 0.2, party_ratio: 0.5 },
    stds: { user_rate: 0.1, lead_log_h: 1, early_morning: 0.4, party_ratio: 0.3 },
  };
  it("top 3 contributions in plain English, biggest first", () => {
    expect(explain(m, x, raw)).toEqual(["Missed 2 of last 4 bookings", "Booked 3 weeks ahead", "Early-morning start"]);
  });
  it("lead time wording", () => {
    expect(fmtLead(5)).toBe("5 hours");
    expect(fmtLead(1)).toBe("1 hour");
    expect(fmtLead(72)).toBe("3 days");
    expect(fmtLead(24 * 20)).toBe("3 weeks");
  });
  it("baseline mode explains with the student's history and the room type", () => {
    const b: Model = { mode: "baseline", version: 0, weights: {}, means: {}, stds: {}, threshold: 0.35 };
    expect(explain(b, x, raw)).toEqual(["Missed 2 of last 4 bookings", "Rooms of this type are often missed (12%)"]);
    expect(predict(b, x, raw)).toBeCloseTo(0.45 * 1.2, 12);
  });
  it("risk levels", () => {
    expect(riskLevel(0.1)).toBe("low");
    expect(riskLevel(0.25)).toBe("medium");
    expect(riskLevel(0.35)).toBe("high");
  });
});

describe("cold start and storing", () => {
  it("falls back to the baseline with too little data", () => {
    const r = trainAndEvaluate(toy(150));
    expect(r.mode).toBe("baseline");
    expect(r.model.mode).toBe("baseline");
    expect(shouldStore(r, null)).toBe(true);
    expect(shouldStore(r, { mode: "logreg" })).toBe(false);
    const t = toy(1)[0];
    expect(baselinePredict({ ...t.x, category_rate: 0.15 }, t.raw)).toBeCloseTo(0.6 * 1.5, 12);
    expect(baselinePredict({ ...t.x, category_rate: 0.3 }, t.raw)).toBe(0.999); // clamped
  });
  it("uses the logistic model with enough data and splits by time", () => {
    const r = trainAndEvaluate(toy(300));
    expect(r.mode).toBe("logreg");
    expect(r.n_train).toBe(240);
    expect(r.n_test).toBe(60);
    expect(r.split_at).toBe(new Date(240).toISOString());
    expect(r.test.logreg!.auc).toBe(1);
  });
});
