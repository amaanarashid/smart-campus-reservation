/**
 * A throwaway local Postgres 17 with the app's real migrations applied, plus
 * small stand-ins for what Supabase provides (auth.uid(), the anon /
 * authenticated / service_role roles, pg_cron, the realtime publication).
 * Used by the evaluation scripts; nothing here touches the live database.
 */
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const SUPA = join(dirname(fileURLToPath(import.meta.url)), "../../supabase/");
export const MIGRATIONS = [
  "setup-all.sql", "upgrade-recommender.sql", "fix-role-escalation.sql", "upgrade-auto-release.sql",
  "upgrade-room-access.sql", "upgrade-room-end.sql", "upgrade-room-reports.sql", "fix-room-reports-insert.sql",
  "upgrade-room-commands.sql", "upgrade-realtime.sql", "upgrade-room-connect.sql", "upgrade-private-bookings.sql",
  "upgrade-booking-rules.sql", "upgrade-access-limits.sql",
];
export const PORT = 5499;
export const CONN = { host: "localhost", port: PORT, user: "postgres", password: "pw", database: "postgres" };

export async function startDb(dir = "/tmp/campus-eval-pg") {
  rmSync(dir, { recursive: true, force: true });
  const db = new EmbeddedPostgres({ databaseDir: dir, user: "postgres", password: "pw", port: PORT, persistent: false, onLog: () => {} });
  await db.initialise(); await db.start();
  const c = new pg.Client(CONN); await c.connect();
  await c.query(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create schema cron; create table cron.job(jobid serial, jobname text, schedule text, command text, active boolean default true);
    create function cron.schedule(n text, s text, c text) returns int language sql as $$ insert into cron.job(jobname,schedule,command) values(n,s,c) returning jobid $$;
    create function cron.unschedule(n text) returns boolean language sql as $$ delete from cron.job where jobname=n returning true $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    grant execute on function auth.uid() to anon, authenticated;
    create publication supabase_realtime;
    alter default privileges in schema public grant select, insert, update, delete on tables to authenticated;
    alter default privileges in schema public grant select on tables to anon;`);
  for (const f of MIGRATIONS) {
    await c.query(readFileSync(SUPA + f, "utf8").replace(/create extension if not exists pg_cron;/g, ""));
  }
  return { db, c, stop: async () => { await c.end(); await db.stop(); } };
}

/** Run one statement as a signed-in user (role authenticated, auth.uid() = uid) on its own connection. */
export async function asUser(client, uid, sql, params = []) {
  await client.query("begin");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [uid]);
  await client.query("set local role authenticated");
  try { const r = await client.query(sql, params); await client.query("commit"); return { ok: true, rows: r.rows }; }
  catch (e) { await client.query("rollback"); return { ok: false, error: e.message, code: e.code }; }
}
