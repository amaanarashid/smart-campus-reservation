import type { ScoredSlot } from "./recommend";

/**
 * LinUCB contextual bandit for ranking alternative slots, one model per
 * student.
 *
 * Each candidate slot carries a context vector x = [1, T, C, U, S, A] built by
 * the recommender. The model assumes the probability a student accepts a
 * suggestion is linear in x, E[r | x] = theta . x, and ranks candidates by an
 * upper confidence bound
 *
 *     score(x) = theta_hat . x  +  alpha * sqrt( x^T A^-1 x )
 *
 * The first term is the predicted acceptance; the second is how uncertain that
 * prediction is, which is what makes the model try options it has little
 * evidence about instead of repeating itself. (Li, Chu, Langford and Schapire,
 * 2010; regret bound in Chu, Li, Reyzin and Schapire, 2011.)
 *
 * Prior. A = lambda * I and b = lambda * theta0 give theta_hat = theta0 before
 * any data, so a new student is ranked by the same hand-set weights the
 * baseline uses. As evidence arrives theta_hat moves away from theta0; lambda
 * is how many observations' worth of trust the prior gets. This is ridge
 * regression shrunk toward theta0, equivalently Bayesian linear regression
 * with a Gaussian prior centred on it - which is how cold start is handled.
 *
 * A^-1 is maintained directly with the Sherman-Morrison identity,
 *
 *     (A + x x^T)^-1 = A^-1 - (A^-1 x)(A^-1 x)^T / (1 + x^T A^-1 x)
 *
 * so no matrix is ever inverted and each update is O(d^2).
 *
 * Feedback. Students see a short ranked list and pick one. Following the
 * cascade model (Kveton, Szepesvari, Wen and Ashkan, 2015), the accepted slot
 * is a reward of 1 and every slot ranked above it - examined and passed over -
 * is a reward of 0. Slots below it were never shown to have been looked at,
 * so they teach nothing.
 */

export const DIM = 6;
export const FEATURE_NAMES = ["bias", "time", "capacity", "offpeak", "same_facility", "day_proximity"];

/**
 * Prior mean: DEFAULT_WEIGHTS (0.5, 0.3, 0.2) plus small same-facility and
 * same-day terms, all scaled by 0.5.
 *
 * The scale matters. The reward is acceptance, a 0/1 outcome, so theta . x is
 * an acceptance probability. At full scale the best possible slot predicted
 * 1.15, which is impossible, and the first rejection then forced a large
 * correction. A student sees about four options and picks one, so a prior
 * topping out near 0.5 is realistic.
 *
 * The cold-start ranking is close to the baseline, not identical. The mean
 * term follows these weights, but the exploration term alpha*sqrt(x^T A^-1 x)
 * starts as alpha*|x|/sqrt(lambda), which is larger for slots with more
 * non-zero features - e.g. a same-facility slot (S = 1). So near-ties can
 * reorder before any feedback: on the seed data, Court 1 an hour away scores
 * 0.664 and Court 2 at the exact hour 0.662. This is ordinary LinUCB
 * behaviour and fades as A accumulates observations.
 */
export const PRIOR_THETA = [0, 0.25, 0.15, 0.1, 0.025, 0.05];

export interface BanditState {
  v: 1;
  /** A^-1, DIM x DIM, row-major. */
  Ainv: number[];
  b: number[];
  /** Number of feedback observations absorbed. */
  n: number;
  alpha: number;
  lambda: number;
}

export function initBandit(opts: { prior?: number[]; lambda?: number; alpha?: number } = {}): BanditState {
  const prior = opts.prior ?? PRIOR_THETA;
  const lambda = opts.lambda ?? 4;
  const alpha = opts.alpha ?? 0.1;
  const Ainv = new Array<number>(DIM * DIM).fill(0);
  for (let i = 0; i < DIM; i++) Ainv[i * DIM + i] = 1 / lambda;
  return { v: 1, Ainv, b: prior.map((p) => lambda * p), n: 0, alpha, lambda };
}

/** Accept only a well-formed state; anything else from the database is ignored. */
export function isBanditState(x: unknown): x is BanditState {
  if (!x || typeof x !== "object") return false;
  const s = x as Partial<BanditState>;
  return (
    s.v === 1 &&
    Array.isArray(s.Ainv) && s.Ainv.length === DIM * DIM && s.Ainv.every(Number.isFinite) &&
    Array.isArray(s.b) && s.b.length === DIM && s.b.every(Number.isFinite) &&
    typeof s.n === "number" && typeof s.alpha === "number" && typeof s.lambda === "number"
  );
}

function matVec(M: number[], x: number[]): number[] {
  const out = new Array<number>(DIM).fill(0);
  for (let i = 0; i < DIM; i++) {
    let s = 0;
    for (let j = 0; j < DIM; j++) s += M[i * DIM + j] * x[j];
    out[i] = s;
  }
  return out;
}

const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

/** Current estimate theta_hat = A^-1 b. */
export function theta(s: BanditState): number[] {
  return matVec(s.Ainv, s.b);
}

export function ucb(s: BanditState, x: number[]): { mean: number; width: number; score: number } {
  const mean = dot(theta(s), x);
  const width = Math.sqrt(Math.max(0, dot(x, matVec(s.Ainv, x))));
  return { mean, width, score: mean + s.alpha * width };
}

/** Absorb one observation (x, reward) with a Sherman-Morrison update. */
export function update(s: BanditState, x: number[], reward: number): BanditState {
  const u = matVec(s.Ainv, x);             // A^-1 x   (A^-1 is symmetric)
  const denom = 1 + dot(x, u);
  const Ainv = s.Ainv.slice();
  for (let i = 0; i < DIM; i++)
    for (let j = 0; j < DIM; j++) Ainv[i * DIM + j] -= (u[i] * u[j]) / denom;
  const b = s.b.map((v, i) => v + reward * x[i]);
  return { ...s, Ainv, b, n: s.n + 1 };
}

/**
 * Cascade feedback: the accepted slot earns 1, every slot shown above it
 * earns 0.
 */
export function cascadeUpdate(s: BanditState, shown: Pick<ScoredSlot, "features">[], acceptedIndex: number): BanditState {
  let next = s;
  const last = Math.min(acceptedIndex, shown.length - 1);
  for (let i = 0; i <= last; i++) next = update(next, shown[i].features, i === acceptedIndex ? 1 : 0);
  return next;
}

/** Re-rank slots by UCB score. Returns new objects; the input is untouched. */
export function rankWithBandit(slots: ScoredSlot[], s: BanditState): ScoredSlot[] {
  return slots
    .map((slot, i) => ({ slot: { ...slot, score: Math.round(ucb(s, slot.features).score * 1000) / 1000 }, i }))
    .sort((a, b) => b.slot.score - a.slot.score || a.i - b.i)
    .map((e) => e.slot);
}

/** Rounded copy for storage, so the jsonb column stays small and readable. */
export function compactBandit(s: BanditState): BanditState {
  const r = (v: number) => Math.round(v * 1e6) / 1e6;
  return { ...s, Ainv: s.Ainv.map(r), b: s.b.map(r) };
}
