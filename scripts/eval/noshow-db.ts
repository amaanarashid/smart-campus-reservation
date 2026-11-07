/**
 * Database checks for upgrade-noshow.sql on the throwaway Postgres 17
 * (pg-harness.mjs), including the TS <-> SQL parity test.
 *
 *   cd scripts/eval && npm install && cd ../.. && npx tsx scripts/eval/noshow-db.ts
 *
 *   RLS        students cannot read booking_risk (not even their own) or
 *              noshow_model; a manager sees only their rooms; admins see all
 *   functions  scorer / features / score not callable by authenticated
 *   reminder   exactly one "Still coming?" note per high-risk booking,
 *              only ~1 hour before, never for pending bookings
 *   parity     noshow.ts predict()/explain() and the SQL scorer give the same
 *              p (within 1e-6) and the same reasons, baseline and logreg
 */
import pg from "pg";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
// @ts-expect-error - plain JS module
import { startDb, asUser, CONN } from "./pg-harness.mjs";
import {
  BookingRow, FEATURES, Model, buildDataset, buildFeatures, buildHistory, explain, fromSuggestion, predict, train,
} from "../../src/lib/noshow";

const results: { name: string; ok: boolean; detail?: string }[] = [];
const check = (name: string, ok: boolean, detail?: string) => {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};

let seed = 20261031;
const rand = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const { c, stop } = await startDb();
c.on("error", () => {});
const k = new pg.Client(CONN); k.on("error", () => {}); await k.connect();
try {
  // ---- people ----
  const people: [number, string, string][] = [
    [1, "admin", "Admin"], [2, "facility_manager", "Mgr A"], [3, "facility_manager", "Mgr B"],
    [11, "student", "S1"], [12, "student", "S2"], [13, "student", "S3"], [14, "student", "S4"],
  ];
  for (const [n, role, name] of people) {
    await c.query("insert into auth.users(id,email) values($1,$2)", [uid(n), `${name}@eval.campus`]);
    await c.query("insert into profiles(id,full_name,email,role) values($1,$2,$3,$4)", [uid(n), name, `${name}@eval.campus`, role]);
  }
  const ADMIN = uid(1), MGR_A = uid(2), MGR_B = uid(3), STUDENTS = [uid(11), uid(12), uid(13), uid(14)];

  // ---- rooms: A needs approval, B is instant ----
  const catA = (await c.query(`insert into facility_categories(name,slug,venue,auto_approve) values('Eval Room','eval_room','Library',false) returning id`)).rows[0].id;
  const catB = (await c.query(`insert into facility_categories(name,slug,venue,auto_approve) values('Eval Court','eval_court','Hall',true) returning id`)).rows[0].id;
  const roomA = (await c.query("insert into facilities(category_id,name,capacity) values($1,'Room A',6) returning id", [catA])).rows[0].id;
  const roomB = (await c.query("insert into facilities(category_id,name,capacity) values($1,'Court B',10) returning id", [catB])).rows[0].id;
  await c.query("insert into facility_managers(facility_id,manager_id) values($1,$2),($3,$4)", [roomA, MGR_A, roomB, MGR_B]);

  // ---- history: 80 finished bookings over the last 40 days, one per hour slot ----
  const H = 3_600_000, now = Date.now();
  const INS = `insert into reservations(facility_id,user_id,start_time,end_time,created_at,participants,status,no_show,checked_in_at)
               values($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`;
  for (let i = 0; i < 80; i++) {
    const s = STUDENTS[i % 4];
    const start = new Date(now - (40 - i / 2) * 24 * H + (i % 3) * H);
    start.setUTCMinutes(0, 0, 0);
    const end = new Date(start.getTime() + (1 + (i % 2)) * H);
    // created_at with microseconds: the scorer must cut to milliseconds like JS
    const created = `${new Date(start.getTime() - (1 + rand() * 300) * H).toISOString().slice(0, 23)}417+00`;
    const miss = rand() < (s === STUDENTS[0] ? 0.6 : 0.15);
    await c.query(INS, [i % 2 ? roomA : roomB, s, start, end, created, 1 + Math.floor(rand() * 9),
      miss ? "cancelled" : "approved", miss, miss ? null : new Date(start.getTime() + 60_000)]);
  }
  // a few accepted suggestions, linked by time to bookings
  const some = (await c.query("select user_id, created_at from reservations order by id limit 6")).rows;
  for (const r of some) await c.query("insert into evaluation_events(user_id,kind,num_value,at) values($1,'rec_accepted',0,$2::timestamptz + interval '90 seconds')", [r.user_id, r.created_at]);

  // ---- upcoming ----
  const at = (h: number) => { const d = new Date(now + h * H); d.setUTCSeconds(0, 0); return d; };
  const up = async (room: string, user: string, startH: number, status: string, pax = 4) =>
    (await c.query(INS, [room, user, at(startH), new Date(at(startH).getTime() + H), new Date(now - 20 * 24 * H), pax, status, false, null])).rows[0].id;
  const soonA = await up(roomA, STUDENTS[0], 1, "approved", 6);     // starts in 1 h: reminder window
  const soonB = await up(roomB, STUDENTS[1], 1, "approved");
  const pendingSoon = await up(roomA, STUDENTS[0], 2.5, "pending"); // pending never gets the note
  const laterA = await up(roomA, STUDENTS[2], 6, "approved");       // outside the window
  const tomorrowB = await up(roomB, STUDENTS[3], 20, "approved");
  const farB = await up(roomB, STUDENTS[0], 50, "approved");        // beyond 24 h: not scored

  // ---- TS side: the same rows, read back the way noshow-server.ts maps them ----
  async function tsRows(): Promise<BookingRow[]> {
    const evs = (await c.query("select user_id, at from evaluation_events where kind='rec_accepted'")).rows
      .map((e) => ({ user_id: e.user_id, at: e.at.toISOString() }));
    const rows = (await c.query(`select r.*, f.category_id, f.capacity, coalesce(e.auto_approve,false) auto_approve
      from reservations r join facilities f on f.id=r.facility_id left join effective_facility_rules e on e.facility_id=r.facility_id`)).rows;
    return rows.map((r) => ({
      id: r.id, user_id: r.user_id, category_id: r.category_id,
      start_time: r.start_time.toISOString(), end_time: r.end_time.toISOString(), created_at: r.created_at.toISOString(),
      participants: r.participants, capacity: r.capacity, auto_approve: r.auto_approve,
      from_suggestion: fromSuggestion(r.user_id, r.created_at.toISOString(), evs),
      status: r.status, no_show: r.no_show, checked_in_at: r.checked_in_at ? r.checked_in_at.toISOString() : null,
    }));
  }

  async function parity(label: string, model: Model) {
    const rows = await tsRows();
    const h = buildHistory(rows);
    let maxP = 0, maxX = 0, reasonsSame = 0, sugg = 0;
    for (const r of rows) {
      const { x, raw } = buildFeatures(r, h);
      const sql = (await c.query("select noshow_features($1) f, noshow_score($1) s", [r.id])).rows[0];
      for (const f of FEATURES) maxX = Math.max(maxX, Math.abs(x[f] - sql.f.x[f]));
      maxP = Math.max(maxP, Math.abs(predict(model, x, raw) - sql.s.risk));
      if (JSON.stringify(explain(model, x, raw)) === JSON.stringify(sql.s.reasons)) reasonsSame++;
      else console.log("  reasons differ:", explain(model, x, raw), sql.s.reasons);
      sugg += x.from_suggestion;
    }
    check(`parity (${label}): features equal on ${rows.length} bookings`, maxX < 1e-9, `max |diff| ${maxX.toExponential(2)}`);
    check(`parity (${label}): p equal within 1e-6`, maxP < 1e-6, `max |diff| ${maxP.toExponential(2)}`);
    check(`parity (${label}): same reasons`, reasonsSame === rows.length, `${reasonsSame}/${rows.length}`);
    if (label === "baseline") check("suggestion link found for some bookings", sugg > 0, `${sugg}`);
  }

  // ---- 1. parity, baseline mode (no model row) ----
  await parity("baseline", { mode: "baseline", version: 0, weights: {}, means: {}, stds: {}, threshold: 0.35 });

  // ---- 2. parity, logistic model trained in TS and stored like noshow-server.ts does ----
  const m = train(buildDataset(await tsRows(), now), { lambda: 0.05 });
  const model: Model = { ...m, version: 1, threshold: 0.2 };
  await c.query("insert into noshow_model(version,mode,weights,means,stds,threshold,n_train) values(1,'logreg',$1,$2,$3,$4,80)",
    [JSON.stringify(m.weights), JSON.stringify(m.means), JSON.stringify(m.stds), 0.2]);
  await parity("logreg", model);

  // ---- 3. scoring + one reminder ----
  // make sure the 1-hour booking is over the threshold, whatever the random history gave
  await c.query("update noshow_model set threshold = least(0.99, greatest(0.001, (noshow_score($1)->>'risk')::float8 - 1e-9))", [soonA]);
  const thr = (await c.query("select threshold from noshow_model where version=1")).rows[0].threshold;
  const sent1 = (await c.query("select score_upcoming_bookings() n")).rows[0].n;
  const sent2 = (await c.query("select score_upcoming_bookings() n")).rows[0].n;
  const scored = (await c.query("select reservation_id from booking_risk")).rows.map((r) => r.reservation_id);
  check("scores pending + approved bookings in the next 24 h only",
    [soonA, soonB, pendingSoon, laterA, tomorrowB].every((id) => scored.includes(id)) && !scored.includes(farB), `${scored.length} scored`);
  const notes = (await c.query("select entity_id, body from notifications where type='noshow_check'")).rows;
  const soonBRisk = (await c.query("select risk from booking_risk where reservation_id=$1", [soonB])).rows[0].risk;
  check("one reminder for the high-risk booking, none on the second run",
    notes.filter((n) => n.entity_id === soonA).length === 1 && sent2 === 0, `run 1 sent ${sent1}, run 2 sent ${sent2}`);
  check("reminder wording", /^Still coming to Room A at \d{1,2}:\d{2} (am|pm)\? If not, please cancel so someone else can use it\.$/.test(notes.find((n) => n.entity_id === soonA)?.body ?? ""),
    notes.find((n) => n.entity_id === soonA)?.body);
  check("no reminder for pending, later-today or tomorrow bookings",
    !notes.some((n) => [pendingSoon, laterA, tomorrowB, farB].includes(n.entity_id)));
  check("low-risk booking in the window gets no reminder",
    soonBRisk >= thr || !notes.some((n) => n.entity_id === soonB), `risk ${soonBRisk.toFixed(3)} vs threshold ${thr.toFixed(3)}`);
  const stored = (await c.query("select risk, reasons, model_version, mode from booking_risk where reservation_id=$1", [soonA])).rows[0];
  check("stored score carries model version, mode and reasons", stored.model_version === 1 && stored.mode === "logreg" && Array.isArray(stored.reasons));
  const status = (await c.query("select status from reservations where id=$1", [soonA])).rows[0].status;
  check("never cancels: the high-risk booking is still approved", status === "approved");

  // ---- 4. RLS ----
  const sel = async (who: string, sql: string) => asUser(k, who, sql);
  const s1Risk = await sel(STUDENTS[0], "select * from booking_risk");
  check("student reads no booking_risk rows (not even their own)", s1Risk.ok && s1Risk.rows.length === 0, `${s1Risk.rows?.length} rows`);
  const s1Model = await sel(STUDENTS[0], "select * from noshow_model");
  check("student reads no noshow_model rows", s1Model.ok && s1Model.rows.length === 0);
  const mgrA = await sel(MGR_A, "select b.reservation_id, r.facility_id from booking_risk b join reservations r on r.id=b.reservation_id");
  const roomACount = (await c.query("select count(*)::int n from booking_risk b join reservations r on r.id=b.reservation_id where r.facility_id=$1", [roomA])).rows[0].n;
  check("manager sees only their own rooms' scores",
    mgrA.ok && mgrA.rows.length === roomACount && mgrA.rows.every((r: { facility_id: string }) => r.facility_id === roomA), `${mgrA.rows?.length} of ${scored.length}`);
  const mgrModel = await sel(MGR_A, "select * from noshow_model");
  check("manager reads no noshow_model rows", mgrModel.ok && mgrModel.rows.length === 0);
  const adm = await sel(ADMIN, "select * from booking_risk");
  const admModel = await sel(ADMIN, "select * from noshow_model");
  check("admin sees every score and the model", adm.ok && adm.rows.length === scored.length && admModel.ok && admModel.rows.length === 1);
  const mgrB = await sel(MGR_B, "select reservation_id from booking_risk");
  check("the other manager does not see Room A", mgrB.ok && !mgrB.rows.some((r: { reservation_id: string }) => r.reservation_id === soonA));

  // ---- 5. writes and functions are closed to signed-in users ----
  for (const [name, sql] of [
    ["score_upcoming_bookings()", "select score_upcoming_bookings()"],
    ["noshow_score()", `select noshow_score('${soonA}')`],
    ["noshow_features()", `select noshow_features('${soonA}')`],
  ]) {
    const r = await sel(STUDENTS[0], sql);
    check(`authenticated cannot call ${name}`, !r.ok && r.code === "42501", r.error);
    const a = await sel(ADMIN, sql);
    check(`even an admin's session cannot call ${name}`, !a.ok && a.code === "42501");
  }
  const ins = await sel(STUDENTS[0], `insert into booking_risk(reservation_id,risk) values('${laterA}',0)`);
  check("student cannot write booking_risk", !ins.ok);
  const upd = await sel(MGR_A, `update booking_risk set risk=0 where reservation_id='${soonA}' returning 1`);
  check("manager cannot change a score", !upd.ok || upd.rows.length === 0);
  const insM = await sel(ADMIN, "insert into noshow_model(version,mode) values(99,'baseline')");
  check("admin session cannot insert a model directly (service role only)", !insM.ok);

  // ---- 6. re-runnable, cascade, schedule ----
  const again = await c.query(readFileSync(new URL("../../supabase/upgrade-noshow.sql", import.meta.url), "utf8")
    .replace(/create extension if not exists pg_cron;/g, "")).then(() => true, (e) => (console.error(e), false));
  check("migration runs a second time and keeps the scores", again &&
    (await c.query("select count(*)::int n from booking_risk")).rows[0].n === scored.length);
  check("cron job not duplicated by a re-run",
    (await c.query("select count(*)::int n from cron.job where jobname='score-upcoming-bookings'")).rows[0].n === 1);
  await c.query("delete from reservations where id=$1", [tomorrowB]);
  check("booking_risk row goes when the booking is deleted",
    (await c.query("select count(*)::int n from booking_risk where reservation_id=$1", [tomorrowB])).rows[0].n === 0);
  check("cron job scheduled every 10 minutes",
    (await c.query("select schedule from cron.job where jobname='score-upcoming-bookings'")).rows[0]?.schedule === "*/10 * * * *");
} catch (e) {
  console.error(e);
  check("script ran to the end", false, (e as Error).message);
} finally {
  await k.end();
  await stop();
}
const failed = results.filter((r) => !r.ok).length;
mkdirSync("docs/evaluation", { recursive: true });
writeFileSync("docs/evaluation/noshow-db.json", JSON.stringify({
  generated_by: "scripts/eval/noshow-db.ts", run_at: new Date().toISOString(),
  passed: results.length - failed, total: results.length, checks: results,
}, null, 2));
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
