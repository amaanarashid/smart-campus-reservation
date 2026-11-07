/**
 * Train the no-show model on the LIVE data (objective 5).
 *
 *   npx tsx scripts/eval/noshow-train.ts            # trains, may store a new model
 *   npx tsx scripts/eval/noshow-train.ts --dry-run  # trains and reports, stores nothing
 *
 * Reads finished bookings with the service role from .env.local
 * (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY - never printed),
 * splits by time (oldest 80% train, newest 20% test; never random), compares
 * with three baselines (campus rate, student rate, room type rate), and
 * inserts a new noshow_model row only if it beats the student-rate baseline
 * on test AUC. With fewer than 200 labelled bookings or 20 no-shows it stays
 * in baseline mode. Same code as the admin "Retrain" button
 * (src/lib/noshow-server.ts). Writes docs/evaluation/noshow.json.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { retrain } from "../../src/lib/noshow-server";

function env(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(".env.local")) return out;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
  return out;
}

const e = { ...env(), ...process.env } as Record<string, string | undefined>;
const url = e.NEXT_PUBLIC_SUPABASE_URL, key = e.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Need NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.");
  process.exit(1);
}
const dryRun = process.argv.includes("--dry-run");
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const nowMs = Date.now();
const { result: r, stored, version, note } = await retrain(db, nowMs, { dryRun });

const out = {
  label: "LIVE data",
  generated_by: "scripts/eval/noshow-train.ts",
  run_at: new Date(nowMs).toISOString(),
  dry_run: dryRun,
  mode: r.mode,
  labelled: r.n_labelled, no_shows: r.n_noshow,
  cold_start_rule: "logistic model needs >= 200 labelled bookings and >= 20 no-shows; otherwise baseline",
  split: { method: "time-based: oldest 80% train, newest 20% test", n_train: r.n_train, n_test: r.n_test, test_from: r.split_at },
  lambda: r.lambda,
  test: r.test,
  beats_user_rate: r.beats_user_rate,
  stored, version, note,
};
mkdirSync("docs/evaluation", { recursive: true });
writeFileSync("docs/evaluation/noshow.json", JSON.stringify(out, null, 2));

const f = (s: { auc: number | null; brier: number } | null) => s ? `AUC ${s.auc === null ? "n/a" : s.auc.toFixed(3)}  Brier ${s.brier.toFixed(4)}` : "-";
console.log(`LIVE: ${r.n_labelled} labelled bookings, ${r.n_noshow} no-shows, mode ${r.mode}`);
console.log(`  logistic     ${f(r.test.logreg)}`);
console.log(`  baseline     ${f(r.test.baseline)}`);
console.log(`  user rate    ${f(r.test.user_rate)}`);
console.log(`  category     ${f(r.test.category)}`);
console.log(`  campus rate  ${f(r.test.campus)}`);
console.log(note + (stored ? ` Stored as version ${version}.` : ""));
console.log("wrote docs/evaluation/noshow.json");
