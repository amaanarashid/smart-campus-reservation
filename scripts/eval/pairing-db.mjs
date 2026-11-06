/**
 * Database checks for upgrade-room-pairing.sql on the throwaway Postgres 17
 * (pg-harness.mjs). Nothing here touches the live database.
 *
 *   cd scripts/eval && npm install && node pairing-db.mjs
 */
import { createHash } from "node:crypto";
import pg from "pg";
import { startDb, asUser, CONN } from "./pg-harness.mjs";

let failed = 0, total = 0;
const check = (name, ok, detail) => {
  total++; if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
};
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const hash = (s) => createHash("sha256").update(s).digest("hex");

const { c, stop } = await startDb();
c.on("error", () => {});
const u = new pg.Client(CONN); u.on("error", () => {}); await u.connect();
try {
  for (const [n, role] of [[1, "admin"], [2, "facility_manager"], [3, "student"]]) {
    await c.query("insert into auth.users(id,email) values($1,$2)", [uid(n), `u${n}@eval.campus`]);
    await c.query("insert into profiles(id,full_name,email,role) values($1,$2,$3,$4)", [uid(n), `U${n}`, `u${n}@eval.campus`, role]);
  }
  const ADMIN = uid(1), MANAGER = uid(2), STUDENT = uid(3);
  const cat = (await c.query(`insert into facility_categories(name,slug,venue,auto_approve) values('Eval Room','eval_room','Library',true) returning id`)).rows[0].id;
  const roomA = (await c.query("insert into facilities(category_id,name,capacity) values($1,'Room A',6) returning id", [cat])).rows[0].id;
  const roomB = (await c.query("insert into facilities(category_id,name,capacity) values($1,'Room B',6) returning id", [cat])).rows[0].id;

  const poll = async (h, conn = "wokwi") =>
    (await c.query("select public.room_pair_poll($1,$2) as r", [h, conn])).rows[0].r;
  const claim = (who, code, room) => asUser(u, who, "select public.claim_room_pairing($1,$2) as id", [code, room]);
  const device = async (room) => (await c.query("select * from room_devices where facility_id=$1", [room])).rows[0];

  // ---- a new door gets a code ----
  const K1 = hash("door one"), K2 = hash("door two");
  const first = await poll(K1);
  check("a new door gets a 6-digit code", first.paired === false && /^\d{6}$/.test(first.code), first.code);
  check("the code stays the same while the door keeps asking", (await poll(K1)).code === first.code);
  check("the server stores no key, only the hash", (await c.query("select key_hash from room_pairings")).rows[0].key_hash === K1);
  let threw = false;
  try { await poll("not-a-hash"); } catch { threw = true; }
  check("a malformed hash is refused", threw);

  // ---- who can claim ----
  check("a student cannot claim a code", !(await claim(STUDENT, first.code, roomA)).ok);
  check("a manager cannot claim a code", !(await claim(MANAGER, first.code, roomA)).ok);
  check("the code still works after those refusals", (await poll(K1)).code === first.code);
  check("a wrong code is refused", !(await claim(ADMIN, first.code === "000000" ? "000001" : "000000", roomA)).ok);

  // ---- admin connects the room ----
  const ok = await claim(ADMIN, first.code, roomA);
  check("an admin connects a room with the code", ok.ok && !!ok.rows[0].id, ok.error);
  const dev = await device(roomA);
  check("the device row holds the door's hash", dev.key_hash === K1 && dev.active && dev.label === "Room A door");
  const after = await poll(K1);
  check("the door now learns its device id", after.paired === true && after.device_id === dev.id && after.room === "Room A door");
  check("being connected gives no code", after.code === undefined);
  check("asking marks the device as seen", !!(await device(roomA)).last_seen_at);
  check("the code cannot be used twice", !(await claim(ADMIN, first.code, roomB)).ok);
  check("the code is gone from the waiting list", (await c.query("select count(*)::int n from room_pairings")).rows[0].n === 0);

  // ---- door type comes from the device, not the admin ----
  const realBoard = await poll(K2, "mqtt");
  check("door type is remembered from the device", (await c.query("select connection from room_pairings where key_hash=$1", [K2])).rows[0].connection === "mqtt");
  const odd = await poll(hash("odd"), "anything");
  check("an unknown door type falls back to simulated", (await c.query("select connection from room_pairings where key_hash=$1", [hash("odd")])).rows[0].connection === "wokwi" && !!odd.code);

  // ---- replace the device on a connected room ----
  await c.query("update room_devices set last_seen_at=now() where id=$1", [dev.id]);
  const rep = await claim(ADMIN, realBoard.code, roomA);
  const dev2 = await device(roomA);
  check("replacing keeps the same device id and history", rep.ok && dev2.id === dev.id);
  check("replacing stores the new hash and type", dev2.key_hash === K2 && dev2.connection === "mqtt");
  check("replacing clears last seen, so Online means the new door", dev2.last_seen_at === null);
  const old = await poll(K1);
  check("the old door falls back to showing a code", old.paired === false && /^\d{6}$/.test(old.code));

  // ---- disconnect and connect elsewhere ----
  await c.query("update room_devices set active=false where id=$1", [dev.id]);
  const off = await poll(K2);
  check("a disconnected door shows a code again", off.paired === false && !!off.code);
  check("the same door can be connected to another room", (await claim(ADMIN, off.code, roomB)).ok);
  check("its old room's row stays disabled, history kept", (await device(roomA)).active === false);

  // ---- expiry ----
  const K3 = hash("door three");
  const exp = await poll(K3);
  await c.query("update room_pairings set expires_at=now()-interval '1 minute' where key_hash=$1", [K3]);
  check("an expired code cannot be claimed", !(await claim(ADMIN, exp.code, roomA)).ok);
  const again = await poll(K3);
  check("the door gets a working code on its next ask", !!again.code);
  await c.query("delete from room_pairings");

  // ---- flood limit ----
  for (let i = 0; i < 200; i++) await poll(hash(`flood ${i}`));
  check("waiting doors are capped at 200", (await c.query("select count(*)::int n from room_pairings")).rows[0].n === 200);
  const over = await poll(hash("one too many"));
  check("past the cap a door gets no code", over.paired === false && over.code === null);
  check("a door already waiting keeps its code", !!(await poll(hash("flood 7"))).code);
  await c.query("delete from room_pairings");

  // ---- direct access ----
  await poll(hash("private"));
  check("a student cannot read the waiting list", !(await asUser(u, STUDENT, "select * from room_pairings")).ok);
  check("an admin cannot read it directly either", !(await asUser(u, ADMIN, "select * from room_pairings")).ok);
  check("a signed-in user cannot call the device function", !(await asUser(u, ADMIN, "select public.room_pair_poll($1)", [hash("x")])).ok);
  const anon = await (async () => {
    await u.query("begin"); await u.query("set local role anon");
    try { await u.query("select public.claim_room_pairing('123456',$1)", [roomA]); await u.query("commit"); return true; }
    catch { await u.query("rollback"); return false; }
  })();
  check("a visitor cannot call the claim function", !anon);
  const sr = await (async () => {
    await u.query("begin"); await u.query("set local role service_role");
    try { const r = await u.query("select public.room_pair_poll($1) as r", [hash("service")]); await u.query("commit"); return r.rows[0].r; }
    catch (e) { await u.query("rollback"); return { error: e.message }; }
  })();
  check("the service role can call the device function", !!sr.code, sr.error);
} finally {
  await u.end().catch(() => {});
  await stop();
}
console.log(`\n${total - failed}/${total} passed`);
process.exit(failed ? 1 : 0);
