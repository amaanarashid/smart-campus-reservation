import type { MemberType } from "./types";
import { myAt, myDateKey, myWeekday, addDays } from "./time";

/**
 * Who may book a facility type, and per-person fair-use limits. The database
 * enforces these (upgrade-access-limits.sql); these helpers let the pages
 * show them and give the same message before a request is even sent.
 */
export const MEMBER_TYPES: MemberType[] = ["undergraduate", "postgraduate", "staff"];

export const MEMBER_LABEL: Record<MemberType, string> = {
  undergraduate: "Undergraduate", postgraduate: "Postgraduate", staff: "Staff",
};
const PLURAL: Record<MemberType, string> = { undergraduate: "undergraduates", postgraduate: "postgraduates", staff: "staff" };

export interface AccessRule {
  allowed_members?: MemberType[] | null;
  max_upcoming?: number | null;
  max_hours_week?: number | null;
}

const allowedOf = (r: AccessRule | null | undefined): MemberType[] =>
  r?.allowed_members && r.allowed_members.length ? r.allowed_members : MEMBER_TYPES;

export function canBook(rule: AccessRule | null | undefined, who: MemberType | null | undefined): boolean {
  return allowedOf(rule).includes(who ?? "undergraduate");
}

/** "Staff only", "Postgraduates and staff" - or null when everyone may book. */
export function accessLabel(rule: AccessRule | null | undefined): string | null {
  const a = allowedOf(rule);
  if (a.length === MEMBER_TYPES.length) return null;
  const ordered = MEMBER_TYPES.filter((m) => a.includes(m));
  if (ordered.length === 1) return `${MEMBER_LABEL[ordered[0]]} only`;
  const words = ordered.map((m) => PLURAL[m]);
  const text = words.join(" and ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Same wording as the database: "Staff Meeting can only be booked by staff." */
export function accessMessage(name: string, rule: AccessRule | null | undefined): string {
  return `${name} can only be booked by ${MEMBER_TYPES.filter((m) => allowedOf(rule).includes(m)).map((m) => PLURAL[m]).join(" and ")}.`;
}

/** Short summary of the limits, or null: "max 2 upcoming · 4 h/week". */
export function limitsLabel(rule: AccessRule | null | undefined): string | null {
  const parts: string[] = [];
  if (rule?.max_upcoming) parts.push(`max ${rule.max_upcoming} upcoming`);
  if (rule?.max_hours_week) parts.push(`${rule.max_hours_week} h/week`);
  return parts.length ? parts.join(" · ") : null;
}

/** Monday 00:00 (Malaysia) of the week containing t. */
export function weekStart(t: Date): Date {
  const key = myDateKey(t);
  const back = (myWeekday(t) + 6) % 7;            // Sun=0 -> 6 days back
  return myAt(addDays(key, -back), "00:00");
}

export interface OwnBooking { start_time: string; end_time: string; status: string; sameType: boolean }

/**
 * The fair-use message the database would give for a new booking, or null.
 * `mine` = the person's own bookings, flagged with whether they are the same
 * facility type.
 */
export function limitProblem(typeName: string, rule: AccessRule | null | undefined, mine: OwnBooking[],
  start: Date, end: Date, now: Date): string | null {
  const live = mine.filter((b) => b.sameType && (b.status === "pending" || b.status === "approved"));
  if (rule?.max_upcoming) {
    const n = live.filter((b) => new Date(b.end_time) > now).length;
    if (n >= rule.max_upcoming)
      return `You already have ${n} upcoming ${typeName} booking${n === 1 ? "" : "s"}. The limit is ${rule.max_upcoming}.`;
  }
  if (rule?.max_hours_week) {
    const ws = weekStart(start).getTime(), we = ws + 7 * 86_400_000;
    const booked = live
      .filter((b) => { const s = new Date(b.start_time).getTime(); return s >= ws && s < we; })
      .reduce((h, b) => h + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime()) / 3_600_000, 0);
    const add = (end.getTime() - start.getTime()) / 3_600_000;
    if (booked + add > rule.max_hours_week + 1e-9)
      return `Weekly limit for ${typeName} is ${rule.max_hours_week.toFixed(1)} h. You already have ${booked.toFixed(1)} h booked that week.`;
  }
  return null;
}
