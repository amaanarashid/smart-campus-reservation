/**
 * Objective 5: chatbot accuracy against a known-answer set (English + Malay).
 *
 *   npx tsx scripts/eval/chatbot-eval.ts
 *
 * The chatbot only ever answers from records it looks up, so its accuracy
 * depends on understanding the question correctly: the kind of question, the
 * facility, the day, the time and the language to answer in. This scores the
 * app's own understanding step (lib/chat-logic.ts + lib/chat-lang.ts, the
 * path used when no AI key is set and the floor under the AI path) on 38
 * questions written before the run. Expected answers are fixed for
 * "now" = Wednesday 21 Oct 2026, 09:00 Malaysia time.
 * Writes docs/evaluation/chatbot.json and chatbot.md.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { parseIntent, matchFacilities, type IntentKind, type PartOfDay } from "../../src/lib/chat-logic";
import { detectLanguage, type Lang } from "../../src/lib/chat-lang";
import { myAt } from "../../src/lib/time";

const NOW = myAt("2026-10-21", "09:00");
type F = { id: string; name: string; category_id: string; category_name: string; type: string; venue: string };
const f = (id: string, name: string, cat: string, type: string, venue: string): F => ({ id, name, category_id: type, category_name: cat, type, venue });
const FAC: F[] = [
  f("b1", "Court 1", "Badminton", "badminton", "Sport Hall"), f("b2", "Court 2", "Badminton", "badminton", "Sport Hall"),
  f("b3", "Court 3", "Badminton", "badminton", "Sport Hall"), f("b4", "Court 4", "Badminton", "badminton", "Sport Hall"),
  f("s1", "Court 1", "Futsal", "futsal", "Sports Complex"), f("k1", "Court 1", "Basketball", "basketball", "Sports Complex"),
  f("d1", "Room A", "Discussion Room", "discussion_room", "Library"), f("d2", "Room B", "Discussion Room", "discussion_room", "Library"),
  f("d3", "Room C", "Discussion Room", "discussion_room", "Library"),
  f("e1", "Hall 1", "Event Hall", "event_hall", "Block A"), f("m1", "Room 1", "Meeting Room", "meeting_room", "Block B"),
];
const B = ["b1", "b2", "b3", "b4"], D = ["d1", "d2", "d3"];

interface Case { q: string; lang: Lang; intent: IntentKind; fac?: string[]; date?: string; hour?: number; part?: PartOfDay; heldOut?: boolean }
const CASES: Case[] = [
  // ---------------- English
  { q: "Is badminton court 2 free tomorrow?", lang: "en", intent: "availability", fac: ["b2"], date: "2026-10-22" },
  { q: "Can I book futsal court at 3pm today?", lang: "en", intent: "availability", fac: ["s1"], date: "2026-10-21", hour: 15 },
  { q: "Any discussion room available this evening?", lang: "en", intent: "availability", fac: D, date: "2026-10-21", part: "evening" },
  { q: "Is Discussion Room B free on Friday at 10am?", lang: "en", intent: "availability", fac: ["d2"], date: "2026-10-23", hour: 10 },
  { q: "What time does the event hall close?", lang: "en", intent: "rules", fac: ["e1"] },
  { q: "What is the cancellation policy for meeting rooms?", lang: "en", intent: "rules", fac: ["m1"] },
  { q: "How long can I book a basketball court for?", lang: "en", intent: "rules", fac: ["k1"] },
  { q: "Which facilities can I book?", lang: "en", intent: "list" },
  { q: "Show me all facilities", lang: "en", intent: "list" },
  { q: "When is my next booking?", lang: "en", intent: "mine" },
  { q: "What are my bookings this week?", lang: "en", intent: "mine" },
  { q: "Did I book anything tomorrow?", lang: "en", intent: "mine" },
  { q: "Is court 3 free on 28 oct?", lang: "en", intent: "availability", fac: ["b3"], date: "2026-10-28" },
  { q: "Book badminton for 2 hours tomorrow morning", lang: "en", intent: "availability", fac: B, date: "2026-10-22", part: "morning" },
  { q: "Is the basketball court free next Monday at 5pm?", lang: "en", intent: "availability", fac: ["k1"], date: "2026-10-26", hour: 17 },
  { q: "Where can I pay my fine?", lang: "en", intent: "other" },
  { q: "Can I bring food into the library?", lang: "en", intent: "other" },
  { q: "Is badminton court 1 available in the afternoon on Saturday?", lang: "en", intent: "availability", fac: ["b1"], date: "2026-10-24", part: "afternoon" },
  { q: "Who can book the meeting room?", lang: "en", intent: "rules", fac: ["m1"] },
  { q: "Is futsal free at 8pm tomorrow?", lang: "en", intent: "availability", fac: ["s1"], date: "2026-10-22", hour: 20 },
  // ---------------- Bahasa Melayu
  { q: "Gelanggang badminton 2 kosong esok?", lang: "ms", intent: "availability", fac: ["b2"], date: "2026-10-22" },
  { q: "Boleh saya tempah gelanggang futsal pukul 3 petang hari ini?", lang: "ms", intent: "availability", fac: ["s1"], date: "2026-10-21", hour: 15 },
  { q: "Ada bilik perbincangan kosong malam ini?", lang: "ms", intent: "availability", fac: D, date: "2026-10-21", part: "evening" },
  { q: "Bilik perbincangan B kosong hari Jumaat pukul 10 pagi?", lang: "ms", intent: "availability", fac: ["d2"], date: "2026-10-23", hour: 10 },
  { q: "Pukul berapa dewan acara tutup?", lang: "ms", intent: "rules", fac: ["e1"] },
  { q: "Apa polisi pembatalan bilik mesyuarat?", lang: "ms", intent: "rules", fac: ["m1"] },
  { q: "Berapa lama boleh tempah gelanggang bola keranjang?", lang: "ms", intent: "rules", fac: ["k1"] },
  { q: "Senaraikan kemudahan yang ada", lang: "ms", intent: "list" },
  { q: "Bila tempahan saya seterusnya?", lang: "ms", intent: "mine" },
  { q: "Tunjuk tempahan saya", lang: "ms", intent: "mine" },
  { q: "Gelanggang 3 kosong pada 28 okt?", lang: "ms", intent: "availability", fac: ["b3"], date: "2026-10-28" },
  { q: "Tempah badminton 2 jam esok pagi", lang: "ms", intent: "availability", fac: B, date: "2026-10-22", part: "morning" },
  { q: "Gelanggang bola keranjang kosong Isnin depan pukul 5 petang?", lang: "ms", intent: "availability", fac: ["k1"], date: "2026-10-26", hour: 17 },
  { q: "Di mana saya boleh bayar denda?", lang: "ms", intent: "other" },
  { q: "Gelanggang badminton 1 kosong petang Sabtu?", lang: "ms", intent: "availability", fac: ["b1"], date: "2026-10-24", part: "afternoon" },
  { q: "Futsal kosong pukul 8 malam esok?", lang: "ms", intent: "availability", fac: ["s1"], date: "2026-10-22", hour: 20 },
  { q: "Siapa boleh tempah bilik mesyuarat?", lang: "ms", intent: "rules", fac: ["m1"] },
  { q: "Boleh tempah dewan acara lusa?", lang: "ms", intent: "availability", fac: ["e1"], date: "2026-10-23" },
  // ---------------- held-out: written after the first run's fixes, before re-running; never used to tune
  { heldOut: true, q: "Are any badminton courts open tonight?", lang: "en", intent: "availability", fac: B, date: "2026-10-21", part: "evening" },
  { heldOut: true, q: "I want to reserve meeting room 1 on thursday at 2pm", lang: "en", intent: "availability", fac: ["m1"], date: "2026-10-22", hour: 14 },
  { heldOut: true, q: "what's the max booking length for discussion rooms", lang: "en", intent: "rules", fac: D },
  { heldOut: true, q: "Is the event hall available on 30 october?", lang: "en", intent: "availability", fac: ["e1"], date: "2026-10-30" },
  { heldOut: true, q: "list all the courts", lang: "en", intent: "list" },
  { heldOut: true, q: "Show my reservations", lang: "en", intent: "mine" },
  { heldOut: true, q: "Is there a limit on how many futsal bookings I can have?", lang: "en", intent: "rules", fac: ["s1"] },
  { heldOut: true, q: "can staff only book the meeting room?", lang: "en", intent: "rules", fac: ["m1"] },
  { heldOut: true, q: "Ada gelanggang badminton kosong malam ini?", lang: "ms", intent: "availability", fac: B, date: "2026-10-21", part: "evening" },
  { heldOut: true, q: "Saya nak tempah bilik mesyuarat hari Khamis pukul 2 petang", lang: "ms", intent: "availability", fac: ["m1"], date: "2026-10-22", hour: 14 },
  { heldOut: true, q: "Berapa lama maksimum tempahan bilik perbincangan?", lang: "ms", intent: "rules", fac: D },
  { heldOut: true, q: "Dewan acara kosong pada 30 oktober?", lang: "ms", intent: "availability", fac: ["e1"], date: "2026-10-30" },
  { heldOut: true, q: "Senaraikan semua gelanggang", lang: "ms", intent: "list" },
  { heldOut: true, q: "Tunjuk semua tempahan saya", lang: "ms", intent: "mine" },
  { heldOut: true, q: "Ada had tempahan futsal?", lang: "ms", intent: "rules", fac: ["s1"] },
  { heldOut: true, q: "Gelanggang bola keranjang kosong lusa pukul 4 petang?", lang: "ms", intent: "availability", fac: ["k1"], date: "2026-10-23", hour: 16 },
];

const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));
type Field = "lang" | "intent" | "facility" | "date" | "time";
const tally: Record<Field, { ok: number; n: number }> = { lang: { ok: 0, n: 0 }, intent: { ok: 0, n: 0 }, facility: { ok: 0, n: 0 }, date: { ok: 0, n: 0 }, time: { ok: 0, n: 0 } };
const rows = CASES.map((c) => {
  const it = parseIntent(c.q, FAC, NOW);
  const lang = detectLanguage(c.q).lang;
  const got = matchFacilities(it.facility, FAC).map((x) => x.id);
  const checks: Partial<Record<Field, boolean>> = { lang: lang === c.lang, intent: it.intent === c.intent };
  if (c.fac) checks.facility = same(got, c.fac);
  if (c.date) checks.date = it.date === c.date;
  if (c.hour !== undefined || c.part) checks.time = (c.hour === undefined || it.hour === c.hour) && (!c.part || it.part_of_day === c.part);
  for (const [k, v] of Object.entries(checks) as [Field, boolean][]) { tally[k].n++; if (v) tally[k].ok++; }
  const allOk = Object.values(checks).every(Boolean);
  return { q: c.q, lang: c.lang, heldOut: !!c.heldOut, allOk, checks, got: { lang, intent: it.intent, facility: got, date: it.date, hour: it.hour, part: it.part_of_day } };
});

const pct = (o: { ok: number; n: number }) => (o.n ? (100 * o.ok / o.n).toFixed(1) : "-") + "%";
const main = rows.filter((r) => !r.heldOut), held = rows.filter((r) => r.heldOut);
const byLang = (l: Lang, set = main) => { const r = set.filter((x) => x.lang === l); return { ok: r.filter((x) => x.allOk).length, n: r.length }; };
const overall = { ok: main.filter((r) => r.allOk).length, n: main.length };
const heldOut = { ok: held.filter((r) => r.allOk).length, n: held.length };
// first run, before the vocabulary fixes (recorded from the original run of this script)
const FIRST_RUN = { ok: 31, n: 38, english: "18/20", malay: "13/18" };
mkdirSync("docs/evaluation", { recursive: true });
writeFileSync("docs/evaluation/chatbot.json", JSON.stringify({ generated_by: "scripts/eval/chatbot-eval.ts", now: NOW.toISOString(), first_run: FIRST_RUN, overall, english: byLang("en"), malay: byLang("ms"), held_out: heldOut, held_out_english: byLang("en", held), held_out_malay: byLang("ms", held), fields_all_questions: tally, rows }, null, 2));

const md = [
  "# Chatbot known-answer evaluation", "",
  "Generated by `scripts/eval/chatbot-eval.ts` (offline, deterministic). \"Now\" = Wed 21 Oct 2026 09:00 MYT.", "",
  "| Measure | Correct |", "|---|---|",
  `| First run (before fixing Malay sport words, "this evening", "who can book") | ${FIRST_RUN.ok}/${FIRST_RUN.n} (${pct(FIRST_RUN)}) - EN ${FIRST_RUN.english}, MS ${FIRST_RUN.malay} |`,
  `| Fully correct questions (main set, after fixes) | ${overall.ok}/${overall.n} (${pct(overall)}) |`,
  `| - English | ${byLang("en").ok}/${byLang("en").n} (${pct(byLang("en"))}) |`,
  `| - Bahasa Melayu | ${byLang("ms").ok}/${byLang("ms").n} (${pct(byLang("ms"))}) |`,
  `| **Held-out set** (new questions, never used to tune) | **${heldOut.ok}/${heldOut.n} (${pct(heldOut)})** - EN ${byLang("en", held).ok}/${byLang("en", held).n}, MS ${byLang("ms", held).ok}/${byLang("ms", held).n} |`,
  "", "Per field, all questions:", "", "| Field | Correct |", "|---|---|",
  ...(Object.keys(tally) as Field[]).map((k) => `| ${k} | ${tally[k].ok}/${tally[k].n} (${pct(tally[k])}) |`),
  "", "## Questions not fully correct", "",
  "| Question | Wrong field(s) | Understood as |", "|---|---|---|",
  ...rows.filter((r) => !r.allOk).map((r) => `| ${r.heldOut ? "(held-out) " : ""}${r.q} | ${Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k).join(", ")} | ${r.got.intent}; facility ${r.got.facility.join("/") || "-"}; date ${r.got.date ?? "-"}; hour ${r.got.hour ?? "-"}; part ${r.got.part ?? "-"}; lang ${r.got.lang} |`),
  "",
].join("\n");
writeFileSync("docs/evaluation/chatbot.md", md);
console.log(`Main set: ${overall.ok}/${overall.n} (${pct(overall)})  EN ${pct(byLang("en"))}  MS ${pct(byLang("ms"))}   |   held-out: ${heldOut.ok}/${heldOut.n} (${pct(heldOut)})`);
for (const k of Object.keys(tally) as Field[]) console.log(`  ${k.padEnd(9)} ${pct(tally[k])} (${tally[k].ok}/${tally[k].n})`);
for (const r of rows.filter((x) => !x.allOk)) console.log(`  x ${r.q}  -> ${JSON.stringify(r.got)}  wrong: ${Object.entries(r.checks).filter(([, v]) => !v).map(([k]) => k)}`);
