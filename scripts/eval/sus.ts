/**
 * Score the user study's SUS questionnaires.
 *
 *   npx tsx scripts/eval/sus.ts docs/evaluation/sus-responses.csv
 *
 * CSV columns: participant,role,q1,...,q10  (answers 1-5, header row first).
 * Prints and saves docs/evaluation/sus-results.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { susScore, susSummary, SUS_ITEMS } from "../../src/lib/sus";

const file = process.argv[2] ?? "docs/evaluation/sus-responses.csv";
const lines = readFileSync(file, "utf8").trim().split(/\r?\n/).filter((l) => l.trim() && !l.startsWith("#"));
const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
const qi = Array.from({ length: 10 }, (_, i) => header.indexOf(`q${i + 1}`));
if (qi.some((i) => i < 0)) throw new Error("CSV needs columns q1..q10");
const rows = lines.slice(1).map((l) => l.split(",").map((c) => c.trim()));
const roleIdx = header.indexOf("role");
const responses = rows.map((r) => qi.map((i) => Number(r[i])));
const all = susSummary(responses);
const byRole: Record<string, ReturnType<typeof susSummary>> = {};
if (roleIdx >= 0) for (const role of new Set(rows.map((r) => r[roleIdx]))) {
  const sub = rows.filter((r) => r[roleIdx] === role).map((r) => qi.map((i) => Number(r[i])));
  if (sub.length) byRole[role] = susSummary(sub);
}
writeFileSync("docs/evaluation/sus-results.json", JSON.stringify({ file, overall: all, by_role: byRole,
  per_participant: rows.map((r, k) => ({ participant: r[0], role: roleIdx >= 0 ? r[roleIdx] : null, score: susScore(responses[k]) })) }, null, 2));
console.log(`SUS: mean ${all.mean} (SD ${all.sd}, 95% CI ${all.ci95[0]}-${all.ci95[1]}), median ${all.median}, n = ${all.n}`);
console.log(`Above ${all.target}: ${all.aboveTarget}/${all.n}. Objective 5 target (mean > 68): ${all.mean > 68 ? "MET" : "NOT MET"}`);
for (const [role, s] of Object.entries(byRole)) console.log(`  ${role}: mean ${s.mean} (n = ${s.n})`);
all.itemMeans.forEach((m, i) => console.log(`  Q${i + 1} ${m.toFixed(2)}  ${SUS_ITEMS[i]}`));
