import { Facility, FacilityRule, Reservation, RecWeights } from "./types";
import { addDays, daysBetween, myAt, myDateKey, myHour, myWholeHour } from "./time";

/**
 * Slot recommender.
 *
 * Given a request that cannot be met as asked, produce ranked alternatives.
 * A candidate is any (facility, start time) that satisfies every rule of that
 * facility, so the search space is the candidate set I(r) of the allocation
 * model in the report: the same facility at other times, other facilities of
 * the same category, and - if the requested day is completely full - the
 * following days.
 *
 * All times are Malaysia time via ./time, so this gives the same answer in the
 * browser and on the server.
 */

export interface ScoredSlot {
  start: Date;
  end: Date;
  score: number;
  reasons: string[];
  facilityId: string;
  facilityName: string;
  /** Malaysia calendar date of the slot, YYYY-MM-DD. */
  dateKey: string;
  /**
   * Context vector for the bandit ranker, [1, T, C, U, S, A]:
   *   T time proximity, C capacity fit, U off-peak, S same facility as asked,
   *   A day proximity (1 for the requested day, 1/2 next day, 1/3 after).
   */
  features: number[];
}

export const DEFAULT_WEIGHTS: RecWeights = { time: 0.5, capacity: 0.3, offpeak: 0.2 };

/** Baseline penalties for moving the student away from what they asked for. */
const OTHER_FACILITY_FACTOR = 0.95;
const PER_DAY_FACTOR = 0.1;

// ------------------------------------------------------------ peak hours --

export interface PeakModel {
  /** Malaysia hours of day (0-23) treated as peak. */
  hours: number[];
  /** False when the defaults are in use because history was too thin. */
  learned: boolean;
  /** Number of bookings the model was estimated from. */
  basis: number;
}

/** Campus defaults: lunch 12:00-14:00 and evening 17:00-20:00. */
export const DEFAULT_PEAK_HOURS = [12, 13, 17, 18, 19];
export const DEFAULT_PEAKS: PeakModel = { hours: DEFAULT_PEAK_HOURS, learned: false, basis: 0 };

export function isPeak(d: Date, peaks: PeakModel = DEFAULT_PEAKS): boolean {
  return peaks.hours.includes(myWholeHour(d));
}

/**
 * Learn peak hours from booking history instead of assuming them.
 *
 * Every live booking contributes its booked minutes to each Malaysia hour of
 * day it covers. An hour is peak when its load is at or above the q-quantile
 * of the hours that saw any use at all - by default the busiest quarter. With
 * fewer than `minBookings` bookings the estimate would be noise, so the
 * campus defaults are kept and `learned` is false.
 *
 * Malaysia is a whole-hour offset from UTC, so Malaysia hour boundaries fall
 * on UTC hour boundaries and the arithmetic below is exact.
 */
export function learnPeakHours(
  history: Pick<Reservation, "start_time" | "end_time" | "status">[],
  opts: { minBookings?: number; quantile?: number } = {}
): PeakModel {
  const minBookings = opts.minBookings ?? 30;
  const q = opts.quantile ?? 0.75;

  const live = history.filter((r) => r.status === "approved" || r.status === "pending");
  if (live.length < minBookings) return { ...DEFAULT_PEAKS, basis: live.length };

  const HOUR = 3_600_000;
  const load = new Array<number>(24).fill(0);
  for (const r of live) {
    let t = new Date(r.start_time).getTime();
    const end = new Date(r.end_time).getTime();
    if (!(end > t)) continue;
    while (t < end) {
      const boundary = t - (t % HOUR) + HOUR;
      const stop = Math.min(end, boundary);
      load[myWholeHour(new Date(t))] += (stop - t) / 60_000;
      t = stop;
    }
  }

  const used = load.filter((v) => v > 0).sort((a, b) => a - b);
  if (used.length === 0) return { ...DEFAULT_PEAKS, basis: live.length };

  const threshold = used[Math.floor(q * (used.length - 1))];
  const hours = load.flatMap((v, h) => (v > 0 && v >= threshold ? [h] : []));
  return { hours, learned: true, basis: live.length };
}

// ---------------------------------------------------- single facility, day --

export interface SlotRequest {
  facility: Facility;
  rule: FacilityRule;
  /** Bookings for this facility; anything not pending/approved is ignored. */
  reservations: Reservation[];
  /** Day to search. A Date is read as its Malaysia calendar date. */
  date: Date | string;
  durationMins: number;
  participants: number;
  /** Hour the student asked for, 0-23, or null for no preference. */
  preferredHour: number | null;
  weights?: RecWeights;
  peaks?: PeakModel;
  now?: Date;
  /** Facility the student originally asked for. Defaults to this one. */
  requestedFacilityId?: string;
  /** Day the student originally asked for. Defaults to this one. */
  requestedDate?: string;
}

function overlaps(aS: Date, aE: Date, bS: Date, bE: Date): boolean {
  return aS < bE && bS < aE;
}

/**
 * Every feasible slot for one facility on one day, ranked. Deterministic and
 * explainable: every suggestion carries its reasons.
 */
export function recommendSlots(opts: SlotRequest): { slots: ScoredSlot[]; rejectedReason?: string } {
  const { facility, rule, reservations, durationMins, participants } = opts;
  const weights = opts.weights ?? DEFAULT_WEIGHTS;
  const peaks = opts.peaks ?? DEFAULT_PEAKS;
  const now = opts.now ?? new Date();
  const dateKey = typeof opts.date === "string" ? opts.date : myDateKey(opts.date);
  const requestedFacilityId = opts.requestedFacilityId ?? facility.id;
  const requestedDate = opts.requestedDate ?? dateKey;

  // rules that reject the whole request
  if (facility.status !== "active")
    return { slots: [], rejectedReason: "Facility is not available for booking." };
  if (participants > facility.capacity)
    return { slots: [], rejectedReason: `Capacity is ${facility.capacity}; reduce the group size.` };
  if (durationMins > rule.max_duration_mins)
    return { slots: [], rejectedReason: `Maximum booking duration is ${rule.max_duration_mins} minutes.` };
  if (durationMins < rule.min_duration_mins)
    return { slots: [], rejectedReason: `Minimum booking duration is ${rule.min_duration_mins} minutes.` };

  const latestStart = new Date(now.getTime() + rule.max_advance_days * 86_400_000);
  if (myAt(dateKey, "00:00") > latestStart)
    return { slots: [], rejectedReason: `Bookings open ${rule.max_advance_days} days in advance.` };

  const dayOpen = myAt(dateKey, rule.open_time.slice(0, 5));
  const dayClose = myAt(dateKey, rule.close_time.slice(0, 5));
  const step = Math.max(5, rule.slot_minutes || 30) * 60_000;
  const dur = durationMins * 60_000;

  const busy = reservations
    .filter((r) => r.status === "pending" || r.status === "approved")
    .map((r) => ({ s: new Date(r.start_time), e: new Date(r.end_time) }));

  const S = facility.id === requestedFacilityId ? 1 : 0;
  const dayOffset = Math.max(0, daysBetween(requestedDate, dateKey));
  const A = 1 / (1 + dayOffset);
  const moveFactor = (S ? 1 : OTHER_FACILITY_FACTOR) * Math.max(0, 1 - PER_DAY_FACTOR * dayOffset);

  const slots: ScoredSlot[] = [];
  for (let t = dayOpen.getTime(); t + dur <= dayClose.getTime(); t += step) {
    const start = new Date(t);
    const end = new Date(t + dur);
    if (start < now) continue;
    if (start > latestStart) continue;
    if (busy.some((b) => overlaps(start, end, b.s, b.e))) continue;

    const reasons: string[] = [];

    // T: closeness to the preferred time, 1 when exact, falling 0.125 per hour
    let T = 0.5;
    if (opts.preferredHour !== null) {
      const dist = Math.abs(myHour(start) - opts.preferredHour);
      T = Math.max(0, 1 - dist / 8);
      if (dist <= 1) reasons.push("close to your preferred time");
    }

    // C: capacity fit, full marks once the group fills half the room
    const fill = participants / facility.capacity;
    const C = fill >= 0.5 ? 1 : 0.4 + 1.2 * fill;
    if (fill >= 0.5) reasons.push("good fit for your group size");

    // U: spreads demand away from peak hours
    const offPeak = !isPeak(start, peaks);
    const U = offPeak ? 1 : 0.3;
    if (offPeak) reasons.push("off-peak, likely quieter");

    if (!S) reasons.push("same type of facility");
    if (dayOffset > 0) reasons.push("nearest day with space");

    const base = weights.time * T + weights.capacity * C + weights.offpeak * U;
    slots.push({
      start,
      end,
      score: Math.round(base * moveFactor * 1000) / 1000,
      reasons,
      facilityId: facility.id,
      facilityName: facility.name,
      dateKey,
      features: [1, T, C, U, S, A],
    });
  }

  slots.sort((a, b) => b.score - a.score);
  return { slots };
}

// ------------------------------------------- across facilities and days --

export interface AcrossRequest {
  /** The facility the student asked for. */
  requested: Facility;
  /** Any facility list; only active ones in the same category are searched. */
  facilities: Facility[];
  rules: Record<string, FacilityRule>;
  /** Bookings covering every candidate over the whole search window. */
  reservations: Reservation[];
  /** Requested day, Malaysia date key. */
  date: string;
  durationMins: number;
  participants: number;
  preferredHour: number | null;
  weights?: RecWeights;
  peaks?: PeakModel;
  now?: Date;
  /** Extra days to try when the requested day has no space anywhere. */
  lookAheadDays?: number;
  limit?: number;
  /** Cap per facility, so one facility cannot crowd out the rest. */
  perFacility?: number;
}

export interface AcrossResult {
  slots: ScoredSlot[];
  searchedDays: string[];
  /** True when the requested day was full and later days were used. */
  usedLookAhead: boolean;
  rejectedReason?: string;
}

/**
 * Alternatives across every facility of the requested category, then across
 * the following days if the requested day is full everywhere.
 *
 * Each facility is checked against its own effective rules, so a court with
 * shorter hours or a lower capacity is handled correctly rather than assumed
 * to match the one the student picked.
 */
export function recommendAcross(opts: AcrossRequest): AcrossResult {
  const lookAhead = opts.lookAheadDays ?? 2;
  const limit = opts.limit ?? 6;
  const perFacility = opts.perFacility ?? 3;

  const candidates = [
    opts.requested,
    ...opts.facilities.filter(
      (f) => f.id !== opts.requested.id && f.category_id === opts.requested.category_id
    ),
  ].filter((f) => f.status === "active" && opts.rules[f.id]);

  const byFacility = new Map<string, Reservation[]>();
  for (const r of opts.reservations) {
    const list = byFacility.get(r.facility_id) ?? [];
    list.push(r);
    byFacility.set(r.facility_id, list);
  }

  const searchedDays: string[] = [];
  let found: ScoredSlot[] = [];
  let requestedReason: string | undefined;

  for (let offset = 0; offset <= lookAhead; offset++) {
    const day = addDays(opts.date, offset);
    searchedDays.push(day);

    for (const f of candidates) {
      const out = recommendSlots({
        facility: f,
        rule: opts.rules[f.id],
        reservations: byFacility.get(f.id) ?? [],
        date: day,
        durationMins: opts.durationMins,
        participants: opts.participants,
        preferredHour: opts.preferredHour,
        weights: opts.weights,
        peaks: opts.peaks,
        now: opts.now,
        requestedFacilityId: opts.requested.id,
        requestedDate: opts.date,
      });
      if (out.rejectedReason && f.id === opts.requested.id && offset === 0)
        requestedReason = out.rejectedReason;
      found = found.concat(out.slots);
    }

    if (found.length > 0) break;
  }

  found.sort((a, b) => b.score - a.score);
  const count = new Map<string, number>();
  const slots: ScoredSlot[] = [];
  for (const s of found) {
    const n = count.get(s.facilityId) ?? 0;
    if (n >= perFacility) continue;
    count.set(s.facilityId, n + 1);
    slots.push(s);
    if (slots.length >= limit) break;
  }

  return {
    slots,
    searchedDays,
    usedLookAhead: slots.length > 0 && slots[0].dateKey !== opts.date,
    rejectedReason:
      slots.length > 0
        ? undefined
        : requestedReason ??
          `No free ${opts.durationMins}-minute slots in the next ${lookAhead + 1} days.`,
  };
}

// ------------------------------------------------------ weight adaptation --

/**
 * Baseline adaptive layer: nudge weights toward the factors that were
 * satisfied by the slot the student accepted (online learning, lr = 0.05).
 * Weights always sum to 1. The bandit in ./bandit supersedes this for ranking;
 * this rule is kept as the baseline arm for evaluation.
 *
 * The update is multiplicative, not additive. A fixed additive bump followed
 * by renormalisation is worth more in relative terms to a small weight than to
 * a large one (0.05/0.2 = 25% against 0.05/0.5 = 10%), so the larger weight
 * lost share even when it was the one being rewarded. Scaling by (1 + lr)
 * grows every reinforced weight by the same proportion; after renormalisation
 * a weight gains share exactly when its factor beats the weighted mean of the
 * three. This is the exponentiated-gradient form of the update.
 *
 * `preferredHour` must be the hour the student ASKED for, not the hour of the
 * slot they accepted - otherwise the time factor is rewarded every time.
 */
export function updateWeights(
  current: RecWeights,
  accepted: Pick<ScoredSlot, "start" | "reasons">,
  preferredHour: number | null,
  peaks: PeakModel = DEFAULT_PEAKS
): RecWeights {
  const lr = 0.05;
  const likedTime =
    preferredHour !== null && Math.abs(myWholeHour(accepted.start) - preferredHour) <= 1;
  const likedOffpeak = !isPeak(accepted.start, peaks);
  const likedCapacity = accepted.reasons.includes("good fit for your group size");

  const time = current.time * (likedTime ? 1 + lr : 1);
  const offpeak = current.offpeak * (likedOffpeak ? 1 + lr : 1);
  // capacity fit is usually implicit in the choice, so it is reinforced at
  // half rate, and only when the accepted slot actually carried that reason.
  const capacity = current.capacity * (likedCapacity ? 1 + lr / 2 : 1);

  const sum = time + capacity + offpeak;
  return {
    time: +(time / sum).toFixed(3),
    capacity: +(capacity / sum).toFixed(3),
    offpeak: +(offpeak / sum).toFixed(3),
  };
}
