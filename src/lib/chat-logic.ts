import type { Facility, FacilityRule, Reservation } from "./types";
import { addDays, fmtTime, myAt, myDateKey, myWeekday } from "./time";

/**
 * Pure logic behind the grounded chatbot: understanding the question,
 * carrying context across turns, matching facilities, and working out free
 * time. Nothing here touches the network or the database, so every rule can
 * be unit-tested.
 */

export type IntentKind = "availability" | "rules" | "list" | "mine" | "other";
export type PartOfDay = "morning" | "afternoon" | "evening";

export interface Intent {
  intent: IntentKind;
  /** Facility or category words found in the question, e.g. "badminton court 1". */
  facility: string | null;
  /** Malaysia date key. */
  date: string | null;
  part_of_day: PartOfDay | null;
  /** Hour asked for, 0-23. */
  hour: number | null;
  /** Duration asked for, in minutes. */
  duration: number | null;
}

export const EMPTY_INTENT: Intent = {
  intent: "other", facility: null, date: null, part_of_day: null, hour: null, duration: null,
};

type FacLike = Pick<Facility, "id" | "name" | "category_id" | "category_name" | "type">;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const has = (text: string, phrase: string) =>
  phrase.length > 0 && new RegExp(`(^|[^a-z0-9])${esc(phrase)}($|[^a-z0-9])`).test(text);

/** Words that name a category: its name, its slug, and the first word ("badminton"). */
function categoryWords(f: FacLike): string[] {
  const name = f.category_name.toLowerCase();
  const slug = f.type.replace(/_/g, " ").toLowerCase();
  const words = new Set([name, slug, name.replace(/s$/, "")]);
  const first = name.split(/\s+/)[0];
  if (first.length >= 4 && !["room", "court", "hall", "the"].includes(first)) words.add(first);
  return [...words].filter(Boolean);
}

/**
 * Facilities mentioned in `text`. A facility name and a category together
 * narrow each other ("badminton court 1" when several categories have a
 * Court 1); a category on its own means every facility in it.
 */
export function matchFacilities<F extends FacLike>(text: string | null, facilities: F[]): F[] {
  if (!text) return [];
  const t = text.toLowerCase();

  const byName = facilities
    .filter((f) => has(t, f.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  // drop a shorter name that is only matched inside a longer matched name
  const names = byName.filter(
    (f) => !byName.some((g) => g !== f && g.name.length > f.name.length &&
      g.name.toLowerCase().includes(f.name.toLowerCase()))
  );
  const cats = new Set(
    facilities.filter((f) => categoryWords(f).some((w) => has(t, w))).map((f) => f.category_id)
  );

  if (names.length && cats.size) {
    const both = names.filter((f) => cats.has(f.category_id));
    return both.length ? both : names;
  }
  if (names.length) return names;
  if (cats.size) return facilities.filter((f) => cats.has(f.category_id));
  return [];
}

/** The facility and category words present in `q`, as one searchable term. */
function facilityTerm(q: string, facilities: FacLike[]): string | null {
  const t = q.toLowerCase();
  const found = new Set<string>();
  for (const f of facilities) {
    if (has(t, f.name.toLowerCase())) found.add(f.name.toLowerCase());
    for (const w of categoryWords(f)) if (has(t, w)) found.add(w);
  }
  return found.size ? [...found].join(" ") : null;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

export function parseDate(q: string, now: Date = new Date()): string | null {
  const t = q.toLowerCase();
  const today = myDateKey(now);
  if (/day after tomorrow/.test(t)) return addDays(today, 2);
  if (/\btomorrow\b|\btmr\b|\besok\b/.test(t)) return addDays(today, 1);
  if (/\btoday\b|\btonight\b|\bnow\b|\bhari ini\b/.test(t)) return today;

  const iso = t.match(/\b(20\d\d)-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // "2 oct", "2nd october", "oct 2"
  const m1 = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/);
  const m2 = t.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
  const dm = m1 ? { d: +m1[1], m: MONTHS.indexOf(m1[2]) } : m2 ? { d: +m2[2], m: MONTHS.indexOf(m2[1]) } : null;
  if (dm && dm.d >= 1 && dm.d <= 31) {
    let year = Number(today.slice(0, 4));
    const key = (y: number) => `${y}-${String(dm.m + 1).padStart(2, "0")}-${String(dm.d).padStart(2, "0")}`;
    if (key(year) < today) year += 1; // "2 jan" in December means next year
    return key(year);
  }

  const wd = WEEKDAYS.findIndex((d) => has(t, d) || has(t, d.slice(0, 3)));
  if (wd >= 0) {
    const delta = (wd - myWeekday(now) + 7) % 7;
    const nextWeek = /\bnext\s+(week|mon|tue|wed|thu|fri|sat|sun)/.test(t) ? 7 : 0;
    return addDays(today, delta + (delta === 0 ? nextWeek : 0));
  }
  return null;
}

/** Requested hour, 0-23. Bare "at 3" is read as 3 pm, since campus opens at 8. */
export function parseHour(q: string): number | null {
  const t = q.toLowerCase();
  const ampm = t.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
  if (ampm) {
    let h = Number(ampm[1]) % 12;
    if (ampm[3] === "pm") h += 12;
    return h >= 0 && h <= 23 ? h : null;
  }
  const hhmm = t.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (hhmm) return Number(hhmm[1]);
  const at = t.match(/\bat\s+(\d{1,2})\b(?!\s*(?:hours?|hrs?|mins?|minutes?|people|pax|persons?))/);
  if (at) {
    const n = Number(at[1]);
    if (n >= 1 && n <= 7) return n + 12;
    if (n >= 8 && n <= 23) return n;
  }
  if (/\bnoon\b/.test(t)) return 12;
  return null;
}

/** Requested duration in minutes. */
export function parseDuration(q: string): number | null {
  const t = q.toLowerCase();
  const hrs = t.match(/\b(\d+(?:\.\d+)?)\s*(?:hours?|hrs?|h)\b/);
  if (hrs) return Math.round(Number(hrs[1]) * 60);
  const mins = t.match(/\b(\d+)\s*(?:minutes?|mins?|m)\b/);
  if (mins) return Number(mins[1]);
  if (/\bhalf an hour\b/.test(t)) return 30;
  if (/\ban hour\b|\bone hour\b/.test(t)) return 60;
  return null;
}

export function parsePart(q: string): PartOfDay | null {
  const t = q.toLowerCase();
  if (/\bmorning\b|\bpagi\b/.test(t)) return "morning";
  if (/\bafternoon\b|\bpetang\b|\blunch\b/.test(t)) return "afternoon";
  if (/\bevening\b|\bnight\b|\btonight\b|\bmalam\b/.test(t)) return "evening";
  return null;
}

/** Deterministic intent parser, used as-is offline and as a safety net under the LLM. */
export function parseIntent(q: string, facilities: FacLike[], now: Date = new Date()): Intent {
  const t = q.toLowerCase();

  // Order matters. Explicit rule words beat everything except a question
  // about the student's own bookings; listing beats availability only when
  // the question is about what exists, not about what is free.
  let intent: IntentKind = "other";
  if (
    /\b(my|mine)\b.*\b(booking|bookings|reservation|reservations|slot|slots)\b/.test(t) ||
    /\b(did|have)\s+i\s+(book|booked|reserve|reserved)\b/.test(t) ||
    /\bi\s+(have|booked|reserved)\b.*\b(booking|reservation|slot|court|room)/.test(t) ||
    /\bwhen('?s| is)\s+my\b/.test(t)
  ) intent = "mine";
  else if (
    /\b(rule|rules|policy|policies|cancel|cancellation|advance|approval|approve|maximum|minimum|max|min)\b/.test(t)
  ) intent = "rules";
  else if (
    /\b(list|show)\b.*\b(facilities|rooms|courts|halls|venues)\b/.test(t) ||
    /\bwhat can i book\b/.test(t) ||
    (/\b(what|which)\s+(facilities|rooms|courts|halls|venues)\b/.test(t) &&
      !/\b(free|available|vacant|empty|open)\b/.test(t))
  ) intent = "list";
  else if (
    /\bhow long\b/.test(t) ||
    /\b(opens|opening|close|closes|closing|operating)\b/.test(t) ||
    /\bwhat time\b.*\bopen\b/.test(t)
  ) intent = "rules";
  else if (
    /\b(free|available|availability|book|booking|slot|slots|vacant|empty|taken|busy|when|any|open|kosong)\b/.test(t)
  ) intent = "availability";

  return {
    intent,
    facility: facilityTerm(q, facilities),
    date: parseDate(q, now),
    part_of_day: parsePart(q),
    hour: parseHour(q),
    duration: parseDuration(q),
  };
}

/**
 * Resolve a follow-up against earlier turns. "Is Court 1 free tomorrow?"
 * followed by "what about the evening?" keeps Court 1 and tomorrow;
 * "and futsal?" keeps the question and the day but changes the facility.
 * `history` is oldest first and excludes the current turn.
 */
export function withContext(cur: Intent, history: Intent[]): Intent {
  const recent = [...history].reverse();
  const prev = recent.find((h) => h.intent !== "other");
  if (!prev) return cur;

  const hasSignal =
    cur.facility !== null || cur.date !== null || cur.part_of_day !== null ||
    cur.hour !== null || cur.duration !== null;

  let intent = cur.intent;
  if (intent === "other" && hasSignal && (prev.intent === "availability" || prev.intent === "rules"))
    intent = prev.intent;

  if (intent !== "availability" && intent !== "rules") return { ...cur, intent };

  const lastFacility = recent.find((h) => h.facility)?.facility ?? null;
  const lastDate = recent.find((h) => h.date)?.date ?? null;
  return {
    ...cur,
    intent,
    facility: cur.facility ?? lastFacility,
    date: intent === "availability" ? cur.date ?? lastDate : cur.date,
    duration: cur.duration ?? recent.find((h) => h.duration)?.duration ?? null,
  };
}

/** Validate an LLM's JSON so a malformed field can never reach a query. */
export function sanitiseIntent(raw: unknown): Partial<Intent> {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<Intent> = {};
  if (["availability", "rules", "list", "mine", "other"].includes(r.intent as string))
    out.intent = r.intent as IntentKind;
  if (typeof r.facility === "string" && r.facility.trim()) out.facility = r.facility.trim().slice(0, 80);
  if (typeof r.date === "string" && /^20\d\d-\d{2}-\d{2}$/.test(r.date)) out.date = r.date;
  if (["morning", "afternoon", "evening"].includes(r.part_of_day as string))
    out.part_of_day = r.part_of_day as PartOfDay;
  if (Number.isInteger(r.hour) && (r.hour as number) >= 0 && (r.hour as number) <= 23) out.hour = r.hour as number;
  if (Number.isInteger(r.duration) && (r.duration as number) >= 15 && (r.duration as number) <= 600)
    out.duration = r.duration as number;
  return out;
}

// ------------------------------------------------------------ free windows --

export interface Window { start: Date; end: Date }

const PART_BOUNDS: Record<PartOfDay, [string, string]> = {
  morning: ["00:00", "12:00"],
  afternoon: ["12:00", "17:00"],
  evening: ["17:00", "23:59"],
};

/** Middle of a part of day, used as the preferred hour when none was given. */
export const PART_CENTRE: Record<PartOfDay, number> = { morning: 10, afternoon: 14, evening: 19 };

/**
 * Free time on one facility on one day: operating hours, minus bookings,
 * minus anything already past, optionally clipped to a part of the day. Gaps
 * shorter than the facility's minimum booking are dropped.
 */
export function freeWindows(
  rule: Pick<FacilityRule, "open_time" | "close_time" | "min_duration_mins">,
  reservations: Pick<Reservation, "start_time" | "end_time" | "status">[],
  dateKey: string,
  now: Date = new Date(),
  part: PartOfDay | null = null
): Window[] {
  let lo = myAt(dateKey, rule.open_time.slice(0, 5)).getTime();
  let hi = myAt(dateKey, rule.close_time.slice(0, 5)).getTime();

  if (part) {
    const [a, b] = PART_BOUNDS[part];
    lo = Math.max(lo, myAt(dateKey, a).getTime());
    hi = Math.min(hi, myAt(dateKey, b).getTime());
  }
  // nothing before now, rounded up to the next quarter hour
  const q = 15 * 60_000;
  lo = Math.max(lo, Math.ceil(now.getTime() / q) * q);
  if (hi <= lo) return [];

  const busy = reservations
    .filter((r) => r.status === "pending" || r.status === "approved")
    .map((r) => [new Date(r.start_time).getTime(), new Date(r.end_time).getTime()] as const)
    .filter(([s, e]) => e > lo && s < hi)
    .sort((a, b) => a[0] - b[0]);

  const out: Window[] = [];
  let cursor = lo;
  for (const [s, e] of busy) {
    if (s > cursor) out.push({ start: new Date(cursor), end: new Date(Math.min(s, hi)) });
    cursor = Math.max(cursor, e);
    if (cursor >= hi) break;
  }
  if (cursor < hi) out.push({ start: new Date(cursor), end: new Date(hi) });

  const min = rule.min_duration_mins * 60_000;
  return out.filter((w) => w.end.getTime() - w.start.getTime() >= min);
}

/** Is [start, start + duration) entirely inside one free window? */
export function fitsIn(windows: Window[], start: Date, durationMins: number): boolean {
  const end = start.getTime() + durationMins * 60_000;
  return windows.some((w) => w.start.getTime() <= start.getTime() && end <= w.end.getTime());
}

export function describeWindows(windows: Window[]): string {
  return windows.map((w) => `${fmtTime(w.start)} to ${fmtTime(w.end)}`).join(", ");
}
