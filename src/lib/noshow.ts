import { myHour, myWeekday } from "./time";

/**
 * No-show prediction: for an upcoming booking, the probability p that the
 * student will not turn up.
 *
 * Used only to help, never to punish: one extra "Still coming?" reminder for
 * high-risk bookings, a risk badge (with reasons) for the room's managers, and
 * the objective 5 evaluation. Nobody is blocked, penalised or auto-cancelled,
 * and nothing is overbooked - the no-overlap constraint stays the guarantee.
 *
 * Model: logistic regression with L2, standardised features, plain batch
 * gradient descent from zero (deterministic). With little data (fewer than
 * 200 labelled bookings or 20 no-shows) it falls back to a "baseline":
 * the student's smoothed rate x how often this type of room is missed.
 *
 * No leakage. Every booking has a cutoff of start - 24 h, and all history
 * (student, room type, campus) only counts bookings that ENDED before it.
 * So a booking never sees its own outcome, and the score is the same however
 * often the database scores it in its last 24 hours.
 *
 * The SQL scorer in supabase/upgrade-noshow.sql repeats this maths exactly;
 * scripts/eval/noshow-db.ts checks they agree to 1e-6.
 */

// ------------------------------------------------------------------ constants --
export const CUTOFF_MS = 24 * 3_600_000;
/** Campus rate prior: 1 no-show in 10 bookings, before there is any data. */
export const CAMPUS_PRIOR = { k: 1, n: 10 };
/** Strength (a + b0) of the Beta priors around the campus rate. */
export const USER_STRENGTH = 5;
export const CATEGORY_STRENGTH = 10;
/** Cold start: logistic regression only with at least this much data. */
export const MIN_LABELLED = 200;
export const MIN_NOSHOWS = 20;
export const DEFAULT_THRESHOLD = 0.35;
export const DEFAULT_LAMBDA = 0.01;
/** Minutes either side of created_at in which a rec_accepted event links a booking to a suggestion. */
export const SUGGESTION_WINDOW_MIN = 5;

export const FEATURES = [
  "user_rate", "user_log_n", "first_booking", "category_rate", "lead_log_h",
  "early_morning", "evening", "weekend", "duration_h", "party_ratio",
  "needed_approval", "from_suggestion",
] as const;
export type FeatureName = (typeof FEATURES)[number];
export type Features = Record<FeatureName, number>;

// ---------------------------------------------------------------------- types --
/** One booking with what the model needs (joined from reservations, facilities, rules). */
export interface BookingRow {
  id: string;
  user_id: string;
  category_id: string;
  start_time: string;
  end_time: string;
  created_at: string;
  participants: number;
  capacity: number;
  auto_approve: boolean;
  from_suggestion: boolean;
  status: string;
  no_show: boolean;
  checked_in_at: string | null;
}

/** Raw numbers behind the features, kept for the plain-English reasons. */
export interface Raw {
  campus_rate: number;
  user_k: number; user_n: number;
  last_k: number; last_n: number;
  lead_hours: number;
  participants: number; capacity: number;
}

export interface Model {
  mode: "baseline" | "logreg";
  version: number;
  /** bias + one weight per feature (logreg); empty for the baseline. */
  weights: Partial<Record<FeatureName | "bias", number>>;
  means: Partial<Features>;
  stds: Partial<Features>;
  threshold: number;
}

export interface Example { id: string; start: number; x: Features; raw: Raw; y: 0 | 1 }

// --------------------------------------------------------------------- labels --
/** 1 = no-show, 0 = turned up, null = unknown (cancelled, rejected, or never marked). */
export function labelOf(r: Pick<BookingRow, "no_show" | "checked_in_at">): 0 | 1 | null {
  if (r.no_show) return 1;
  if (r.checked_in_at) return 0;
  return null;
}

/** Does a rec_accepted event by the same student sit within the window around created_at? */
export function fromSuggestion(userId: string, createdAt: string, events: { user_id: string | null; at: string }[]): boolean {
  const c = new Date(createdAt).getTime();
  const w = SUGGESTION_WINDOW_MIN * 60_000;
  return events.some((e) => e.user_id === userId && Math.abs(new Date(e.at).getTime() - c) <= w);
}

// -------------------------------------------------------------------- history --
interface Ev { end: number; id: string; y: 0 | 1 }
interface Series { evs: Ev[]; cum: number[] } // cum[i] = no-shows among evs[0..i-1]

export interface History { campus: Series; byUser: Map<string, Series>; byCat: Map<string, Series> }

function series(evs: Ev[]): Series {
  evs.sort((a, b) => a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const cum = [0];
  for (const e of evs) cum.push(cum[cum.length - 1] + e.y);
  return { evs, cum };
}

/** Index the labelled bookings by end time, overall, per student and per room type. */
export function buildHistory(rows: BookingRow[]): History {
  const all: Ev[] = [];
  const u = new Map<string, Ev[]>();
  const c = new Map<string, Ev[]>();
  for (const r of rows) {
    const y = labelOf(r);
    if (y === null) continue;
    const e = { end: new Date(r.end_time).getTime(), id: r.id, y };
    all.push(e);
    (u.get(r.user_id) ?? u.set(r.user_id, []).get(r.user_id)!).push(e);
    (c.get(r.category_id) ?? c.set(r.category_id, []).get(r.category_id)!).push(e);
  }
  const map = (m: Map<string, Ev[]>) => new Map([...m].map(([k, v]) => [k, series([...v])]));
  return { campus: series(all), byUser: map(u), byCat: map(c) };
}

/** How many events ended strictly before `cutoff`. */
function countBefore(s: Series | undefined, cutoff: number): number {
  if (!s) return 0;
  let lo = 0, hi = s.evs.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (s.evs[mid].end < cutoff) lo = mid + 1; else hi = mid; }
  return lo;
}

// ------------------------------------------------------------------- features --
const ln1p = (x: number) => Math.log(1 + x); // Math.log(1 + x), same as ln(1 + x) in SQL

/** The features of one booking, using only history that ended before its cutoff (start - 24 h). */
export function buildFeatures(b: BookingRow, h: History): { x: Features; raw: Raw } {
  const start = new Date(b.start_time);
  const cutoff = start.getTime() - CUTOFF_MS;

  const N = countBefore(h.campus, cutoff);
  const K = h.campus.cum[N];
  const campus = (K + CAMPUS_PRIOR.k) / (N + CAMPUS_PRIOR.n);

  const cs = h.byCat.get(b.category_id);
  const nc = countBefore(cs, cutoff);
  const kc = cs ? cs.cum[nc] : 0;
  const category = (kc + CATEGORY_STRENGTH * campus) / (nc + CATEGORY_STRENGTH);

  const us = h.byUser.get(b.user_id);
  const nu = countBefore(us, cutoff);
  const ku = us ? us.cum[nu] : 0;
  const user = (ku + USER_STRENGTH * campus) / (nu + USER_STRENGTH);
  const lastN = Math.min(4, nu);
  const lastK = us ? ku - us.cum[nu - lastN] : 0;

  const leadH = Math.max(0, start.getTime() - new Date(b.created_at).getTime()) / 3_600_000;
  const hour = myHour(start);
  const dow = myWeekday(start);
  const durH = (new Date(b.end_time).getTime() - start.getTime()) / 3_600_000;

  return {
    x: {
      user_rate: user,
      user_log_n: ln1p(nu),
      first_booking: nu === 0 ? 1 : 0,
      category_rate: category,
      lead_log_h: ln1p(leadH),
      early_morning: hour < 10 ? 1 : 0,
      evening: hour >= 18 ? 1 : 0,
      weekend: dow === 0 || dow === 6 ? 1 : 0,
      duration_h: durH,
      party_ratio: Math.min(b.participants / Math.max(1, b.capacity), 2),
      needed_approval: b.auto_approve ? 0 : 1,
      from_suggestion: b.from_suggestion ? 1 : 0,
    },
    raw: {
      campus_rate: campus, user_k: ku, user_n: nu, last_k: lastK, last_n: lastN,
      lead_hours: leadH, participants: b.participants, capacity: b.capacity,
    },
  };
}

/** Labelled examples for every booking that has finished by `nowMs`, oldest start first. */
export function buildDataset(rows: BookingRow[], nowMs: number): Example[] {
  const h = buildHistory(rows);
  const out: Example[] = [];
  for (const r of rows) {
    const y = labelOf(r);
    if (y === null || new Date(r.end_time).getTime() > nowMs) continue;
    const { x, raw } = buildFeatures(r, h);
    out.push({ id: r.id, start: new Date(r.start_time).getTime(), x, raw, y });
  }
  return out.sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
}

// ---------------------------------------------------------------------- model --
const sigmoid = (z: number) => 1 / (1 + Math.exp(-Math.max(-30, Math.min(30, z))));
const clampP = (p: number) => Math.min(0.999, Math.max(0.001, p));

/** Baseline: the student's smoothed rate x (room type rate / campus rate). */
export function baselinePredict(x: Features, raw: Raw): number {
  return clampP(x.user_rate * (x.category_rate / raw.campus_rate));
}

/** Probability of a no-show. */
export function predict(m: Model, x: Features, raw: Raw): number {
  if (m.mode === "baseline") return baselinePredict(x, raw);
  let z = m.weights.bias ?? 0;
  for (const f of FEATURES) z += (m.weights[f] ?? 0) * (x[f] - (m.means[f] ?? 0)) / (m.stds[f] ?? 1);
  return sigmoid(z);
}

export interface TrainOptions { lambda?: number; lr?: number; maxIter?: number; tol?: number }

/**
 * Logistic regression, L2 on the weights (not the bias), standardised
 * features, batch gradient descent from zero. Same data -> same model.
 */
export function train(examples: Pick<Example, "x" | "y">[], opts: TrainOptions = {}): Model & { iterations: number } {
  const { lambda = DEFAULT_LAMBDA, lr = 0.5, maxIter = 5000, tol = 1e-7 } = opts;
  const n = examples.length, d = FEATURES.length;
  const means = {} as Features, stds = {} as Features;
  FEATURES.forEach((f) => {
    const mu = n ? examples.reduce((s, e) => s + e.x[f], 0) / n : 0;
    const v = n ? examples.reduce((s, e) => s + (e.x[f] - mu) ** 2, 0) / n : 0;
    means[f] = mu;
    stds[f] = v > 1e-12 ? Math.sqrt(v) : 1; // a constant feature gets std 1 (and weight ~0)
  });
  const Z = examples.map((e) => FEATURES.map((f) => (e.x[f] - means[f]) / stds[f]));
  const w = new Array<number>(d).fill(0);
  let b = 0, it = 0;
  for (; it < maxIter && n > 0; it++) {
    const g = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * Z[i][j];
      const err = sigmoid(z) - examples[i].y;
      gb += err;
      for (let j = 0; j < d; j++) g[j] += err * Z[i][j];
    }
    let maxG = Math.abs(gb / n);
    for (let j = 0; j < d; j++) {
      g[j] = g[j] / n + lambda * w[j];
      maxG = Math.max(maxG, Math.abs(g[j]));
    }
    b -= lr * gb / n;
    for (let j = 0; j < d; j++) w[j] -= lr * g[j];
    if (maxG < tol) break;
  }
  const weights: Model["weights"] = { bias: b };
  FEATURES.forEach((f, j) => { weights[f] = w[j]; });
  return { mode: "logreg", version: 0, weights, means, stds, threshold: DEFAULT_THRESHOLD, iterations: it };
}

// -------------------------------------------------------------------- reasons --
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const round1 = (x: number) => String(Math.round(x * 10) / 10);

/** "5 hours", "3 days", "3 weeks" (rounded like the SQL scorer: floor(x + 0.5)). */
export function fmtLead(hours: number): string {
  if (hours < 48) return plural(Math.round(hours), "hour");
  const days = hours / 24;
  if (days < 14) return plural(Math.round(days), "day");
  return plural(Math.round(days / 7), "week");
}

/** Text when a feature pushes risk up from the high side (x above the mean) or the low side. */
function reasonText(f: FeatureName, high: boolean, x: Features, raw: Raw): string | null {
  switch (f) {
    case "user_rate":
      if (!high || raw.user_k === 0) return null;
      return raw.last_k > 0
        ? `Missed ${raw.last_k} of last ${plural(raw.last_n, "booking")}`
        : `Missed ${raw.user_k} of ${plural(raw.user_n, "past booking")}`;
    case "user_log_n": return high ? null : "Few past bookings";
    case "first_booking": return high ? "First booking" : null;
    case "category_rate": return high ? `Rooms of this type are often missed (${Math.round(x.category_rate * 100)}%)` : null;
    case "lead_log_h": return high ? `Booked ${fmtLead(raw.lead_hours)} ahead` : "Booked at short notice";
    case "early_morning": return high ? "Early-morning start" : null;
    case "evening": return high ? "Evening start" : null;
    case "weekend": return high ? "Weekend booking" : null;
    case "duration_h": return high ? `Long booking (${round1(x.duration_h)} h)` : "Short booking";
    case "party_ratio":
      return `${high ? "Large" : "Small"} group (${raw.participants} of ${raw.capacity} seats)`;
    case "needed_approval": return high ? "Needed manager approval" : "Instant booking";
    case "from_suggestion": return high ? "Booked from a suggestion" : null;
  }
}

/** Up to 3 plain-English reasons that pushed this booking's risk up, biggest first. */
export function explain(m: Model, x: Features, raw: Raw): string[] {
  if (m.mode === "baseline") {
    const out: string[] = [];
    const missed = reasonText("user_rate", true, x, raw);
    if (missed) out.push(missed);
    if (raw.user_n === 0) out.push("First booking");
    if (x.category_rate > raw.campus_rate) out.push(reasonText("category_rate", true, x, raw)!);
    return out.slice(0, 3);
  }
  const parts = FEATURES.map((f, i) => {
    const zi = (x[f] - (m.means[f] ?? 0)) / (m.stds[f] ?? 1);
    return { f, i, c: (m.weights[f] ?? 0) * zi, high: zi > 0 };
  })
    .filter((p) => p.c > 1e-9)
    .sort((a, b) => b.c - a.c || a.i - b.i);
  const out: string[] = [];
  for (const p of parts) {
    const t = reasonText(p.f, p.high, x, raw);
    if (t) out.push(t);
    if (out.length === 3) break;
  }
  return out;
}

export type RiskLevel = "low" | "medium" | "high";
/** Low under 0.2, high at or above the reminder threshold, medium in between. */
export function riskLevel(p: number, threshold = DEFAULT_THRESHOLD): RiskLevel {
  if (p >= threshold) return "high";
  return p < Math.min(0.2, threshold) ? "low" : "medium";
}

// -------------------------------------------------------------------- metrics --
/** Area under the ROC curve (Mann-Whitney, ties count half). Null if only one class. */
export function auc(p: number[], y: number[]): number | null {
  const idx = p.map((_, i) => i).sort((a, b) => p[a] - p[b]);
  const ranks = new Array<number>(p.length);
  for (let i = 0; i < idx.length;) {
    let j = i;
    while (j + 1 < idx.length && p[idx[j + 1]] === p[idx[i]]) j++;
    const r = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) ranks[idx[k]] = r;
    i = j + 1;
  }
  const pos = y.filter((v) => v === 1).length, neg = y.length - pos;
  if (!pos || !neg) return null;
  const sumPos = ranks.reduce((s, r, i) => s + (y[i] === 1 ? r : 0), 0);
  return (sumPos - (pos * (pos + 1)) / 2) / (pos * neg);
}

export function brier(p: number[], y: number[]): number {
  return p.length ? p.reduce((s, pi, i) => s + (pi - y[i]) ** 2, 0) / p.length : 0;
}

export function logLoss(p: number[], y: number[]): number {
  const eps = 1e-15;
  return p.length
    ? -p.reduce((s, pi, i) => {
      const q = Math.min(1 - eps, Math.max(eps, pi));
      return s + (y[i] ? Math.log(q) : Math.log(1 - q));
    }, 0) / p.length
    : 0;
}

export interface CalBin { lo: number; hi: number; n: number; mean_p: number | null; rate: number | null }
/** Calibration in equal-width bins: average predicted p vs the observed no-show rate. */
export function calibration(p: number[], y: number[], bins = 5): CalBin[] {
  return Array.from({ length: bins }, (_, b) => {
    const lo = b / bins, hi = (b + 1) / bins;
    const ii = p.map((_, i) => i).filter((i) => p[i] >= lo && (b === bins - 1 ? p[i] <= hi : p[i] < hi));
    return {
      lo, hi, n: ii.length,
      mean_p: ii.length ? ii.reduce((s, i) => s + p[i], 0) / ii.length : null,
      rate: ii.length ? ii.reduce((s, i) => s + y[i], 0) / ii.length : null,
    };
  });
}

export interface Scores { auc: number | null; brier: number; log_loss: number; calibration: CalBin[] }
export function score(p: number[], y: number[]): Scores {
  return { auc: auc(p, y), brier: brier(p, y), log_loss: logLoss(p, y), calibration: calibration(p, y) };
}

// --------------------------------------------------------- train + evaluate --
export interface EvalResult {
  mode: "baseline" | "logreg";
  /** Refit on all labelled bookings; this is what would be stored. */
  model: Model;
  n_labelled: number; n_noshow: number; n_train: number; n_test: number;
  split_at: string | null;
  lambda: number;
  /** Test-set scores (newest 20%): the model and the 3 baselines + the cold-start baseline. */
  test: { logreg: Scores | null; baseline: Scores; campus: Scores; user_rate: Scores; category: Scores };
  /** True when the logistic model beats the user-rate baseline on test AUC. */
  beats_user_rate: boolean;
}

/**
 * Time-based split (train on the oldest 80% by start time, test on the newest
 * 20%; never random), compare against three baselines, refit on everything.
 */
export function trainAndEvaluate(examples: Example[], opts: TrainOptions & { threshold?: number } = {}): EvalResult {
  const lambda = opts.lambda ?? DEFAULT_LAMBDA;
  const ex = [...examples].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));
  const n = ex.length;
  const nNo = ex.filter((e) => e.y === 1).length;
  const cut = Math.floor(n * 0.8);
  const tr = ex.slice(0, cut), te = ex.slice(cut);
  const y = te.map((e) => e.y);
  const mode: EvalResult["mode"] = n >= MIN_LABELLED && nNo >= MIN_NOSHOWS ? "logreg" : "baseline";

  const fit = tr.length && tr.some((e) => e.y === 1) && tr.some((e) => e.y === 0) ? train(tr, opts) : null;
  const logreg = fit && te.length ? score(te.map((e) => predict(fit, e.x, e.raw)), y) : null;
  const user = score(te.map((e) => e.x.user_rate), y);
  const test = {
    logreg,
    baseline: score(te.map((e) => baselinePredict(e.x, e.raw)), y),
    campus: score(te.map((e) => e.raw.campus_rate), y),
    user_rate: user,
    category: score(te.map((e) => e.x.category_rate), y),
  };
  const beats = mode === "logreg" && logreg?.auc != null && user.auc != null && logreg.auc > user.auc;

  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const model: Model = mode === "logreg"
    ? { ...train(ex, opts), threshold }
    : { mode: "baseline", version: 0, weights: {}, means: {}, stds: {}, threshold };
  delete (model as Partial<{ iterations: number }>).iterations;

  return {
    mode, model, n_labelled: n, n_noshow: nNo, n_train: tr.length, n_test: te.length,
    split_at: te.length ? new Date(te[0].start).toISOString() : null,
    lambda, test, beats_user_rate: beats,
  };
}

/**
 * Store a new model row? Logistic: only if it beats the user-rate baseline on
 * test AUC. Baseline: only to record the mode when nothing better is stored.
 */
export function shouldStore(r: EvalResult, current: { mode: string } | null): boolean {
  if (r.mode === "logreg") return r.beats_user_rate;
  return !current || current.mode === "baseline";
}
