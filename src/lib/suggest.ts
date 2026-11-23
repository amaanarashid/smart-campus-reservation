import type { ScoredSlot } from "./recommend";
import { PRIOR_THETA, theta, type BanditState } from "./bandit";
import { myWholeHour } from "./time";

/**
 * Presentation logic for slot suggestions: what to offer before the student
 * has asked for a time, and how to explain a suggestion in plain words.
 *
 * Nothing here changes how slots are scored (./recommend) or ranked
 * (./bandit); it reads their outputs. The explanation shows the five context
 * features of a slot and how much weight the student's model currently gives
 * each one. It deliberately shows no percentage: the ranking score is an upper
 * confidence bound, not a probability that the student will like the slot.
 */

// ------------------------------------------------------------ usual hour --

/**
 * The hour of day this student usually books, from their own bookings, or
 * null when there is too little history to say. Used as the preferred hour
 * for suggestions shown before the student has picked a time.
 *
 * The most common Malaysia hour wins; ties go to the hour booked most
 * recently. Declined bookings and ones the student cancelled are ignored.
 */
export function usualHour(
  bookings: { start_time: string; status: string }[],
  minBookings = 3
): number | null {
  const kept = bookings.filter((b) => b.status === "approved" || b.status === "pending");
  if (kept.length < minBookings) return null;

  const count = new Map<number, number>();
  const latest = new Map<number, number>();
  for (const b of kept) {
    const t = new Date(b.start_time);
    if (Number.isNaN(t.getTime())) continue;
    const h = myWholeHour(t);
    count.set(h, (count.get(h) ?? 0) + 1);
    latest.set(h, Math.max(latest.get(h) ?? 0, t.getTime()));
  }
  let best: number | null = null;
  for (const [h, n] of count) {
    if (best === null) { best = h; continue; }
    const bn = count.get(best)!;
    if (n > bn || (n === bn && latest.get(h)! > latest.get(best)!)) best = h;
  }
  return best;
}

// ------------------------------------------------------------- diversity --

/**
 * Keep the ranking order but drop slots that overlap a better one in the same
 * room, so a short list is not three versions of the same hour (2:00, 2:30,
 * 3:00). Input must already be ranked best first.
 */
export function diversify<T extends Pick<ScoredSlot, "facilityId" | "start" | "end">>(
  ranked: T[],
  limit: number
): T[] {
  const out: T[] = [];
  for (const s of ranked) {
    if (out.length >= limit) break;
    const clash = out.some((o) => o.facilityId === s.facilityId && o.start < s.end && s.start < o.end);
    if (!clash) out.push(s);
  }
  return out;
}

// ----------------------------------------------------------- explanation --

export type FactorKey = "time" | "capacity" | "offpeak" | "same_facility" | "day";

export interface Factor {
  key: FactorKey;
  label: string;
  /** How well this slot does on the factor, 0-1 (the context feature). */
  value: number;
  /** What that value means for this slot, in plain words. */
  detail: string;
  /** The model's current weight for the factor (theta). */
  weight: number;
  /** Share of this student's total weight, 0-1, for showing "matters most". */
  weightShare: number;
  /** weight x value: what the factor adds to the predicted acceptance. */
  contribution: number;
}

const LABELS: Record<FactorKey, string> = {
  time: "Time",
  capacity: "Room size",
  offpeak: "Quiet hour",
  same_facility: "Same room",
  day: "Same day",
};
const KEYS: FactorKey[] = ["time", "capacity", "offpeak", "same_facility", "day"];

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function detailFor(key: FactorKey, v: number, hasPreferredHour: boolean): string {
  switch (key) {
    case "time": {
      if (!hasPreferredHour) return "no usual time known yet";
      const hours = Math.round((1 - v) * 8 * 2) / 2;
      if (hours === 0) return "the time you want";
      return `${hours === 0.5 ? "30 min" : plural(hours, "hour")} from the time you want`;
    }
    case "capacity":
      return v >= 1 ? "fits your group well" : "bigger than your group needs";
    case "offpeak":
      return v >= 1 ? "usually a quiet hour" : "usually a busy hour";
    case "same_facility":
      return v >= 1 ? "the room you picked" : "another room of the same type";
    case "day": {
      const later = Math.round(1 / Math.max(v, 1e-6) - 1);
      return later <= 0 ? "the day you picked" : `${plural(later, "day")} later`;
    }
  }
}

/**
 * Break a suggestion into its five factors, most influential first.
 *
 * `features` is the slot's context vector [1, T, C, U, S, A]. With no bandit
 * state the prior weights are used, which is exactly what ranks a new
 * student's list.
 */
export function explainSlot(
  slot: Pick<ScoredSlot, "features">,
  bandit: BanditState | null,
  opts: { hasPreferredHour?: boolean } = {}
): Factor[] {
  const hasPreferredHour = opts.hasPreferredHour ?? true;
  const th = bandit ? theta(bandit) : PRIOR_THETA;
  const weights = KEYS.map((_, i) => th[i + 1]);
  const total = weights.reduce((s, w) => s + Math.max(0, w), 0);

  return KEYS.map((key, i) => {
    const value = Math.min(1, Math.max(0, slot.features[i + 1] ?? 0));
    const weight = weights[i];
    return {
      key,
      label: LABELS[key],
      value,
      detail: detailFor(key, value, hasPreferredHour),
      weight,
      weightShare: total > 0 ? Math.max(0, weight) / total : 0,
      contribution: weight * value,
    };
  }).sort((a, b) => b.contribution - a.contribution);
}

// ------------------------------------------------------- learning status --

export interface LearningSummary {
  /** Feedback observations the model has absorbed (accepted + passed over). */
  observations: number;
  personalised: boolean;
  /** Factor whose weight has risen most above the starting value, if any. */
  leaning: FactorKey | null;
  text: string;
}

/** Below this many observations the list is still essentially the default. */
export const MIN_PERSONALISED = 3;
/** A weight must move at least this far from its prior to be called a leaning. */
const LEANING_MIN_SHIFT = 0.02;

const LEANING_TEXT: Record<FactorKey, string> = {
  time: "you tend to keep to the time you asked for",
  capacity: "you tend to pick rooms that fit your group",
  offpeak: "you tend to pick quiet hours",
  same_facility: "you tend to stay in the room you picked",
  day: "you tend to stay on the day you picked",
};

/**
 * One honest line about how personal the ranking is. `observations` counts
 * every suggestion the model learned from - the one booked and the ones
 * ranked above it that were passed over - not the number of bookings.
 */
export function learningSummary(bandit: BanditState | null): LearningSummary {
  const n = bandit?.n ?? 0;
  if (!bandit || n < MIN_PERSONALISED) {
    return {
      observations: n,
      personalised: false,
      leaning: null,
      text: n === 0
        ? "Using campus defaults. This list adapts as you book suggested times."
        : "Still learning your preferences - mostly campus defaults for now.",
    };
  }
  const th = theta(bandit);
  let leaning: FactorKey | null = null;
  let bestShift = LEANING_MIN_SHIFT;
  KEYS.forEach((key, i) => {
    const shift = th[i + 1] - PRIOR_THETA[i + 1];
    if (shift > bestShift) { bestShift = shift; leaning = key; }
  });
  const basis = `Adapted from ${plural(n, "suggestion")} you booked or skipped`;
  return {
    observations: n,
    personalised: true,
    leaning,
    text: leaning ? `${basis}: ${LEANING_TEXT[leaning as FactorKey]}.` : `${basis}.`,
  };
}

/** "2 pm" for the header line. */
export function hourLabel(h: number): string {
  return `${h % 12 || 12} ${h < 12 ? "am" : "pm"}`;
}
