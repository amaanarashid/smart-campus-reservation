import { describe, it, expect } from "vitest";
import {
  initBandit, theta, ucb, update, cascadeUpdate, rankWithBandit, isBanditState,
  compactBandit, DIM, PRIOR_THETA,
} from "./bandit";
import type { ScoredSlot } from "./recommend";

/** Direct Gauss-Jordan inverse, to check Sherman-Morrison against. */
function invert(M: number[]): number[] {
  const n = DIM;
  const a = M.slice();
  const inv: number[] = Array.from({ length: n * n }, (_, k) => (Math.floor(k / n) === k % n ? 1 : 0));
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(a[r * n + c]) > Math.abs(a[p * n + c])) p = r;
    for (let k = 0; k < n; k++) {
      [a[c * n + k], a[p * n + k]] = [a[p * n + k], a[c * n + k]];
      [inv[c * n + k], inv[p * n + k]] = [inv[p * n + k], inv[c * n + k]];
    }
    const d = a[c * n + c];
    for (let k = 0; k < n; k++) { a[c * n + k] /= d; inv[c * n + k] /= d; }
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = a[r * n + c];
      for (let k = 0; k < n; k++) { a[r * n + k] -= f * a[c * n + k]; inv[r * n + k] -= f * inv[c * n + k]; }
    }
  }
  return inv;
}

const x1 = [1, 1, 0.64, 1, 1, 1];
const x2 = [1, 0.5, 0.64, 0.3, 0, 0.5];

function slot(features: number[], id: string): ScoredSlot {
  return {
    start: new Date(0), end: new Date(0), score: 0, reasons: [],
    facilityId: id, facilityName: id, dateKey: "2026-10-02", features,
  };
}

describe("LinUCB bandit", () => {
  it("starts exactly at the prior, so a new student gets the baseline weights", () => {
    const t = theta(initBandit());
    t.forEach((v, i) => expect(v).toBeCloseTo(PRIOR_THETA[i], 10));
  });

  it("Sherman-Morrison update matches a direct matrix inverse", () => {
    const lambda = 4;
    let s = initBandit({ lambda });
    const xs = [x1, x2, x1, [1, 0.2, 1, 1, 0, 0.33]];
    const A = Array.from({ length: DIM * DIM }, (_, k) => (Math.floor(k / DIM) === k % DIM ? lambda : 0));
    for (const x of xs) {
      s = update(s, x, 1);
      for (let i = 0; i < DIM; i++) for (let j = 0; j < DIM; j++) A[i * DIM + j] += x[i] * x[j];
    }
    const direct = invert(A);
    s.Ainv.forEach((v, k) => expect(v).toBeCloseTo(direct[k], 9));
  });

  it("raises the predicted value of a context that keeps being accepted", () => {
    let s = initBandit();
    const before = ucb(s, x2).mean;
    for (let i = 0; i < 10; i++) s = update(s, x2, 1);
    expect(ucb(s, x2).mean).toBeGreaterThan(before);
  });

  it("shrinks uncertainty about a context it has seen", () => {
    let s = initBandit();
    const w0 = ucb(s, x1).width;
    for (let i = 0; i < 5; i++) s = update(s, x1, 1);
    expect(ucb(s, x1).width).toBeLessThan(w0);
  });

  it("cascade feedback: moves the accepted slot up relative to the ones passed over", () => {
    // Note: the accepted slot's own predicted value can fall. x1 and x2 share
    // features, so a firm "no" on x1 lowers similar contexts too - that is
    // ridge regression working correctly. What cascade feedback promises is a
    // relative shift, so that is what is tested.
    const s0 = initBandit();
    const shown = [slot(x1, "a"), slot(x2, "b"), slot(x1, "c")];
    const s1 = cascadeUpdate(s0, shown, 1);
    expect(s1.n).toBe(2);                     // ranks 0 and 1 only; rank 2 teaches nothing
    const gap = (s: ReturnType<typeof initBandit>) => ucb(s, x2).mean - ucb(s, x1).mean;
    expect(gap(s1)).toBeGreaterThan(gap(s0));
  });

  it("keeps cold-start predictions inside the range of a probability", () => {
    const s = initBandit();
    for (const x of [x1, x2, [1, 1, 1, 1, 1, 1]]) {
      const m = ucb(s, x).mean;
      expect(m).toBeGreaterThanOrEqual(0);
      expect(m).toBeLessThanOrEqual(1);
    }
  });

  it("with repeated consistent feedback, learns to prefer what the student picks", () => {
    let s = initBandit();
    // this student always skips same-facility x1 and takes the other-facility x2
    for (let i = 0; i < 15; i++) s = cascadeUpdate(s, [slot(x1, "a"), slot(x2, "b")], 1);
    const ranked = rankWithBandit([slot(x1, "a"), slot(x2, "b")], s);
    expect(ranked[0].facilityId).toBe("b");
  });

  it("re-ranks by UCB score without mutating its input", () => {
    let s = initBandit();
    for (let i = 0; i < 20; i++) s = update(s, x2, 1);
    for (let i = 0; i < 20; i++) s = update(s, x1, 0);
    const input = [slot(x1, "a"), slot(x2, "b")];
    const ranked = rankWithBandit(input, s);
    expect(ranked[0].facilityId).toBe("b");
    expect(input[0].score).toBe(0);
  });

  it("round-trips through storage and rejects malformed state", () => {
    const s = compactBandit(update(initBandit(), x1, 1));
    expect(isBanditState(JSON.parse(JSON.stringify(s)))).toBe(true);
    expect(isBanditState(null)).toBe(false);
    expect(isBanditState({ v: 1, Ainv: [1, 2], b: [], n: 0, alpha: 0.1, lambda: 4 })).toBe(false);
    expect(isBanditState({ ...s, b: [...s.b.slice(0, 5), Number.NaN] })).toBe(false);
  });
});
