import { Facility, FacilityRule, Reservation, RecWeights } from "./types";

export interface ScoredSlot {
  start: Date;
  end: Date;
  score: number;
  reasons: string[];
}

export const DEFAULT_WEIGHTS: RecWeights = { time: 0.5, capacity: 0.3, offpeak: 0.2 };

/** Peak hours on campus: 12:00-14:00 and 17:00-20:00. */
function isOffPeak(d: Date): boolean {
  const h = d.getHours();
  return !(h >= 12 && h < 14) && !(h >= 17 && h < 20);
}

function overlaps(aS: Date, aE: Date, bS: Date, bE: Date): boolean {
  return aS < bE && bS < aE;
}

/**
 * Generate every feasible slot for a facility on a given day, applying the
 * facility's rules and existing reservations, then rank by weighted score.
 * Deterministic and explainable: every suggestion carries its reasons.
 */
export function recommendSlots(opts: {
  facility: Facility;
  rule: FacilityRule;
  reservations: Reservation[]; // pending + approved for that facility/day
  date: Date; // day to search (local)
  durationMins: number;
  participants: number;
  preferredHour: number | null; // e.g. 15 for 3pm, null = no preference
  weights?: RecWeights;
  now?: Date;
}): { slots: ScoredSlot[]; rejectedReason?: string } {
  const { facility, rule, reservations, date, durationMins, participants } = opts;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const now = opts.now ?? new Date();

  // rule checks that reject the whole request
  if (facility.status !== "active") return { slots: [], rejectedReason: "Facility is not available for booking." };
  if (participants > facility.capacity)
    return { slots: [], rejectedReason: `Capacity is ${facility.capacity}; reduce the group size.` };
  if (durationMins > rule.max_duration_mins)
    return { slots: [], rejectedReason: `Maximum booking duration is ${rule.max_duration_mins} minutes.` };
  const maxDay = new Date(now);
  maxDay.setDate(maxDay.getDate() + rule.max_advance_days);
  if (date > maxDay)
    return { slots: [], rejectedReason: `Bookings open ${rule.max_advance_days} days in advance.` };

  const [oh, om] = rule.open_time.split(":").map(Number);
  const [ch, cm] = rule.close_time.split(":").map(Number);
  const dayOpen = new Date(date); dayOpen.setHours(oh, om, 0, 0);
  const dayClose = new Date(date); dayClose.setHours(ch, cm, 0, 0);

  const busy = reservations
    .filter((r) => r.status === "pending" || r.status === "approved")
    .map((r) => ({ s: new Date(r.start_time), e: new Date(r.end_time) }));

  const slots: ScoredSlot[] = [];
  for (let t = new Date(dayOpen); ; t = new Date(t.getTime() + rule.slot_minutes * 60000)) {
    const end = new Date(t.getTime() + durationMins * 60000);
    if (end > dayClose) break;
    if (t < now) continue; // no past slots
    if (busy.some((b) => overlaps(t, end, b.s, b.e))) continue;

    const reasons: string[] = [];

    // T: closeness to preferred time (1 when exact, decays 0.125/hour away)
    let T = 0.5;
    if (opts.preferredHour !== null) {
      const dist = Math.abs(t.getHours() + t.getMinutes() / 60 - opts.preferredHour);
      T = Math.max(0, 1 - dist / 8);
      if (dist <= 1) reasons.push("close to your preferred time");
    }

    // C: capacity fit - full marks when the group uses >=50% of capacity
    const fill = participants / facility.capacity;
    const C = fill >= 0.5 ? 1 : 0.4 + 1.2 * fill;
    if (fill >= 0.5) reasons.push("good fit for your group size");

    // U: off-peak utilisation spreading
    const U = isOffPeak(t) ? 1 : 0.3;
    if (isOffPeak(t)) reasons.push("off-peak, likely quieter");

    const score = weights.time * T + weights.capacity * C + weights.offpeak * U;
    slots.push({ start: t, end, score: Math.round(score * 1000) / 1000, reasons });
  }

  slots.sort((a, b) => b.score - a.score);
  return { slots };
}

/**
 * Adaptive layer: nudge weights toward the factors that scored highly in the
 * slot the user actually accepted (simple online learning, lr = 0.05).
 * Keeps the model inspectable - weights always sum to 1.
 */
export function updateWeights(current: RecWeights, accepted: ScoredSlot, preferredHour: number | null): RecWeights {
  const lr = 0.05;
  const likedTime = preferredHour !== null &&
    Math.abs(accepted.start.getHours() - preferredHour) <= 1;
  const likedOffpeak = isOffPeak(accepted.start);

  let { time, capacity, offpeak } = current;
  if (likedTime) time += lr;
  if (likedOffpeak) offpeak += lr;
  capacity += lr / 2; // mild reinforcement; capacity fit is usually implicit

  const sum = time + capacity + offpeak;
  return {
    time: +(time / sum).toFixed(3),
    capacity: +(capacity / sum).toFixed(3),
    offpeak: +(offpeak / sum).toFixed(3),
  };
}
