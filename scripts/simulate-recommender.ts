/**
 * Offline evaluation of the slot recommender. No participants needed.
 *
 *   npx tsx scripts/simulate-recommender.ts
 *   python scripts/plot-simulation.py          (makes the figures)
 *
 * Simulated students with a HIDDEN preference make booking requests whose
 * time is already taken. Each strategy ranks the alternatives; the student
 * reads the four cards top-down and books the first one they like (the
 * cascade model the bandit assumes). Because the preference is known to the
 * simulator, we can measure exactly how well each strategy serves each
 * student, and how fast the learning strategies adapt.
 *
 * Uses the real recommender (src/lib/recommend.ts) and bandit
 * (src/lib/bandit.ts) - nothing is re-implemented here.
 *
 * Strategies, all on the SAME requests with the SAME random draws (paired):
 *   random    - candidates in random order
 *   fixed     - the baseline score S = w1 T + w2 C + w3 U, weights never change
 *   adaptive  - baseline score with the per-student updateWeights() rule
 *   linucb    - what the app now does: adaptive pool, LinUCB ranking,
 *               cascade feedback
 *
 * Measured against an ORACLE that knows the student's preference and picks
 * the best 4 of ALL feasible slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  recommendAcross, updateWeights, DEFAULT_WEIGHTS, DEFAULT_PEAKS, type ScoredSlot,
} from "../src/lib/recommend";
import { initBandit, rankWithBandit, cascadeUpdate, type BanditState } from "../src/lib/bandit";
import { addDays, myAt } from "../src/lib/time";
import type { Facility, FacilityRule, Reservation, RecWeights } from "../src/lib/types";

// ------------------------------------------------------------- settings --
const SEED = 20261001;
const STUDENTS_PER_TYPE = 60;
const ATTEMPTS = 80;            // booking attempts per student
const SHOWN = 4;                // cards the app shows
const BUSY_PROB = 0.35;         // chance any other court-hour is already booked
const BASE_DATE = "2026-10-05";
const NOW = myAt("2026-10-05", "07:00");
const OUT = "docs/simulation";

// Feature order: [bias, T time-proximity, C capacity-fit, U off-peak, S same-court, A same-day]
// T falls 0.125 per hour away from the request, so a steep weight on T is what
// makes "one hour off" genuinely worse to a student. Calibrated so a perfect
// match is accepted ~60% of the time and a poor one 2-5%: realistic for a
// student who has just been told their time is taken.
//
// The first three types are LINEAR in the features - the model LinUCB assumes,
// so they are its best case. "exact-only" is NOT linear (a step: the asked-for
// hour or nothing), included as a robustness check where LinUCB is misspecified.
type Pref = { kind: "linear"; theta: number[] } | { kind: "step" };
const TYPES: Record<string, Pref> = {
  "time-first":  { kind: "linear", theta: [-1.20, 1.70, 0.05, 0.00, 0.00, 0.10] }, // wants the hour; any court
  "same-court":  { kind: "linear", theta: [-0.55, 0.45, 0.05, 0.00, 0.55, 0.05] }, // loyal to their court
  "quiet-hours": { kind: "linear", theta: [-0.60, 0.60, 0.05, 0.55, 0.00, 0.05] }, // avoids busy times
  "exact-only":  { kind: "step" },                                                  // that hour, any court, same day
};
const POLICIES = ["random", "fixed", "adaptive", "linucb"] as const;
type Policy = (typeof POLICIES)[number];

// ------------------------------------------------------------ fixtures --
const COURTS: Facility[] = [1, 2, 3].map((n) => ({
  id: `c${n}`, name: `Court ${n}`, category_id: "badm", category_name: "Badminton",
  type: "badminton", venue: "Sports Hall", location: "Sports Hall", capacity: 4,
  description: null, status: "active",
}));
const RULES: Record<string, FacilityRule> = Object.fromEntries(COURTS.map((c) => [c.id, {
  facility_id: c.id, category_id: "badm", category_name: "Badminton", type: "badminton",
  venue: "Sports Hall", open_time: "10:00", close_time: "22:00", slot_minutes: 60,
  min_duration_mins: 60, max_duration_mins: 120, max_advance_days: 14,
  cancellation_hours: 12, auto_approve: false, has_override: false,
}]));

// ----------------------------------------------------------------- rng --
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];

// ------------------------------------------------------- student model --
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const acceptProb = (pref: Pref, s: ScoredSlot) => {
  if (pref.kind === "step") {
    const exactHour = s.features[1] === 1, sameDay = s.features[5] === 1;
    return exactHour && sameDay ? 0.6 : 0.03;
  }
  return Math.min(0.95, Math.max(0.02, dot(pref.theta, s.features)));
};
/** P(at least one of the shown cards is booked) under the cascade model. */
const listValue = (pref: Pref, shown: ScoredSlot[]) =>
  1 - shown.reduce((q, s) => q * (1 - acceptProb(pref, s)), 1);

// ------------------------------------------------------------- request --
let rid = 0;
function makeRequest() {
  const date = addDays(BASE_DATE, Math.floor(rng() * 7));
  const hour = 10 + Math.floor(rng() * 11);          // 10:00 .. 20:00
  const requested = pick(COURTS);
  const participants = 1 + Math.floor(rng() * 4);
  const reservations: Reservation[] = [];
  const book = (c: Facility, d: string, h: number) => reservations.push({
    id: `r${rid++}`, facility_id: c.id, user_id: "x",
    start_time: myAt(d, `${h}:00`).toISOString(), end_time: myAt(d, `${h + 1}:00`).toISOString(),
    participants: 2, purpose: null, status: "approved", checked_in_at: null, no_show: false,
    created_at: NOW.toISOString(),
  });
  for (let off = 0; off <= 2; off++) {
    const d = addDays(date, off);
    for (const c of COURTS) for (let h = 10; h < 22; h++) {
      const isAsked = off === 0 && c.id === requested.id && h === hour;
      if (isAsked || rng() < BUSY_PROB) book(c, d, h);   // the asked-for slot is always taken
    }
  }
  const uniforms = Array.from({ length: SHOWN }, () => rng()); // shared across policies
  const shuffleKeys = Array.from({ length: 12 }, () => rng());
  return { date, hour, requested, participants, reservations, uniforms, shuffleKeys };
}
type Req = ReturnType<typeof makeRequest>;

function pool(req: Req, weights: RecWeights, limit = 6, perFacility = 3) {
  return recommendAcross({
    requested: req.requested, facilities: COURTS, rules: RULES, reservations: req.reservations,
    date: req.date, durationMins: 60, participants: req.participants, preferredHour: req.hour,
    weights, peaks: DEFAULT_PEAKS, now: NOW, lookAheadDays: 2, limit, perFacility,
  }).slots;
}

// ------------------------------------------------------------ simulate --
interface StudentState { weights: RecWeights; bandit: BanditState }
type Row = { type: string; student: number; attempt: number; policy: Policy;
             accepted: number; top: number; value: number; regret: number };
const rows: Row[] = [];

for (const [type, theta] of Object.entries(TYPES)) {   // "theta" = the hidden preference
  for (let s = 0; s < STUDENTS_PER_TYPE; s++) {
    const state: Record<Policy, StudentState> = Object.fromEntries(
      POLICIES.map((p) => [p, { weights: { ...DEFAULT_WEIGHTS }, bandit: initBandit() }])
    ) as Record<Policy, StudentState>;

    for (let a = 0; a < ATTEMPTS; a++) {
      const req = makeRequest();
      // oracle: best SHOWN of every feasible slot, knowing the preference
      const all = pool(req, DEFAULT_WEIGHTS, 200, 200);
      if (all.length === 0) continue;
      const oracle = [...all].sort((x, y) => acceptProb(theta, y) - acceptProb(theta, x)).slice(0, SHOWN);
      const best = listValue(theta, oracle);

      for (const p of POLICIES) {
        const st = state[p];
        let shown: ScoredSlot[];
        if (p === "random") {
          const c = pool(req, DEFAULT_WEIGHTS);
          shown = c.map((x, i) => ({ x, k: req.shuffleKeys[i] })).sort((m, n) => m.k - n.k).map((m) => m.x).slice(0, SHOWN);
        } else if (p === "fixed") {
          shown = pool(req, DEFAULT_WEIGHTS).slice(0, SHOWN);
        } else if (p === "adaptive") {
          shown = pool(req, st.weights).slice(0, SHOWN);
        } else {
          shown = rankWithBandit(pool(req, st.weights), st.bandit).slice(0, SHOWN);
        }

        // student scans top-down, books the first card they like
        let idx = -1;
        for (let i = 0; i < shown.length; i++) {
          if (req.uniforms[i] < acceptProb(theta, shown[i])) { idx = i; break; }
        }

        if (idx >= 0) {
          if (p === "adaptive" || p === "linucb")
            st.weights = updateWeights(st.weights, shown[idx], req.hour, DEFAULT_PEAKS);
          if (p === "linucb") st.bandit = cascadeUpdate(st.bandit, shown, idx);
        }
        const value = listValue(theta, shown);
        rows.push({ type, student: s, attempt: a, policy: p,
          accepted: idx >= 0 ? 1 : 0, top: idx === 0 ? 1 : 0, value, regret: best - value });
      }
    }
  }
}

// ------------------------------------------------------------- summarise --
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
function ci(perStudent: number[]) {
  const m = mean(perStudent);
  const sd = Math.sqrt(mean(perStudent.map((x) => (x - m) ** 2)) * perStudent.length / Math.max(1, perStudent.length - 1));
  return { mean: m, lo: m - 1.96 * sd / Math.sqrt(perStudent.length), hi: m + 1.96 * sd / Math.sqrt(perStudent.length) };
}
/** Average of `field` over attempts in [from, to), one number per student, then a 95% CI across students. */
function window(policy: Policy, field: "value" | "accepted" | "top" | "regret", from: number, to: number, type?: string) {
  const per = new Map<string, number[]>();
  for (const r of rows) {
    if (r.policy !== policy || r.attempt < from || r.attempt >= to || (type && r.type !== type)) continue;
    const k = `${r.type}-${r.student}`;
    (per.get(k) ?? per.set(k, []).get(k)!).push(r[field]);
  }
  return ci([...per.values()].map(mean));
}

mkdirSync(OUT, { recursive: true });

// learning curves: mean over all students at each attempt index
const curve: string[] = ["attempt,type,policy,value,accepted,top,regret"];
for (const type of ["all", ...Object.keys(TYPES)]) for (const p of POLICIES) for (let a = 0; a < ATTEMPTS; a++) {
  const rs = rows.filter((r) => r.policy === p && r.attempt === a && (type === "all" || r.type === type));
  curve.push([a + 1, type, p, mean(rs.map((r) => r.value)).toFixed(4), mean(rs.map((r) => r.accepted)).toFixed(4),
    mean(rs.map((r) => r.top)).toFixed(4), mean(rs.map((r) => r.regret)).toFixed(4)].join(","));
}
writeFileSync(`${OUT}/learning-curves.csv`, curve.join("\n"));

const LATE = [ATTEMPTS - 20, ATTEMPTS] as const;
const summary = {
  settings: { SEED, STUDENTS_PER_TYPE, ATTEMPTS, SHOWN, BUSY_PROB, types: TYPES },
  note: "value = expected probability the student books one of the shown cards; " +
        "regret = oracle value - policy value; 95% CI across students.",
  overall: Object.fromEntries(POLICIES.map((p) => [p, {
    value_first10: window(p, "value", 0, 10),
    value_last20: window(p, "value", ...LATE),
    top_card_last20: window(p, "top", ...LATE),
    regret_last20: window(p, "regret", ...LATE),
  }])),
  by_type_last20: Object.fromEntries(Object.keys(TYPES).map((t) => [t, Object.fromEntries(
    POLICIES.map((p) => [p, { value: window(p, "value", ...LATE, t), top: window(p, "top", ...LATE, t) }])
  )])),
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));

const pct = (x: number) => (100 * x).toFixed(1).padStart(5) + "%";
const fmt = (c: { mean: number; lo: number; hi: number }) => `${pct(c.mean)} [${pct(c.lo)}-${pct(c.hi)}]`;
console.log(`\n${rows.length / POLICIES.length} requests x ${POLICIES.length} strategies`);
console.log("\nP(student books a suggestion) - last 20 attempts, 95% CI across students");
for (const p of POLICIES) console.log(`  ${p.padEnd(9)} ${fmt(summary.overall[p].value_last20)}   (first 10: ${pct(summary.overall[p].value_first10.mean)})`);
console.log("\nTop card chosen - last 20 attempts");
for (const p of POLICIES) console.log(`  ${p.padEnd(9)} ${fmt(summary.overall[p].top_card_last20)}`);
console.log("\nRegret vs oracle - last 20 attempts (lower is better)");
for (const p of POLICIES) console.log(`  ${p.padEnd(9)} ${fmt(summary.overall[p].regret_last20)}`);
console.log("\nBy student type - P(books), last 20");
console.log("  " + "".padEnd(13) + POLICIES.map((p) => p.padStart(10)).join(""));
for (const t of Object.keys(TYPES))
  console.log("  " + t.padEnd(13) + POLICIES.map((p) => pct(summary.by_type_last20[t][p].value.mean).padStart(10)).join(""));
console.log(`\nwrote ${OUT}/learning-curves.csv and ${OUT}/summary.json`);
