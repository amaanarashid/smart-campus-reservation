/**
 * Campus-level simulation: what happens to a whole sports hall over a semester
 * when clashes are handled in different ways. No participants needed.
 *
 *   npx tsx scripts/simulate-campus.ts            (full run)
 *   npx tsx scripts/simulate-campus.ts --quick    (fewer seeds, for checking changes)
 *   python scripts/plot-campus.py                 (makes the figures)
 *
 * scripts/simulate-recommender.ts asks "given a clash, which strategy ranks the
 * alternatives best?" and gives every strategy the same clash. This script asks
 * the question one level up: students share ONE calendar, bookings are first
 * come first served, and a slot taken by one student is gone for the next. So
 * the strategies change the calendar itself, and we can measure how many
 * requests end in a booking, how full the hall gets and where the overflow goes.
 *
 * Four ways of handling "that time is taken", each in its own copy of the
 * semester, all fed the SAME stream of requests and the same random draws:
 *   none    - no help: the student is turned away (plain first come first served)
 *   manual  - the student looks at the timetable and tries the four nearest free
 *             times by hand (same day first, then closest hour, own court first)
 *   fixed   - the app's baseline suggestions, fixed weights, top four
 *   linucb  - what the app runs: adaptive pool of six, per-student LinUCB
 *             ranking, cascade feedback
 *
 * The recommender (src/lib/recommend.ts), the peak-hour learner
 * (learnPeakHours) and the bandit (src/lib/bandit.ts) are the production code.
 *
 * Student model (the same hidden preferences as simulate-recommender.ts):
 * each student has a usual hour, a favourite court and one of four hidden
 * preference types. A student reads up to four alternatives top-down and books
 * the first one they like. The "quiet hours" preference is judged against the
 * TRUE busy hours of the demand profile, not the recommender's own guess, so a
 * strategy gets no credit for agreeing with itself.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  recommendAcross, updateWeights, learnPeakHours, DEFAULT_WEIGHTS, DEFAULT_PEAKS,
  type ScoredSlot, type PeakModel,
} from "../src/lib/recommend";
import { initBandit, rankWithBandit, cascadeUpdate, type BanditState } from "../src/lib/bandit";
import { addDays, myAt, myWholeHour } from "../src/lib/time";
import type { Facility, FacilityRule, Reservation, RecWeights } from "../src/lib/types";

const QUICK = process.argv.includes("--quick");
const OUT = "docs/simulation/campus";
const SEED = 20261116;
const SHOWN = 4;
const BASE_DATE = "2026-09-07";            // a Monday
const OPEN = 10, CLOSE = 22;               // 12 one-hour slots per court per day
const HOURS = Array.from({ length: CLOSE - OPEN }, (_, i) => OPEN + i);

// How much students want each hour, 10:00 .. 21:00. Lunchtime and evening are
// busiest. An assumption, not APU data: see the README.
const PROFILE_USUAL   = [1, 1.5, 3, 3, 1.5, 1, 1.5, 3, 4, 4, 3, 1.5];
// A campus whose busy hours are NOT the ones the app assumes by default
// (12, 13, 17, 18, 19): checks that learnPeakHours picks them up.
const PROFILE_SHIFTED = [1.5, 3, 1.5, 1, 1.5, 4, 4, 3, 1.5, 1, 3, 3];
const truePeaks = (profile: number[]) => HOURS.filter((_, i) => profile[i] >= 3);

// Hidden preferences, identical to scripts/simulate-recommender.ts.
// Feature order: [bias, T time-proximity, C capacity-fit, U off-peak, S same-court, A same-day]
type Pref = { kind: "linear"; theta: number[] } | { kind: "step" };
const TYPES: Record<string, Pref> = {
  "time-first":  { kind: "linear", theta: [-1.20, 1.70, 0.05, 0.00, 0.00, 0.10] },
  "same-court":  { kind: "linear", theta: [-0.55, 0.45, 0.05, 0.00, 0.55, 0.05] },
  "quiet-hours": { kind: "linear", theta: [-0.60, 0.60, 0.05, 0.55, 0.00, 0.05] },
  "exact-only":  { kind: "step" },
};
const TYPE_NAMES = Object.keys(TYPES);
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0);

const POLICIES = ["none", "manual", "fixed", "linucb"] as const;
type Policy = (typeof POLICIES)[number];

// ----------------------------------------------------------------- rng --
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------ scenario --
interface Scenario {
  name: string;
  seed: number;
  weeks: number;
  students: number;
  courts: number;
  /** Requests per week as a share of the court-hours available per week. */
  demand: number;
  profile: number[];
  /** Share of students who are regulars, and how much more often they book. */
  regularShare: number;
  regularWeight: number;
}
interface Student { type: string; fav: number; usual: number; regular: boolean }
interface Req { day: number; student: number; hour: number; court: number; participants: number; u: number[] }

function makeStream(sc: Scenario) {
  const rng = mulberry32(sc.seed);
  const total = sc.profile.reduce((a, b) => a + b, 0);
  const drawHour = () => {
    let x = rng() * total;
    for (let i = 0; i < HOURS.length; i++) { x -= sc.profile[i]; if (x < 0) return HOURS[i]; }
    return HOURS[HOURS.length - 1];
  };
  const students: Student[] = Array.from({ length: sc.students }, (_, i) => ({
    type: TYPE_NAMES[i % TYPE_NAMES.length],
    fav: Math.floor(rng() * sc.courts),
    usual: drawHour(),
    regular: rng() < sc.regularShare,
  }));
  // pick a student in proportion to how often they book
  const w = students.map((s) => (s.regular ? sc.regularWeight : 1));
  const wSum = w.reduce((a, b) => a + b, 0);
  const drawStudent = () => {
    let x = rng() * wSum;
    for (let i = 0; i < w.length; i++) { x -= w[i]; if (x < 0) return i; }
    return w.length - 1;
  };
  const poisson = (lambda: number) => {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= rng(); } while (p > L);
    return k - 1;
  };
  const perDay = sc.demand * sc.courts * HOURS.length;
  const days = sc.weeks * 7;
  const reqs: Req[] = [];
  for (let day = 0; day < days; day++) {
    const n = poisson(perDay);
    for (let i = 0; i < n; i++) {
      const si = drawStudent();
      const s = students[si];
      reqs.push({
        day, student: si,
        hour: rng() < 0.7 ? s.usual : drawHour(),
        court: rng() < 0.8 ? s.fav : Math.floor(rng() * sc.courts),
        participants: 1 + Math.floor(rng() * 4),
        u: Array.from({ length: SHOWN }, () => rng()),
      });
    }
  }
  return { students, reqs, days };
}
type Stream = ReturnType<typeof makeStream>;

// ---------------------------------------------------------------- world --
interface Metrics {
  req: number; first: number; redirected: number; away: number;
  regReq: number; regServed: number; occReq: number; occServed: number;
  lateRegClash: number; lateRegRedirected: number;   // regulars, last third of the semester
  redirOffPeak: number; redirShift: number; redirSameDay: number; redirSameCourt: number;
  booked: number; peakBooked: number; offBooked: number;
  load: number[];                                     // bookings by hour of day
  weekly: { req: number; served: number; clash: number; redirected: number }[];
  heat: number[][];                                   // [day][hour] courts booked
  peaksLearned: number[];
}

function runWorld(sc: Scenario, stream: Stream, policy: Policy): Metrics {
  const { students, reqs, days } = stream;
  const peakSet = new Set(truePeaks(sc.profile));
  const courts: Facility[] = Array.from({ length: sc.courts }, (_, i) => ({
    id: `c${i}`, name: `Court ${i + 1}`, category_id: "badm", category_name: "Badminton",
    type: "badminton", venue: "Sports Hall", location: "Sports Hall", capacity: 4,
    description: null, status: "active",
  }));
  const rules: Record<string, FacilityRule> = Object.fromEntries(courts.map((c) => [c.id, {
    facility_id: c.id, category_id: c.category_id, category_name: c.category_name, type: c.type,
    venue: c.venue, open_time: "10:00", close_time: "22:00", slot_minutes: 60,
    min_duration_mins: 60, max_duration_mins: 120, max_advance_days: 14,
    cancellation_hours: 12, auto_approve: false, has_override: false,
  }]));
  const dayKeys = Array.from({ length: days + 4 }, (_, i) => addDays(BASE_DATE, i));
  const dayIndex = new Map(dayKeys.map((k, i) => [k, i]));

  const taken = new Set<string>();
  const byDay = new Map<number, Reservation[]>();
  let rid = 0;
  const m: Metrics = {
    req: 0, first: 0, redirected: 0, away: 0, regReq: 0, regServed: 0, occReq: 0, occServed: 0,
    lateRegClash: 0, lateRegRedirected: 0,
    redirOffPeak: 0, redirShift: 0, redirSameDay: 0, redirSameCourt: 0,
    booked: 0, peakBooked: 0, offBooked: 0,
    load: HOURS.map(() => 0),
    weekly: Array.from({ length: sc.weeks }, () => ({ req: 0, served: 0, clash: 0, redirected: 0 })),
    heat: Array.from({ length: days }, () => HOURS.map(() => 0)),
    peaksLearned: [],
  };
  const book = (court: number, day: number, hour: number) => {
    taken.add(`${court}|${day}|${hour}`);
    const list = byDay.get(day) ?? [];
    list.push({
      id: `r${rid++}`, facility_id: `c${court}`, user_id: "x",
      start_time: myAt(dayKeys[day], `${hour}:00`).toISOString(),
      end_time: myAt(dayKeys[day], `${hour + 1}:00`).toISOString(),
      participants: 2, purpose: null, status: "approved", checked_in_at: null, no_show: false,
      created_at: myAt(dayKeys[Math.max(0, day - 1)], "08:00").toISOString(),
    });
    byDay.set(day, list);
    if (day < days) {                       // spill past the last day is not counted
      m.booked++; m.load[hour - OPEN]++; m.heat[day][hour - OPEN]++;
      if (peakSet.has(hour)) m.peakBooked++; else m.offBooked++;
    }
  };

  const state = students.map(() => ({ weights: { ...DEFAULT_WEIGHTS } as RecWeights, bandit: initBandit() as BanditState }));
  let peaks: PeakModel = DEFAULT_PEAKS;
  const lateFrom = Math.floor((sc.weeks * 2) / 3) * 7;

  /** What the student really thinks of a slot: U is judged on the true busy hours. */
  const acceptProb = (pref: Pref, s: ScoredSlot) => {
    if (pref.kind === "step") return s.features[1] === 1 && s.features[5] === 1 ? 0.6 : 0.03;
    const f = s.features.slice();
    f[3] = peakSet.has(myWholeHour(s.start)) ? 0.3 : 1;
    return Math.min(0.95, Math.max(0.02, dot(pref.theta, f)));
  };

  let lastDay = -1;
  for (const r of reqs) {
    if (r.day !== lastDay) {
      lastDay = r.day;
      // once a week the app's peak hours are re-learned from the last four weeks of bookings
      if (r.day > 0 && r.day % 7 === 0) {
        const hist: Reservation[] = [];
        for (let d = Math.max(0, r.day - 28); d < r.day; d++) hist.push(...(byDay.get(d) ?? []));
        peaks = learnPeakHours(hist);
      }
    }
    const st = students[r.student];
    const wk = m.weekly[Math.floor(r.day / 7)];
    m.req++; wk.req++;
    if (st.regular) m.regReq++; else m.occReq++;
    const served = () => { wk.served++; if (st.regular) m.regServed++; else m.occServed++; };

    if (!taken.has(`${r.court}|${r.day}|${r.hour}`)) {
      book(r.court, r.day, r.hour);
      m.first++; served();
      continue;
    }
    wk.clash++;
    const late = st.regular && r.day >= lateFrom;
    if (late) m.lateRegClash++;
    if (policy === "none") { m.away++; continue; }

    const reservations: Reservation[] = [];
    for (let d = r.day; d <= r.day + 2; d++) reservations.push(...(byDay.get(d) ?? []));
    const pool = (weights: RecWeights, limit: number, perFacility: number) => recommendAcross({
      requested: courts[r.court], facilities: courts, rules, reservations,
      date: dayKeys[r.day], durationMins: 60, participants: r.participants, preferredHour: r.hour,
      weights, peaks, now: myAt(dayKeys[Math.max(0, r.day - 1)], "08:00"), lookAheadDays: 2, limit, perFacility,
    }).slots;

    let shown: ScoredSlot[];
    if (policy === "manual") {
      // by hand: same day first, then the closest hour, own court before another
      shown = pool(DEFAULT_WEIGHTS, 500, 500).sort((a, b) =>
        b.features[5] - a.features[5] || b.features[1] - a.features[1] ||
        b.features[4] - a.features[4] || a.start.getTime() - b.start.getTime()).slice(0, SHOWN);
    } else if (policy === "fixed") {
      shown = pool(DEFAULT_WEIGHTS, 6, 3).slice(0, SHOWN);
    } else {
      shown = rankWithBandit(pool(state[r.student].weights, 6, 3), state[r.student].bandit).slice(0, SHOWN);
    }

    const pref = TYPES[st.type];
    let idx = -1;
    for (let i = 0; i < shown.length; i++) if (r.u[i] < acceptProb(pref, shown[i])) { idx = i; break; }
    if (idx < 0) { m.away++; continue; }

    const got = shown[idx];
    const gDay = dayIndex.get(got.dateKey)!;
    const gHour = myWholeHour(got.start);
    const gCourt = Number(got.facilityId.slice(1));
    book(gCourt, gDay, gHour);
    m.redirected++; wk.redirected++; served();
    if (late) m.lateRegRedirected++;
    if (!peakSet.has(gHour)) m.redirOffPeak++;
    if (gDay === r.day) { m.redirSameDay++; m.redirShift += Math.abs(gHour - r.hour); }
    if (gCourt === r.court) m.redirSameCourt++;
    if (policy === "linucb") {
      const s = state[r.student];
      s.weights = updateWeights(s.weights, got, r.hour, peaks);
      s.bandit = cascadeUpdate(s.bandit, shown, idx);
    }
  }
  m.peaksLearned = peaks.hours;
  return m;
}

// ---------------------------------------------------------------- stats --
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[]) => {
  const mu = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - mu) ** 2, 0) / Math.max(1, xs.length - 1));
};
// two-sided 95% t value for n runs (few seeds, so not 1.96)
const tcrit = (n: number) => ({ 2: 12.706, 3: 4.303, 4: 3.182, 5: 2.776, 10: 2.262, 20: 2.093 } as Record<number, number>)[n] ?? 1.96;
type CI = { mean: number; lo: number; hi: number };
const ci = (xs: number[]): CI => {
  const mu = mean(xs), h = (tcrit(xs.length) * sd(xs)) / Math.sqrt(Math.max(1, xs.length));
  return { mean: mu, lo: mu - h, hi: mu + h };
};

/** One number per run for each headline measure. */
function derive(sc: Scenario, m: Metrics) {
  const days = sc.weeks * 7, nPeak = truePeaks(sc.profile).length;
  const clash = m.redirected + m.away;
  return {
    served: (m.first + m.redirected) / m.req,
    first_choice: m.first / m.req,
    redirected: m.redirected / m.req,
    turned_away: m.away / m.req,
    clash_rate: clash / m.req,
    clash_rescued: clash ? m.redirected / clash : 0,
    utilisation: m.booked / (sc.courts * HOURS.length * days),
    peak_utilisation: m.peakBooked / (sc.courts * nPeak * days),
    offpeak_utilisation: m.offBooked / (sc.courts * (HOURS.length - nPeak) * days),
    served_regular: m.regServed / Math.max(1, m.regReq),
    served_occasional: m.occServed / Math.max(1, m.occReq),
    late_regular_clash_rescued: m.lateRegClash ? m.lateRegRedirected / m.lateRegClash : 0,
    redirect_offpeak_share: m.redirected ? m.redirOffPeak / m.redirected : 0,
    redirect_same_day_share: m.redirected ? m.redirSameDay / m.redirected : 0,
    redirect_same_court_share: m.redirected ? m.redirSameCourt / m.redirected : 0,
    redirect_hours_moved: m.redirSameDay ? m.redirShift / m.redirSameDay : 0,
    requests: m.req,
  };
}
type Derived = ReturnType<typeof derive>;
type Key = keyof Derived;
const KEYS: Key[] = ["served", "first_choice", "redirected", "turned_away", "clash_rate", "clash_rescued",
  "utilisation", "peak_utilisation", "offpeak_utilisation", "served_regular", "served_occasional",
  "late_regular_clash_rescued", "redirect_offpeak_share", "redirect_same_day_share",
  "redirect_same_court_share", "redirect_hours_moved", "requests"];

function runMany(base: Scenario, seeds: number) {
  const per: Record<Policy, Derived[]> = { none: [], manual: [], fixed: [], linucb: [] };
  const raw: Record<Policy, Metrics[]> = { none: [], manual: [], fixed: [], linucb: [] };
  for (let i = 0; i < seeds; i++) {
    const sc = { ...base, seed: base.seed + 1000 * i };
    const stream = makeStream(sc);
    for (const p of POLICIES) {
      const m = runWorld(sc, stream, p);
      raw[p].push(m);
      per[p].push(derive(sc, m));
    }
  }
  const summary = Object.fromEntries(POLICIES.map((p) => [p,
    Object.fromEntries(KEYS.map((k) => [k, ci(per[p].map((d) => d[k]))]))])) as Record<Policy, Record<Key, CI>>;
  /** Paired difference a - b, run by run (same requests, same draws). */
  const paired = (a: Policy, b: Policy, k: Key) => {
    const d = per[a].map((x, i) => x[k] - per[b][i][k]);
    return { ...ci(d), runs: d.length, better: d.filter((x) => x > 0).length };
  };
  return { per, raw, summary, paired };
}

// ------------------------------------------------------------------ run --
const pct = (x: number) => (100 * x).toFixed(1).padStart(5) + "%";
const pp = (x: number) => `${x >= 0 ? "+" : ""}${(100 * x).toFixed(1)} pts`;
const t0 = performance.now();
mkdirSync(OUT, { recursive: true });

const MAIN: Scenario = {
  name: "main", seed: SEED, weeks: 14, students: 300, courts: 3, demand: 0.9,
  profile: PROFILE_USUAL, regularShare: 0.2, regularWeight: 4,
};
const N_MAIN = QUICK ? 4 : 20, N_SIDE = QUICK ? 3 : 10;

console.log(`[1/3] main: ${MAIN.weeks} weeks, ${MAIN.students} students, ${MAIN.courts} courts, demand ${MAIN.demand}, ${N_MAIN} seeds`);
const main = runMany(MAIN, N_MAIN);

const DEMANDS = [0.5, 0.7, 0.9, 1.1, 1.4];
console.log(`[2/3] demand levels ${DEMANDS.join(", ")} (${N_SIDE} seeds each)`);
const demand = DEMANDS.map((d, i) => {
  const r = runMany({ ...MAIN, name: `demand${d}`, demand: d, seed: SEED + 77 * (i + 1) }, N_SIDE);
  return { demand: d, summary: r.summary,
    linucb_vs_none: r.paired("linucb", "none", "served"),
    linucb_vs_manual: r.paired("linucb", "manual", "served"),
    linucb_vs_fixed: r.paired("linucb", "fixed", "served") };
});

console.log(`[3/3] busy hours the app does not assume (${N_SIDE} seeds)`);
const shifted = runMany({ ...MAIN, name: "shifted", profile: PROFILE_SHIFTED, seed: SEED + 4242 }, N_SIDE);

// ------------------------------------------------------------ write out --
const pairs: [Policy, Policy][] = [["manual", "none"], ["fixed", "none"], ["linucb", "none"],
  ["fixed", "manual"], ["linucb", "manual"], ["linucb", "fixed"]];
const pairKeys: Key[] = ["served", "turned_away", "utilisation", "peak_utilisation", "offpeak_utilisation",
  "clash_rescued", "late_regular_clash_rescued", "served_regular", "served_occasional"];
const pairedOut = (r: ReturnType<typeof runMany>) => Object.fromEntries(pairs.map(([a, b]) =>
  [`${a}_vs_${b}`, Object.fromEntries(pairKeys.map((k) => [k, r.paired(a, b, k)]))]));

const hourly = ["hour,demand_share,capacity_share," + POLICIES.join(",")];
const profSum = MAIN.profile.reduce((a, b) => a + b, 0);
HOURS.forEach((h, i) => hourly.push([h, (MAIN.profile[i] / profSum).toFixed(4), (1 / HOURS.length).toFixed(4),
  ...POLICIES.map((p) => mean(main.raw[p].map((m) => m.load[i] / (MAIN.courts * MAIN.weeks * 7))).toFixed(4))].join(",")));
writeFileSync(`${OUT}/hourly-load.csv`, hourly.join("\n"));

const weekly = ["week,policy,served,clash_rescued"];
for (const p of POLICIES) for (let w = 0; w < MAIN.weeks; w++)
  weekly.push([w + 1, p, mean(main.raw[p].map((m) => m.weekly[w].served / Math.max(1, m.weekly[w].req))).toFixed(4),
    mean(main.raw[p].map((m) => m.weekly[w].redirected / Math.max(1, m.weekly[w].clash))).toFixed(4)].join(","));
writeFileSync(`${OUT}/weekly.csv`, weekly.join("\n"));

// one semester (the first seed), hour by hour, for the replay page
const heat = ["policy,day,hour,courts_booked"];
for (const p of POLICIES) main.raw[p][0].heat.forEach((row, d) => row.forEach((v, i) => heat.push([p, d, HOURS[i], v].join(","))));
writeFileSync(`${OUT}/heat-seed0.csv`, heat.join("\n"));

const summary = {
  generated_by: "scripts/simulate-campus.ts",
  quick: QUICK,
  note: "Each policy runs its own copy of the semester on the same request stream. Ranges are 95% confidence " +
        "intervals across seeds (t distribution). Paired = same seed, same requests, same random draws.",
  settings: { SEED, SHOWN, main: MAIN, seeds_main: N_MAIN, seeds_side: N_SIDE, hours: HOURS,
    true_peak_hours: truePeaks(MAIN.profile), default_peak_hours: DEFAULT_PEAKS.hours, types: TYPES },
  main: { summary: main.summary, paired: pairedOut(main),
    peak_hours_learned_seed0: main.raw.linucb[0].peaksLearned },
  demand,
  shifted_peaks: { profile: PROFILE_SHIFTED, true_peak_hours: truePeaks(PROFILE_SHIFTED),
    summary: shifted.summary, paired: pairedOut(shifted),
    peak_hours_learned: shifted.raw.linucb.map((m) => m.peaksLearned) },
  runtime_s: (performance.now() - t0) / 1000,
};
writeFileSync(`${OUT}/summary.json`, JSON.stringify(summary, null, 2));

// -------------------------------------------------------------- console --
const row = (label: string, s: Record<Policy, Record<Key, CI>>, k: Key, f = pct) =>
  console.log(`  ${label.padEnd(34)}` + POLICIES.map((p) => f(s[p][k].mean).padStart(9)).join(""));
console.log(`\nMain (${N_MAIN} seeds, about ${Math.round(main.summary.none.requests.mean)} requests each)`);
console.log(`  ${"".padEnd(34)}` + POLICIES.map((p) => p.padStart(9)).join(""));
row("request ends in a booking", main.summary, "served");
row("  got the slot asked for", main.summary, "first_choice");
row("  booked an alternative", main.summary, "redirected");
row("turned away", main.summary, "turned_away");
row("asked-for slot already taken", main.summary, "clash_rate");
row("clashes that still got a booking", main.summary, "clash_rescued");
row("court-hours used", main.summary, "utilisation");
row("  busy hours", main.summary, "peak_utilisation");
row("  quiet hours", main.summary, "offpeak_utilisation");
row("alternatives landing in quiet hours", main.summary, "redirect_offpeak_share");
row("alternatives on the same day", main.summary, "redirect_same_day_share");
row("hours moved (same day)", main.summary, "redirect_hours_moved", (x) => x.toFixed(2));
row("regulars served", main.summary, "served_regular");
row("occasional users served", main.summary, "served_occasional");
row("regulars, last third: clash rescued", main.summary, "late_regular_clash_rescued");
for (const [a, b] of pairs) {
  const d = main.paired(a, b, "served");
  console.log(`  served, ${a} - ${b}: ${pp(d.mean)} [${pp(d.lo)} .. ${pp(d.hi)}], higher in ${d.better}/${d.runs} seeds`);
}
console.log(`\nDemand (served):`);
for (const d of demand) console.log(`  ${d.demand.toFixed(1)}  ` + POLICIES.map((p) => `${p} ${pct(d.summary[p].served.mean)}`).join("  ") +
  `   linucb-fixed ${pp(d.linucb_vs_fixed.mean)}  linucb-manual ${pp(d.linucb_vs_manual.mean)}`);
console.log(`\nShifted busy hours ${truePeaks(PROFILE_SHIFTED).join(",")}: learned (first seed) ${shifted.raw.linucb[0].peaksLearned.join(",")}`);
row("request ends in a booking", shifted.summary, "served");
row("court-hours used", shifted.summary, "utilisation");
console.log(`\nwrote ${OUT}/ in ${((performance.now() - t0) / 1000).toFixed(0)} s`);
