/**
 * Objective 5 (usability, no participants): KLM-GOMS task-time predictions for
 * the main tasks, following the click paths of the current UI
 * (src/app/student/page.tsx, facility-manager, admin wizards). Also compares
 * design alternatives: suggestion cards vs retrying by hand, the chatbot vs
 * checking rooms one by one, and the chip/preset booking form vs a typical
 * free-text booking form.
 *
 *   npx tsx scripts/eval/klm.ts
 *
 * Output: docs/evaluation/usability/klm.json + klm.md
 * Assumed system response times (not measured on the live site):
 *   UI step 0 s, booking request 0.5 s, chatbot answer 1.5 s.
 */
import fs from "node:fs";
import path from "node:path";
import { KLM, click, clickAgain, read, taskTime, type, type Step, type Op } from "../../src/lib/klm";

const R_BOOK = 0.5, R_CHAT = 1.5;

/** Shared prefix: Book tab is open after login. Pick place, room, then the time. */
const pickCourt: Step[] = [
  click("Pick the place: 'Sports Complex' card"),
  click("Pick the room: 'Court 2' card"),
];
const setTime: Step[] = [
  click("Day: 'Tomorrow' chip"),
  click("Open the 'Start time' list"),
  click("Choose '5:00 pm'"),
  // 1 h is the default length: nothing to do
  click("People: '+' (2 -> 3)"),
  clickAgain("People: '+' again (3 -> 4)"),
];

const TASKS: { id: string; name: string; steps: Step[]; note?: string }[] = [
  {
    id: "T1", name: "Book a badminton court tomorrow 5-6 pm for 4 people",
    steps: [...pickCourt, ...setTime, click("'Request this time'", R_BOOK), read("Read the confirmation")],
  },
  {
    id: "T1-form", name: "Same booking on a typical free-text form (comparison design)",
    note: "A conventional form: facility drop-down, typed date and times, typed group size. Clashes are only found after submitting.",
    steps: [
      click("Open the facility drop-down"), click("Choose 'Badminton Court 2'"),
      click("Click the date field"), type("08/11/2026", "Type the date", { enter: false }),
      { ops: "H M P B B", note: "Hand to mouse, click the start-time field" }, type("17:00", "Type the start time", { enter: false }),
      { ops: "H M P B B", note: "Click the end-time field" }, type("18:00", "Type the end time", { enter: false }),
      { ops: "H M P B B", note: "Click the group-size field" }, type("4", "Type the group size", { enter: false, handBack: true }),
      click("Submit", R_BOOK), read("Read the result"),
    ],
  },
  {
    id: "T2-suggest", name: "Time is taken: book an AI suggestion",
    note: "Starts after the failed request in T1. The suggestion cards appear in place.",
    steps: [read("Read why it failed and scan the ranked alternatives"), click("Click the best suggestion card (books it)", R_BOOK), read("Read the confirmation")],
  },
  ...[1, 2, 3].map((k) => ({
    id: `T2-manual-${k}`, name: `Time is taken: retry by hand, success on try ${k}`,
    note: "Without suggestions the student guesses a new time and asks again; each failed try repeats the steps.",
    steps: Array.from({ length: k }, (_, i) => [
      read(`Try ${i + 1}: decide on another time`),
      click("Open the 'Start time' list"), click("Choose another time"),
      click("'Request this time'", R_BOOK), read("Read the result"),
    ]).flat(),
  })),
  {
    id: "T3-chat", name: "Is a discussion room free this evening? (chatbot)",
    steps: [click("Open 'Ask the assistant'"), type("Is a discussion room free this evening?", "Type the question + Enter", { wait: R_CHAT }), read("Read the answer (covers every room)")],
  },
  {
    id: "T3-browse", name: "Is a discussion room free this evening? (checking rooms by hand, 3 rooms)",
    note: "Pick the Library, then for each of the 3 rooms: open it, choose 7 pm, check, go back.",
    steps: [click("Pick the place: 'Library'"), ...[1, 2, 3].flatMap((i) => [
      click(`Open Room ${"ABC"[i - 1]}`), click("Open the 'Start time' list"), click("Choose '7:00 pm'"),
      click("'Request this time' (to see if it is free)", R_BOOK), read("Read the result"), click("Back to the rooms"),
    ])],
  },
  {
    id: "T4", name: "Cancel a booking",
    steps: [click("'My bookings' tab"), click("'Cancel' on the booking"), click("Confirm 'Yes, cancel'", R_BOOK), read("Read the confirmation")],
  },
  {
    id: "T5", name: "Get the door code for a booking",
    steps: [click("'My bookings' tab"), click("'Door code'", R_BOOK), read("Read the 6-digit code")],
  },
  {
    id: "T6", name: "Manager: approve a pending request",
    steps: [read("Find the request in the approval queue"), click("'Approve'", R_BOOK), read("See it move to the schedule")],
  },
  {
    id: "T7", name: "Admin: new facility type with 2 rooms (wizard)",
    steps: [
      click("'Facilities' tab"), click("'New facility'"),
      click("Step 1: pick the location card"), click("'Next'"),
      click("Step 2: pick a preset (e.g. 'Meeting Room')"), click("'Next'"),
      read("Step 3: check the preset rules"), click("Rooms: '+' (1 -> 2)"),
      click("'Create facility + 2 rooms'", R_BOOK), read("Read the confirmation"),
    ],
  },
];

// sensitivity: faster typists / Kieras' M; slower pointing
const VARIANTS: { name: string; t: Record<Op, number> }[] = [
  { name: "standard", t: { ...KLM } },
  { name: "expert (K 0.12, M 1.2)", t: { ...KLM, K: 0.12, M: 1.2 } },
  { name: "novice-ish (K 0.5, P 1.5)", t: { ...KLM, K: 0.5, P: 1.5 } },
];

const rows = TASKS.map((task) => ({
  id: task.id, name: task.name, note: task.note ?? null,
  ...taskTime(task.steps),
  variants: Object.fromEntries(VARIANTS.map((v) => [v.name, taskTime(task.steps, v.t).total])),
  steps: task.steps,
}));
const byId = Object.fromEntries(rows.map((r) => [r.id, r]));
const comparisons = [
  ["Booking form: chips/presets vs free-text form", "T1", "T1-form"],
  ["Clash recovery: suggestion vs 1 manual retry", "T2-suggest", "T2-manual-1"],
  ["Clash recovery: suggestion vs 2 manual retries", "T2-suggest", "T2-manual-2"],
  ["Clash recovery: suggestion vs 3 manual retries", "T2-suggest", "T2-manual-3"],
  ["Free-room question: chatbot vs checking 3 rooms", "T3-chat", "T3-browse"],
].map(([label, a, b]) => {
  const A = byId[a], B = byId[b];
  return { label, ours: a, other: b, ours_s: A.total, other_s: B.total, saved_s: Math.round((B.total - A.total) * 100) / 100, saved_pct: Math.round(((B.total - A.total) / B.total) * 1000) / 10,
    holds_in_all_variants: VARIANTS.every((v) => A.variants[v.name] < B.variants[v.name]) };
});

const out = { generated: new Date().toISOString(), method: "KLM-GOMS (Card, Moran & Newell 1983; Kieras 2001). Predictions for a practised user, desktop + mouse. No participants.",
  operators: KLM, assumed_system_s: { booking_request: R_BOOK, chatbot_answer: R_CHAT }, variants: VARIANTS, tasks: rows, comparisons };
const dir = "docs/evaluation/usability";
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "klm.json"), JSON.stringify(out, null, 2));

const md = [
  "# KLM-GOMS task times (predicted, no participants)", "",
  `Operators (s): K ${KLM.K}, P ${KLM.P}, B ${KLM.B}, H ${KLM.H}, M ${KLM.M}. Assumed system time: booking ${R_BOOK} s, chatbot ${R_CHAT} s.`, "",
  "| Task | Steps | M | P | Clicks | Keys | User (s) | System (s) | Total (s) |", "|---|---|---|---|---|---|---|---|---|",
  ...rows.map((r) => `| ${r.id}: ${r.name} | ${r.steps.length} | ${r.counts.M} | ${r.counts.P} | ${r.counts.B / 2} | ${r.counts.K} | ${r.user} | ${r.system} | **${r.total}** |`),
  "", "## Design comparisons", "", "| Comparison | Ours (s) | Other (s) | Saved | Holds for expert and slower users? |", "|---|---|---|---|---|",
  ...comparisons.map((c) => `| ${c.label} | ${c.ours_s} | ${c.other_s} | ${c.saved_s} s (${c.saved_pct}%) | ${c.holds_in_all_variants ? "yes" : "no"} |`),
  "", "Each task's step-by-step operator list is in klm.json.", "",
].join("\n");
fs.writeFileSync(path.join(dir, "klm.md"), md);
console.log(md);
