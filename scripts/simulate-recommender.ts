/**
 * Offline evaluation of the slot recommender. No participants needed.
 *
 *   npx tsx scripts/simulate-recommender.ts            (full run, about 4 minutes)
 *   npx tsx scripts/simulate-recommender.ts --quick    (smaller, for checking changes)
 *   python scripts/plot-simulation.py                  (makes the figures)
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
 * Experiments
 *   1. main         the headline comparison (same settings as before)
 *   2. ablations    two variants of LinUCB on the same requests: a wider
 *                   candidate pool, and learning from "booked nothing"
 *   3. seeds        the main comparison repeated with 10 random seeds
 *   4. demand       how busy the hall is (15% .. 75% of court-hours taken)
 *   5. behaviour    students who skim (may stop reading before card 4) and
 *                   students whose preference changes halfway
 *   6. latency      design spec DS4: response time for a one-week window
 *
 * Strategies, all on the SAME requests with the SAME random draws (paired):
 *   random        - candidates in random order
 *   fixed         - the baseline score S = w1 T + w2 C + w3 U, weights never change
 *   adaptive      - baseline score with the per-student updateWeights() rule
 *   linucb        - what the app does: adaptive pool of 6, LinUCB ranking, cascade feedback
 *   linucb_wide   - as linucb, but LinUCB re-ranks a pool of 12 instead of 6
 *   linucb_reject - as linucb, but "booked none of the four" also counts as feedback
 *
 * Measured against an ORACLE that knows the student's preference and picks
 * the best 4 of ALL feasible slots.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  recommendAcross, updateWeights, DEFAULT_WEIGHTS, DEFAULT_PEAKS, type ScoredSlot,
} from "../src/lib/recommend";
import { initBandit, rankWithBandit, cascadeUpdate, type BanditState } from "../src/lib/bandit";
import { addDays, myAt } from "../src/lib/time";
import type { Facility, FacilityRule, Reservation, RecWeights } from "../src/lib/types";

const QUICK = process.argv.includes("--quick");
const OUT = "docs/simulation";
const SEED = 20261001;
const SHOWN = 4;                       // cards the app shows
const BASE_DATE = "2026-10-05";
const NOW = myAt("2026-10-05", "07:00");

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
const TYPE_NAMES = Object.keys(TYPES);

const ALL_POLICIES = ["random", "fixed", "adaptive", "linucb", "linucb_wide", "linucb_reject"] as const;
type Policy = (typeof ALL_POLICIES)[number];
const CORE: Policy[] = ["random", "fixed", "adaptive", "linucb"];

// ------------------------------------------------------------ fixtures --
const COURTS: Facility[] = [1, 2, 3].map((n) => ({
  id: `c${n}`, name: `Court ${n}`, category_id: "badm", category_name: "Badminton",
  type: "badminton", venue: "Sports Hall", location: "Sports Hall", capacity: 4,
  description: null, status: "active",
}));
const rulesFor = (facs: Facility[]): Record<string, FacilityRule> => Object.fromEntries(facs.map((c) => [c.id, {
  facility_id: c.id, category_id: c.category_id, category_name: c.category_name, type: c.type,
  venue: c.venue, open_time: "10:00", close_time: "22:00", slot_minutes: 60,
  min_duration_mins: 60, max_duration_mins: 120, max_advance_days: 14,
  cancellation_hours: 12, auto_approve: false, has_override: false,
}]));
const RULES = rulesFor(COURTS);

// ----------------------------------------------------------------- rng --
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------- student model --
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);
const acceptProb = (pref: Pref, s: ScoredSlot) => {
  if (pref.kind === "step") {
    const exactHour = s.features[1] === 1, sameDay = s.features[5] === 1;
    return exactHour && sameDay ? 0.6 : 0.03;
  }
  return Math.min(0.95, Math.max(0.02, dot(pref.theta, s.features)));
};
/**
 * P(the student books one of the shown cards). `examine` is the chance they
 * read on to the next card after turning one down (1 = always reads all four).
 */
const listValue = (pref: Pref, shown: ScoredSlot[], examine = 1) => {
  let reach = 1, v = 0;
  shown.forEach((s, i) => {
    if (i > 0) reach *= examine;
    const p = acceptProb(pref, s);
    v += reach * p;
    reach *= 1 - p;
  });
  return v;
};

// ------------------------------------------------------------ scenario --
interface Scenario {
  name: string;
  seed: number;
  studentsPerType: number;
  attempts: number;
  busyProb: number;        // chance any other court-hour is already booked
  examine: number;         // 1 = reads all four cards; <1 = may stop early
  driftAt: number | null;  // attempt at which every student switches to another type
  policies: Policy[];
}
type Row = { type: string; student: number; attempt: number; policy: Policy;
             accepted: number; top: number; value: number; regret: number };

function runScenario(sc: Scenario): Row[] {
  const rng = mulberry32(sc.seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rng() * xs.length)];
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
        if (isAsked || rng() < sc.busyProb) book(c, d, h);   // the asked-for slot is always taken
      }
    }
    const uniforms = Array.from({ length: SHOWN }, () => rng()); // shared across policies
    const shuffleKeys = Array.from({ length: 12 }, () => rng());
    // only drawn when needed, so the main experiment keeps its original random stream
    const reads = sc.examine < 1 ? Array.from({ length: SHOWN }, () => rng()) : [];
    return { date, hour, requested, participants, reservations, uniforms, shuffleKeys, reads };
  }
  type Req = ReturnType<typeof makeRequest>;

  const pool = (req: Req, weights: RecWeights, limit = 6, perFacility = 3) => recommendAcross({
    requested: req.requested, facilities: COURTS, rules: RULES, reservations: req.reservations,
    date: req.date, durationMins: 60, participants: req.participants, preferredHour: req.hour,
    weights, peaks: DEFAULT_PEAKS, now: NOW, lookAheadDays: 2, limit, perFacility,
  }).slots;

  interface StudentState { weights: RecWeights; bandit: BanditState }
  const rows: Row[] = [];

  TYPE_NAMES.forEach((type, ti) => {
    for (let s = 0; s < sc.studentsPerType; s++) {
      const state = Object.fromEntries(
        sc.policies.map((p) => [p, { weights: { ...DEFAULT_WEIGHTS }, bandit: initBandit() }]),
      ) as Record<Policy, StudentState>;

      for (let a = 0; a < sc.attempts; a++) {
        // preference drift: halfway through, everyone becomes the next type along
        const nowType = sc.driftAt !== null && a >= sc.driftAt ? TYPE_NAMES[(ti + 1) % TYPE_NAMES.length] : type;
        const pref = TYPES[nowType];
        const req = makeRequest();
        const all = pool(req, DEFAULT_WEIGHTS, 200, 200);
        if (all.length === 0) continue;
        const oracle = [...all].sort((x, y) => acceptProb(pref, y) - acceptProb(pref, x)).slice(0, SHOWN);
        const best = listValue(pref, oracle, sc.examine);

        for (const p of sc.policies) {
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
            // the app's pool is 6 slots, at most 3 per court; the wide variant doubles it
            const [size, per] = p === "linucb_wide" ? [12, 6] : [6, 3];
            shown = rankWithBandit(pool(req, st.weights, size, per), st.bandit).slice(0, SHOWN);
          }

          // student scans top-down, books the first card they like; a skimmer may stop early
          let idx = -1;
          for (let i = 0; i < shown.length; i++) {
            if (i > 0 && sc.examine < 1 && req.reads[i] > sc.examine) break;
            if (req.uniforms[i] < acceptProb(pref, shown[i])) { idx = i; break; }
          }

          if (idx >= 0) {
            if (p !== "random" && p !== "fixed")
              st.weights = updateWeights(st.weights, shown[idx], req.hour, DEFAULT_PEAKS);
            if (p.startsWith("linucb")) st.bandit = cascadeUpdate(st.bandit, shown, idx);
          } else if (p === "linucb_reject") {
            // booked none: every card shown gets reward 0
            st.bandit = cascadeUpdate(st.bandit, shown, shown.length);
          }
          const value = listValue(pref, shown, sc.examine);
          rows.push({ type, student: s, attempt: a, policy: p,
            accepted: idx >= 0 ? 1 : 0, top: idx === 0 ? 1 : 0, value, regret: best - value });
        }
      }
    }
  });
  return rows;
}

// ------------------------------------------------------------- stats --
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / Math.max(1, xs.length - 1));
};
type CI = { mean: number; lo: number; hi: number };
function ci(xs: number[]): CI {
  const m = mean(xs), h = 1.96 * sd(xs) / Math.sqrt(Math.max(1, xs.length));
  return { mean: m, lo: m - h, hi: m + h };
}
type Field = "value" | "accepted" | "top" | "regret";
/** One number per student: the mean of `field` over attempts [from, to). */
function perStudent(rows: Row[], policy: Policy, field: Field, from: number, to: number, type?: string) {
  const per = new Map<string, number[]>();
  for (const r of rows) {
    if (r.policy !== policy || r.attempt < from || r.attempt >= to || (type && r.type !== type)) continue;
    const k = `${r.type}-${r.student}`;
    (per.get(k) ?? per.set(k, []).get(k)!).push(r[field]);
  }
  return new Map([...per].map(([k, v]) => [k, mean(v)]));
}
const window = (rows: Row[], p: Policy, f: Field, from: number, to: number, type?: string) =>
  ci([...perStudent(rows, p, f, from, to, type).values()]);
/** Paired difference a - b per student, with a 95% CI. */
function paired(rows: Row[], a: Policy, b: Policy, f: Field, from: number, to: number) {
  const A = perStudent(rows, a, f, from, to), B = perStudent(rows, b, f, from, to);
  const d = [...A.keys()].filter((k) => B.has(k)).map((k) => A.get(k)! - B.get(k)!);
  const c = ci(d);
  return { ...c, students: d.length, better: d.filter((x) => x > 0).length, worse: d.filter((x) => x < 0).length };
}

// ------------------------------------------------------------ run all --
const pct = (x: number) => (100 * x).toFixed(1).padStart(5) + "%";
const fmt = (c: CI) => `${pct(c.mean)} [${pct(c.lo)}-${pct(c.hi)}]`;
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pts`;
const t0 = performance.now();
const log = (s: string) => console.log(s);
mkdirSync(OUT, { recursive: true });

const MAIN: Scenario = {
  name: "main", seed: SEED, studentsPerType: QUICK ? 15 : 60, attempts: 80,
  busyProb: 0.35, examine: 1, driftAt: null, policies: [...ALL_POLICIES],
};
const SMALL = QUICK ? 10 : 30;      // students per type for the side experiments
const ATT = MAIN.attempts;
const LATE: [number, number] = [ATT - 20, ATT];

// 1 + 2. main comparison and ablations ------------------------------------
log(`[1/6] main comparison: ${MAIN.studentsPerType * 4} students x ${ATT} attempts x ${MAIN.policies.length} strategies`);
const rows = runScenario(MAIN);

const curve: string[] = ["attempt,type,policy,value,accepted,top,regret"];
for (const type of ["all", ...TYPE_NAMES]) for (const p of MAIN.policies) for (let a = 0; a < ATT; a++) {
  const rs = rows.filter((r) => r.policy === p && r.attempt === a && (type === "all" || r.type === type));
  curve.push([a + 1, type, p, mean(rs.map((r) => r.value)).toFixed(4), mean(rs.map((r) => r.accepted)).toFixed(4),
    mean(rs.map((r) => r.top)).toFixed(4), mean(rs.map((r) => r.regret)).toFixed(4)].join(","));
}
writeFileSync(`${OUT}/learning-curves.csv`, curve.join("\n"));

const overall = Object.fromEntries(MAIN.policies.map((p) => [p, {
  value_first5: window(rows, p, "value", 0, 5),
  value_first10: window(rows, p, "value", 0, 10),
  value_last20: window(rows, p, "value", ...LATE),
  top_card_last20: window(rows, p, "top", ...LATE),
  regret_last20: window(rows, p, "regret", ...LATE),
}]));
const byType = Object.fromEntries(TYPE_NAMES.map((t) => [t, Object.fromEntries(
  MAIN.policies.map((p) => [p, { value: window(rows, p, "value", ...LATE, t), top: window(rows, p, "top", ...LATE, t) }]),
)]));
// how soon does LinUCB pull ahead? (occasional users)
const milestones = [1, 5, 10, 20, 40, 80].map((n) => ({
  attempts: n,
  gain: paired(rows, "linucb", "fixed", "value", Math.max(0, n - 5), n),
}));
const pairedMain = {
  linucb_vs_fixed: paired(rows, "linucb", "fixed", "value", ...LATE),
  linucb_vs_adaptive: paired(rows, "linucb", "adaptive", "value", ...LATE),
  adaptive_vs_fixed: paired(rows, "adaptive", "fixed", "value", ...LATE),
  wide_vs_linucb: paired(rows, "linucb_wide", "linucb", "value", ...LATE),
  reject_vs_linucb: paired(rows, "linucb_reject", "linucb", "value", ...LATE),
  reject_vs_linucb_first20: paired(rows, "linucb_reject", "linucb", "value", 0, 20),
};

// 3. seeds -----------------------------------------------------------------
const SEEDS = QUICK ? 3 : 10;
log(`[2/6] ${SEEDS} random seeds`);
const seedRuns = Array.from({ length: SEEDS }, (_, i) => {
  const r = runScenario({ ...MAIN, name: `seed${i}`, seed: SEED + 1000 * (i + 1), studentsPerType: SMALL, policies: CORE });
  return {
    seed: SEED + 1000 * (i + 1),
    ...Object.fromEntries(CORE.map((p) => [p, window(r, p, "value", ...LATE).mean])),
    gain: paired(r, "linucb", "fixed", "value", ...LATE).mean,
  } as Record<string, number>;
});
const gains = seedRuns.map((s) => s.gain);
const seedSummary = {
  runs: seedRuns,
  gain_mean: mean(gains), gain_sd: sd(gains), gain_min: Math.min(...gains), gain_max: Math.max(...gains),
  linucb_best_in: seedRuns.filter((s) => CORE.every((p) => s.linucb >= s[p])).length,
};

// 4. demand ----------------------------------------------------------------
const DEMAND = [0.15, 0.35, 0.55, 0.75];
log(`[3/6] demand levels ${DEMAND.join(", ")}`);
const demand = DEMAND.map((busy, i) => {
  const r = runScenario({ ...MAIN, name: `busy${busy}`, seed: SEED + 77 * (i + 1), studentsPerType: SMALL, busyProb: busy, policies: CORE });
  return { busy, ...Object.fromEntries(CORE.map((p) => [p, window(r, p, "value", ...LATE)])),
    gain: paired(r, "linucb", "fixed", "value", ...LATE) };
});

// 5. behaviour -------------------------------------------------------------
log("[4/6] student behaviour: skimming and changing preferences");
const behaviourDefs = [
  { key: "reads_all", label: "Reads all four cards", examine: 1, driftAt: null },
  { key: "skims", label: "Skims: 70% chance of reading the next card", examine: 0.7, driftAt: null },
  { key: "drift", label: "Changes preference at attempt 40", examine: 1, driftAt: 40 },
] as const;
const behaviourRows: Record<string, Row[]> = {};
const behaviour = behaviourDefs.map((b, i) => {
  const r = runScenario({ ...MAIN, name: b.key, seed: SEED + 555 * (i + 1), studentsPerType: SMALL,
    examine: b.examine, driftAt: b.driftAt, policies: CORE });
  behaviourRows[b.key] = r;
  return { ...b, ...Object.fromEntries(CORE.map((p) => [p, window(r, p, "value", ...LATE)])),
    gain: paired(r, "linucb", "fixed", "value", ...LATE),
    // right after the change: does LinUCB recover, or stay stuck on the old preference?
    gain_just_after_drift: b.driftAt ? paired(r, "linucb", "fixed", "value", b.driftAt, b.driftAt + 10) : null };
});
const driftCurve: string[] = ["attempt,policy,value"];
for (const p of CORE) for (let a = 0; a < ATT; a++) {
  const rs = behaviourRows.drift.filter((r) => r.policy === p && r.attempt === a);
  driftCurve.push([a + 1, p, mean(rs.map((r) => r.value)).toFixed(4)].join(","));
}
writeFileSync(`${OUT}/drift-curve.csv`, driftCurve.join("\n"));

// 6. latency (design spec DS4: under 1 second for a one-week window) -------
log("[5/6] latency");
function latency(nFacilities: number, worst: boolean, reps: number) {
  const rng = mulberry32(SEED + nFacilities);
  const facs: Facility[] = Array.from({ length: nFacilities }, (_, i) => ({
    ...COURTS[0], id: `f${i}`, name: `Room ${i + 1}`,
  }));
  const rules = rulesFor(facs);
  const res: Reservation[] = [];
  let n = 0;
  for (let off = 0; off < 7; off++) {
    const d = addDays(BASE_DATE, off);
    // worst case: the first six days are full everywhere, so all seven days are searched
    const busy = worst && off < 6 ? 1 : 0.35;
    for (const f of facs) for (let h = 10; h < 22; h++) if (rng() < busy) res.push({
      id: `l${n++}`, facility_id: f.id, user_id: "x",
      start_time: myAt(d, `${h}:00`).toISOString(), end_time: myAt(d, `${h + 1}:00`).toISOString(),
      participants: 2, purpose: null, status: "approved", checked_in_at: null, no_show: false,
      created_at: NOW.toISOString(),
    });
  }
  const bandit = initBandit();
  const call = () => rankWithBandit(recommendAcross({
    requested: facs[0], facilities: facs, rules, reservations: res, date: BASE_DATE,
    durationMins: 60, participants: 2, preferredHour: 15, weights: DEFAULT_WEIGHTS,
    peaks: DEFAULT_PEAKS, now: NOW, lookAheadDays: 6,
  }).slots, bandit);
  for (let i = 0; i < 20; i++) call();        // warm-up
  const ms: number[] = [];
  for (let i = 0; i < reps; i++) { const s = performance.now(); call(); ms.push(performance.now() - s); }
  ms.sort((a, b) => a - b);
  const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  return { facilities: nFacilities, case: worst ? "worst (7 days searched)" : "typical (1 day)",
    bookings: res.length, median_ms: q(0.5), p95_ms: q(0.95), max_ms: ms[ms.length - 1] };
}
const latencies = [3, 10, 30].flatMap((n) => [latency(n, false, QUICK ? 100 : 500), latency(n, true, QUICK ? 100 : 500)]);

// ------------------------------------------------------------ write out --
log("[6/6] writing results");
const summary = {
  generated_by: "scripts/simulate-recommender.ts",
  quick: QUICK,
  settings: { SEED, SHOWN, main: MAIN, side_experiments_students_per_type: SMALL, types: TYPES },
  note: "value = probability the student books one of the shown cards; regret = oracle value - policy value; " +
        "ranges are 95% confidence intervals across students; paired = same students, same requests.",
  overall, by_type_last20: byType, paired_last20: pairedMain, milestones,
  seeds: seedSummary, demand, behaviour, latency_ms: latencies,
  runtime_s: (performance.now() - t0) / 1000,
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));

// ------------------------------------------------------------ console --
log(`\nP(student books a suggestion) - last 20 attempts, 95% CI across students`);
for (const p of MAIN.policies)
  log(`  ${p.padEnd(14)} ${fmt(overall[p].value_last20)}   first 10: ${pct(overall[p].value_first10.mean)}   regret: ${pct(overall[p].regret_last20.mean)}`);
const g = pairedMain.linucb_vs_fixed;
log(`\nPaired: linucb - fixed = ${pp(g.mean)} [${pp(g.lo)} .. ${pp(g.hi)}], better for ${g.better}/${g.students} students`);
log(`Ablation: wider pool ${pp(pairedMain.wide_vs_linucb.mean)}, learning from rejections ${pp(pairedMain.reject_vs_linucb.mean)} (first 20: ${pp(pairedMain.reject_vs_linucb_first20.mean)})`);
log(`\nGain over fixed by number of attempts: ` + milestones.map((m) => `${m.attempts}: ${pp(m.gain.mean)}`).join(", "));
log(`\nSeeds (${SEEDS}): gain ${pp(seedSummary.gain_mean)} +/- ${pp(seedSummary.gain_sd)} (min ${pp(seedSummary.gain_min)}, max ${pp(seedSummary.gain_max)}); linucb best in ${seedSummary.linucb_best_in}/${SEEDS}`);
log(`\nDemand:`);
for (const d of demand) log(`  ${(d.busy * 100).toFixed(0).padStart(3)}% busy   fixed ${pct((d as unknown as Record<string, CI>).fixed.mean)}  linucb ${pct((d as unknown as Record<string, CI>).linucb.mean)}  gain ${pp(d.gain.mean)}`);
log(`\nBehaviour:`);
for (const b of behaviour) log(`  ${b.key.padEnd(10)} fixed ${pct((b as unknown as Record<string, CI>).fixed.mean)}  linucb ${pct((b as unknown as Record<string, CI>).linucb.mean)}  gain ${pp(b.gain.mean)}` +
  (b.gain_just_after_drift ? `  (10 attempts after the change: ${pp(b.gain_just_after_drift.mean)})` : ""));
log(`\nLatency (DS4 target < 1000 ms):`);
for (const l of latencies) log(`  ${String(l.facilities).padStart(2)} rooms, ${l.case.padEnd(24)} median ${l.median_ms.toFixed(2)} ms, p95 ${l.p95_ms.toFixed(2)} ms, max ${l.max_ms.toFixed(2)} ms`);
log(`\nwrote ${OUT}/summary.json, learning-curves.csv, drift-curve.csv in ${summary.runtime_s.toFixed(0)} s`);
