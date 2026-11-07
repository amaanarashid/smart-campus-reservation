/**
 * SIMULATED evaluation of the no-show model (objective 5), because the live
 * system does not have enough finished bookings yet.
 *
 *   npx tsx scripts/eval/noshow-simulate.ts && python scripts/plot-noshow.py
 *
 * A synthetic campus (300 students, 8 weeks) with a KNOWN no-show process:
 * habitual no-showers, long lead times, early mornings and large groups that
 * waited for approval raise the risk; booking from a suggestion lowers it a
 * little. The model is trained and evaluated exactly like the live script
 * (buildDataset -> trainAndEvaluate: time split, oldest 80% train, newest 20%
 * test, three baselines), and compared with the true probabilities as a
 * ceiling. Deterministic (fixed seed).
 * Writes docs/evaluation/noshow-sim.json. Every number in it is SIMULATED.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { BookingRow, buildDataset, predict, score, trainAndEvaluate, DEFAULT_THRESHOLD, FEATURES } from "../../src/lib/noshow";
import { myAt, addDays, myHour } from "../../src/lib/time";

const STUDENTS = 300, WEEKS = 8, SEED = 20261031;
const END = "2026-10-31";                      // the simulated "now" (00:00 Malaysia time)
const NOW = myAt(END, "00:00").getTime();
const H = 3_600_000;

let seed = SEED;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const normal = () => Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

const CATS = [
  { id: "discussion_room", capacity: 6, auto: true, effect: 0 },
  { id: "meeting_room", capacity: 12, auto: false, effect: 0.1 },
  { id: "badminton", capacity: 4, auto: true, effect: -0.1 },
  { id: "futsal", capacity: 12, auto: false, effect: 0.3 },
  { id: "event_hall", capacity: 80, auto: false, effect: -0.2 },
];

// the ground truth (the model never sees these numbers)
const TRUTH = {
  intercept: -2.6, habitual_share: 0.12, habitual_boost: 2.0, student_noise_sd: 0.4,
  per_log_lead_day: 0.45, early_morning: 0.8, evening: 0.3,
  large_group_needing_approval: 0.9, from_suggestion: -0.4, category_effects: Object.fromEntries(CATS.map((c) => [c.id, c.effect])),
};

const students = Array.from({ length: STUDENTS }, (_, i) => ({
  id: `s${String(i).padStart(3, "0")}`,
  propensity: (rand() < TRUTH.habitual_share ? TRUTH.habitual_boost : 0) + TRUTH.student_noise_sd * normal(),
  perWeek: 0.8 + rand() * 2.2,
  favourite: pick(CATS),
}));

const rows: BookingRow[] = [];
const truth = new Map<string, number>();
let n = 0;
const startDay = addDays(END, -7 * WEEKS);
for (const s of students) {
  const count = Math.round(s.perWeek * WEEKS * (0.7 + rand() * 0.6));
  for (let j = 0; j < count; j++) {
    const cat = rand() < 0.6 ? s.favourite : pick(CATS);
    const day = addDays(startDay, Math.floor(rand() * 7 * WEEKS));
    const hour = 8 + Math.floor(rand() * 14);                    // 8 am - 9 pm starts
    const start = myAt(day, `${hour}:00`);
    const dur = rand() < 0.6 ? 1 : 2;
    const r = rand();
    const leadH = r < 0.4 ? 1 + rand() * 23 : r < 0.8 ? 24 + rand() * 144 : 168 + rand() * 336;
    const pax = 1 + Math.floor(rand() * cat.capacity);
    const fromSugg = rand() < 0.3;
    const h = myHour(start);
    const z = TRUTH.intercept + s.propensity + TRUTH.per_log_lead_day * Math.log(1 + leadH / 24)
      + (h < 10 ? TRUTH.early_morning : 0) + (h >= 18 ? TRUTH.evening : 0)
      + (pax / cat.capacity > 0.75 && !cat.auto ? TRUTH.large_group_needing_approval : 0)
      + (fromSugg ? TRUTH.from_suggestion : 0) + cat.effect;
    const p = sigmoid(z);
    const miss = rand() < p;
    const id = `b${String(n++).padStart(5, "0")}`;
    truth.set(id, p);
    rows.push({
      id, user_id: s.id, category_id: cat.id,
      start_time: start.toISOString(), end_time: new Date(start.getTime() + dur * H).toISOString(),
      created_at: new Date(start.getTime() - leadH * H).toISOString(),
      participants: pax, capacity: cat.capacity, auto_approve: cat.auto, from_suggestion: fromSugg,
      status: miss ? "cancelled" : "approved", no_show: miss,
      checked_in_at: miss ? null : new Date(start.getTime() + 5 * 60_000).toISOString(),
    });
  }
}

const ds = buildDataset(rows, NOW);
const t0 = performance.now();
const res = trainAndEvaluate(ds);
const trainMs = performance.now() - t0;

// the test set again, for the ceiling (true p) and the reminder threshold
const test = ds.slice(res.n_train);
const y = test.map((e) => e.y);
const oracle = score(test.map((e) => truth.get(e.id)!), y);
// threshold check with the model fitted on the training part only (no peeking at the test set)
const trainOnly = trainAndEvaluate(ds.slice(0, res.n_train)).model;
const pTest = test.map((e) => predict(trainOnly, e.x, e.raw));
const flagged = pTest.map((p) => p >= DEFAULT_THRESHOLD);
const tp = flagged.filter((f, i) => f && y[i] === 1).length;
const nFlag = flagged.filter(Boolean).length;
const nPos = y.filter((v) => v === 1).length;

const r4 = (x: number | null) => (x === null ? null : Math.round(x * 10000) / 10000);
const out = {
  label: "SIMULATED - synthetic campus with a known no-show process, not live data",
  generated_by: "scripts/eval/noshow-simulate.ts",
  seed: SEED, students: STUDENTS, weeks: WEEKS, simulated_now: `${END}T00:00:00+08:00`,
  ground_truth: TRUTH,
  bookings: rows.length, labelled: res.n_labelled, no_shows: res.n_noshow,
  no_show_rate: r4(res.n_noshow / res.n_labelled),
  split: { method: "time-based: oldest 80% train, newest 20% test", n_train: res.n_train, n_test: res.n_test, test_from: res.split_at },
  mode: res.mode, lambda: res.lambda, train_ms: Math.round(trainMs),
  test: res.test,
  oracle_true_p: oracle,
  beats_user_rate: res.beats_user_rate,
  reminder_threshold: {
    threshold: DEFAULT_THRESHOLD,
    flagged_share: r4(nFlag / test.length),
    precision: r4(nFlag ? tp / nFlag : null),
    recall: r4(nPos ? tp / nPos : null),
    note: "Share of test bookings that would get the extra reminder, how many of those were no-shows, and how many no-shows were caught.",
  },
  weights_refit_on_all: Object.fromEntries(["bias", ...FEATURES].map((f) => [f, r4(res.model.weights[f as keyof typeof res.model.weights] ?? null)])),
};
mkdirSync("docs/evaluation", { recursive: true });
writeFileSync("docs/evaluation/noshow-sim.json", JSON.stringify(out, null, 2));

const f = (s: { auc: number | null; brier: number } | null) => s ? `AUC ${s.auc?.toFixed(3)}  Brier ${s.brier.toFixed(4)}` : "-";
console.log(`SIMULATED: ${rows.length} bookings, ${res.n_noshow} no-shows (${(100 * res.n_noshow / res.n_labelled).toFixed(1)}%), mode ${res.mode}`);
console.log(`  logistic     ${f(res.test.logreg)}`);
console.log(`  baseline     ${f(res.test.baseline)}`);
console.log(`  user rate    ${f(res.test.user_rate)}`);
console.log(`  category     ${f(res.test.category)}`);
console.log(`  campus rate  ${f(res.test.campus)}`);
console.log(`  true p       ${f(oracle)}`);
console.log(`  threshold ${DEFAULT_THRESHOLD}: flags ${(100 * nFlag / test.length).toFixed(1)}%, precision ${(100 * tp / Math.max(1, nFlag)).toFixed(1)}%, recall ${(100 * tp / Math.max(1, nPos)).toFixed(1)}%`);
console.log("wrote docs/evaluation/noshow-sim.json");
