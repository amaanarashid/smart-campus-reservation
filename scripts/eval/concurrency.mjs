/**
 * Objective 5 / design spec DS1: "no sequence of simultaneous requests can
 * produce two bookings for the same facility at the same time" (objective 2).
 *
 *   cd scripts/eval && npm install && node concurrency.mjs
 *
 * 50 students, each on their OWN database connection, fire booking requests
 * at the same instant through the same path the app uses (role
 * "authenticated", row-level security and the booking-rules trigger on).
 *   A. same slot      - all 50 ask for the identical hour, 20 rounds
 *   B. staggered      - 50 one-hour requests at random 15-minute offsets in a
 *                       three-hour window, 20 rounds (partial overlaps)
 *   C. fair-use limit - one student fires 10 bookings at once on a type
 *                       limited to 1 upcoming booking, 20 rounds
 * After every round the database is searched for any two overlapping
 * active bookings. Writes ../../docs/evaluation/concurrency.json.
 */
import pg from "pg";
import { writeFileSync, mkdirSync } from "node:fs";
import { startDb, asUser, CONN } from "./pg-harness.mjs";

const N = Number(process.env.STUDENTS ?? 50), ROUNDS = Number(process.env.ROUNDS ?? 20);
let seed = 20261025;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

const { c, stop } = await startDb();
console.log("database ready; migrations applied");
// a thrown error stops the embedded server; show the real cause, not the disconnects
c.on("error", () => {});
try {

// fixtures: a room open all day so results never depend on the clock
const users = Array.from({ length: N }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
for (const [i, id] of users.entries()) {
  await c.query("insert into auth.users(id,email) values($1,$2)", [id, `s${i}@eval.campus`]);
  await c.query("insert into public.profiles(id,full_name,email,role) values($1,$2,$3,'student')", [id, `Student ${i}`, `s${i}@eval.campus`]);
}
const cat = (await c.query(`insert into facility_categories(name,slug,venue,open_time,close_time,slot_minutes,min_duration_mins,max_duration_mins,max_advance_days,cancellation_hours,auto_approve)
  values('Eval Court','eval_court','Eval Hall','00:00','23:59',15,15,240,60,0,true) returning id`)).rows[0].id;
const room = (await c.query("insert into facilities(category_id,name,capacity,status) values($1,'Court 1',10,'active') returning id", [cat])).rows[0].id;
const limCat = (await c.query(`insert into facility_categories(name,slug,venue,open_time,close_time,slot_minutes,min_duration_mins,max_duration_mins,max_advance_days,cancellation_hours,auto_approve,max_upcoming)
  values('Eval Limited','eval_limited','Eval Hall','00:00','23:59',15,15,240,60,0,true,1) returning id`)).rows[0].id;
const limRooms = [];
for (let i = 0; i < 10; i++) limRooms.push((await c.query("insert into facilities(category_id,name,capacity,status) values($1,$2,10,'active') returning id", [limCat, `L${i}`])).rows[0].id);

// one connection per student
const pool = [];
for (let i = 0; i < N; i++) { const k = new pg.Client(CONN); k.on("error", () => {}); await k.connect(); pool.push(k); }

const INS = "insert into reservations(facility_id,user_id,start_time,end_time,participants,status) values($1,$2,$3,$4,2,'pending')";
const overlaps = async () => (await c.query(`select count(*)::int n from reservations a join reservations b
  on a.facility_id = b.facility_id and a.id < b.id and a.status in ('pending','approved') and b.status in ('pending','approved')
  and tstzrange(a.start_time, a.end_time) && tstzrange(b.start_time, b.end_time)`)).rows[0].n;
// 08:00 Malaysia time, two days ahead; every slot below stays inside one day
const DAY = 86400000, MYT = 8 * 3600000;
const base = Math.floor((Date.now() + MYT) / DAY) * DAY - MYT + 2 * DAY + 8 * 3600000;

async function fire(jobs) {           // jobs: [client, uid, params]
  const t = [];
  const res = await Promise.all(jobs.map(async ([k, uid, params]) => {
    const s = performance.now(); const r = await asUser(k, uid, INS, params); t.push(performance.now() - s); return r;
  }));
  return { res, t };
}

const otherErrors = {};
const noteOther = (res) => { for (const x of res) if (!x.ok && x.code !== "23P01") otherErrors[`${x.code}: ${x.error}`] = (otherErrors[`${x.code}: ${x.error}`] ?? 0) + 1; };
const out = { generated_by: "scripts/eval/concurrency.mjs", students: N, rounds: ROUNDS, scenarios: {} };
const lat = [];

// A. identical slot
{
  let accepted = 0, refusedOverlap = 0, other = 0, overlapFound = 0, perfect = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const s = new Date(base + r * DAY), e = new Date(s.getTime() + 3600000);          // 08:00-09:00, day r
    const { res, t } = await fire(pool.map((k, i) => [k, users[i], [room, users[i], s.toISOString(), e.toISOString()]]));
    lat.push(...t); noteOther(res);
    const ok = res.filter((x) => x.ok).length;
    accepted += ok; refusedOverlap += res.filter((x) => !x.ok && x.code === "23P01").length; other += res.filter((x) => !x.ok && x.code !== "23P01").length;
    if (ok === 1) perfect++;
    overlapFound += await overlaps();
  }
  out.scenarios.same_slot = { requests: N * ROUNDS, accepted, refused_as_overlap: refusedOverlap, other_errors: other, rounds_with_exactly_one_winner: perfect, overlapping_pairs_found: overlapFound };
}
await c.query("delete from reservations");

// B. staggered partial overlaps
{
  let accepted = 0, refused = 0, other = 0, overlapFound = 0;
  for (let r = 0; r < ROUNDS; r++) {
    const w0 = base + (25 + r) * DAY + 2 * 3600000;                                  // 10:00-13:00 window
    const { res, t } = await fire(pool.map((k, i) => {
      const s = new Date(w0 + Math.floor(rand() * 9) * 15 * 60000);     // 0..2h in 15-min steps
      return [k, users[i], [room, users[i], s.toISOString(), new Date(s.getTime() + 3600000).toISOString()]];
    }));
    lat.push(...t); noteOther(res);
    accepted += res.filter((x) => x.ok).length; refused += res.filter((x) => !x.ok && x.code === "23P01").length;
    other += res.filter((x) => !x.ok && x.code !== "23P01").length;
    overlapFound += await overlaps();
  }
  out.scenarios.staggered = { requests: N * ROUNDS, accepted, refused_as_overlap: refused, other_errors: other, overlapping_pairs_found: overlapFound,
    note: "1-hour requests at random 15-minute offsets inside a 3-hour window; at most 3 can fit per round" };
}
await c.query("delete from reservations");

// C. one student, 10 simultaneous bookings, limit 1 upcoming
{
  let roundsOk = 0, accepted = 0; const limitFailures = [];
  for (let r = 0; r < ROUNDS; r++) {
    await c.query("delete from reservations where facility_id = any($1)", [limRooms]);
    const s = new Date(base + r * DAY + 4 * 3600000);                                // 12:00-13:00, day r
    const { res } = await fire(limRooms.map((fid, i) => [pool[i], users[0], [fid, users[0], s.toISOString(), new Date(s.getTime() + 3600000).toISOString()]]));
    const ok = res.filter((x) => x.ok).length; accepted += ok; if (ok === 1) roundsOk++;
    if (ok !== 1) limitFailures.push({ round: r, accepted: ok, errors: [...new Set(res.filter((x) => !x.ok).map((x) => `${x.code}: ${x.error}`))] });
  }
  out.scenarios.fair_use_limit = { requests: 10 * ROUNDS, accepted, rounds_with_exactly_one_accepted: roundsOk,
    note: "same student, 10 different courts, same moment, limit = 1 upcoming booking", failures: limitFailures };
}

out.other_errors = otherErrors;
out.latency_ms = { requests: lat.length, median: +q(lat, 0.5).toFixed(2), p95: +q(lat, 0.95).toFixed(2), max: +Math.max(...lat).toFixed(2),
  note: "database round trip per request with 50 requests in flight (local Postgres; excludes network to Supabase)" };
out.pass = out.scenarios.same_slot.overlapping_pairs_found === 0 && out.scenarios.staggered.overlapping_pairs_found === 0
  && out.scenarios.same_slot.rounds_with_exactly_one_winner === ROUNDS && out.scenarios.fair_use_limit.rounds_with_exactly_one_accepted === ROUNDS;

for (const k of pool) await k.end();
await stop();
mkdirSync(new URL("../../docs/evaluation/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../docs/evaluation/concurrency.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
} catch (e) {
  console.error("FAILED:", e?.message ?? e, e?.stack?.split("\n")[1] ?? "");
  try { await stop(); } catch { /* already down */ }
  process.exit(1);
}
