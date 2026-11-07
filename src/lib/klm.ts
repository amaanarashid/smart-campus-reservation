/**
 * Keystroke-Level Model (KLM-GOMS): predicts how long a practised user takes to
 * do a task by adding up standard operator times. It needs no participants, so
 * it is used here (objective 5, usability) alongside the accessibility audit and
 * the heuristic review, and to compare designs (e.g. suggestion cards vs
 * retrying by hand).
 *
 * Operator times: Card, Moran & Newell (1983), as summarised by Kieras (2001).
 *   K  keystroke, average non-secretary typist (~40 wpm)   0.28 s
 *   P  point with the mouse at a target                     1.10 s
 *   B  press OR release the mouse button (a click is B B)   0.10 s
 *   H  move a hand between mouse and keyboard              0.40 s
 *   M  mental preparation (find / decide)                  1.35 s
 * System response time (R) is NOT a user operator; tasks list it separately as
 * an assumption so it can be reported with and without.
 */
export const KLM = { K: 0.28, P: 1.1, B: 0.1, H: 0.4, M: 1.35 } as const;
export type Op = keyof typeof KLM;

export interface Step {
  /** Operators, space-separated; "K*12" repeats. Example: "M P B B". */
  ops: string;
  /** What the user does in the app (kept for the report table). */
  note: string;
  /** Assumed system response after this step, seconds. */
  wait?: number;
}

/** "M P B B K*3" -> ["M","P","B","B","K","K","K"]. Throws on unknown operators. */
export function parseOps(s: string): Op[] {
  const out: Op[] = [];
  for (const tok of s.trim().split(/\s+/).filter(Boolean)) {
    const m = tok.match(/^([KPBHM])(?:\*(\d+))?$/);
    if (!m) throw new Error(`Unknown KLM operator "${tok}"`);
    const n = m[2] ? Number(m[2]) : 1;
    for (let i = 0; i < n; i++) out.push(m[1] as Op);
  }
  return out;
}

export interface TaskTime {
  /** User time: sum of operator times (s). */
  user: number;
  /** Assumed system response time (s). */
  system: number;
  total: number;
  counts: Record<Op, number>;
  steps: number;
}

export function taskTime(steps: Step[], t: Record<Op, number> = KLM): TaskTime {
  const counts: Record<Op, number> = { K: 0, P: 0, B: 0, H: 0, M: 0 };
  let user = 0, system = 0;
  for (const s of steps) {
    for (const op of parseOps(s.ops)) { counts[op]++; user += t[op]; }
    system += s.wait ?? 0;
  }
  const r = (x: number) => Math.round(x * 100) / 100;
  return { user: r(user), system: r(system), total: r(user + system), counts, steps: steps.length };
}

// ------------------------------------------------------------- step helpers --
/** Find and click a new target: M P B B. */
export const click = (note: string, wait?: number): Step => ({ ops: "M P B B", note, wait });
/** Click the same target again (no new decision, no pointing): B B. */
export const clickAgain = (note: string, times = 1): Step => ({ ops: Array(times).fill("B B").join(" "), note });
/** Look at the screen and take in a result: M. */
export const read = (note: string): Step => ({ ops: "M", note });
/**
 * Type text into a field that already has focus, then press Enter:
 * H (hand to keyboard) + M (compose) + one K per character + K (Enter) [+ H back].
 */
export const type = (text: string, note: string, opts: { enter?: boolean; handBack?: boolean; wait?: number } = {}): Step => ({
  ops: ["H", "M", `K*${text.length}`, opts.enter === false ? "" : "K", opts.handBack ? "H" : ""].filter(Boolean).join(" "),
  note, wait: opts.wait,
});
