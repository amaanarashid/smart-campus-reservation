/**
 * Objective 5 / design spec DS4: recommender response time.
 * The same latency experiment as scripts/simulate-recommender.ts (step 6),
 * runnable on its own in a few seconds:
 *
 *   npx tsx scripts/eval/recommender-latency.ts
 *
 * Times the full suggestion path the app runs (recommendAcross + LinUCB
 * re-ranking) over a one-week window, for 3 / 10 / 30 rooms, in a typical
 * case (35% of hours booked) and a worst case (six days full, so all seven
 * days are searched). Target: under 1000 ms. Writes docs/evaluation/latency.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { recommendAcross, DEFAULT_WEIGHTS, DEFAULT_PEAKS } from "../../src/lib/recommend";
import { initBandit, rankWithBandit } from "../../src/lib/bandit";
import { addDays, myAt } from "../../src/lib/time";
import type { Facility, FacilityRule, Reservation } from "../../src/lib/types";

const SEED = 20261001;
const BASE_DATE = "2026-10-05";
const NOW = myAt(BASE_DATE, "07:00");
const REPS = Number(process.argv.find((a) => a.startsWith("--reps="))?.split("=")[1] ?? 500);

function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function run(nFacilities: number, worst: boolean) {
  const rng = mulberry32(SEED + nFacilities);
  const facs: Facility[] = Array.from({ length: nFacilities }, (_, i) => ({
    id: `f${i}`, name: `Room ${i + 1}`, category_id: "c", category_name: "Badminton", type: "badminton",
    venue: "Sports Hall", location: "Sports Hall", capacity: 4, description: null, status: "active",
  }));
  const rules: Record<string, FacilityRule> = Object.fromEntries(facs.map((f) => [f.id, {
    facility_id: f.id, category_id: "c", category_name: "Badminton", type: "badminton", venue: "Sports Hall",
    open_time: "10:00", close_time: "22:00", slot_minutes: 60, min_duration_mins: 60, max_duration_mins: 120,
    max_advance_days: 14, cancellation_hours: 12, auto_approve: false, has_override: false,
  }]));
  const res: Reservation[] = [];
  let n = 0;
  for (let off = 0; off < 7; off++) {
    const d = addDays(BASE_DATE, off);
    const busy = worst && off < 6 ? 1 : 0.35;
    for (const f of facs) for (let h = 10; h < 22; h++) if (rng() < busy) res.push({
      id: `l${n++}`, facility_id: f.id, user_id: "x",
      start_time: myAt(d, `${h}:00`).toISOString(), end_time: myAt(d, `${h + 1}:00`).toISOString(),
      participants: 2, purpose: null, status: "approved", checked_in_at: null, no_show: false, created_at: NOW.toISOString(),
    });
  }
  const bandit = initBandit();
  const call = () => rankWithBandit(recommendAcross({
    requested: facs[0], facilities: facs, rules, reservations: res, date: BASE_DATE,
    durationMins: 60, participants: 2, preferredHour: 15, weights: DEFAULT_WEIGHTS,
    peaks: DEFAULT_PEAKS, now: NOW, lookAheadDays: 6,
  }).slots, bandit);
  for (let i = 0; i < 20; i++) call();
  const ms: number[] = [];
  for (let i = 0; i < REPS; i++) { const s = performance.now(); call(); ms.push(performance.now() - s); }
  ms.sort((a, b) => a - b);
  const q = (p: number) => ms[Math.min(ms.length - 1, Math.floor(p * ms.length))];
  return { rooms: nFacilities, case: worst ? "worst (7 days searched)" : "typical (1 day)", bookings: res.length,
    median_ms: +q(0.5).toFixed(3), p95_ms: +q(0.95).toFixed(3), max_ms: +ms[ms.length - 1].toFixed(3) };
}

const rows = [3, 10, 30].flatMap((n) => [run(n, false), run(n, true)]);
const pass = rows.every((r) => r.p95_ms < 1000);
mkdirSync("docs/evaluation", { recursive: true });
writeFileSync("docs/evaluation/latency.json", JSON.stringify({
  generated_by: "scripts/eval/recommender-latency.ts", node: process.version, reps: REPS, target_ms: 1000, pass, rows,
}, null, 2));
console.log("DS4 recommender latency (target p95 < 1000 ms)");
for (const r of rows) console.log(`  ${String(r.rooms).padStart(2)} rooms, ${r.case.padEnd(24)} median ${r.median_ms} ms  p95 ${r.p95_ms} ms  max ${r.max_ms} ms`);
console.log(pass ? "PASS" : "FAIL");
