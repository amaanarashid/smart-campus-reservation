/**
 * Room feedback: a student reports a problem in a room, staff handle it.
 * Pure helpers shared by the student, manager and admin screens, so the
 * rules are the same everywhere and unit-tested. The database
 * (upgrade-room-reports.sql) enforces the same limits again.
 */

export type ReportCategory =
  | "cleanliness" | "aircon" | "lighting" | "equipment" | "av_wifi"
  | "furniture" | "safety" | "noise" | "other";
export type ReportUrgency = "low" | "normal" | "urgent";
export type ReportStatus = "open" | "in_progress" | "resolved" | "dismissed";

export interface RoomReport {
  id: string;
  facility_id: string;
  reservation_id: string | null;
  reporter_id: string;
  category: ReportCategory;
  urgency: ReportUrgency;
  description: string;
  status: ReportStatus;
  staff_note: string | null;
  handled_by: string | null;
  handled_at: string | null;
  created_at: string;
}

export const REPORT_CATEGORIES: Record<ReportCategory, string> = {
  cleanliness: "Cleanliness",
  aircon: "Air-con",
  lighting: "Lighting",
  equipment: "Equipment",
  av_wifi: "Projector / screen / Wi-Fi",
  furniture: "Furniture",
  safety: "Safety",
  noise: "Noise",
  other: "Other",
};

export const REPORT_URGENCY: Record<ReportUrgency, string> = {
  low: "Low - can wait",
  normal: "Normal",
  urgent: "Urgent - room hard to use",
};

export const REPORT_STATUS: Record<ReportStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

export const MIN_DESCRIPTION = 5;
export const MAX_DESCRIPTION = 1000;

/** Problems in the room are reported from 15 min before the start until a day after the end. */
export const REPORT_WINDOW_BEFORE_MINS = 15;
export const REPORT_WINDOW_AFTER_HOURS = 24;

export function validateReport(r: { category?: string; urgency?: string; description?: string }):
  { ok: true } | { ok: false; error: string } {
  if (!r.category || !(r.category in REPORT_CATEGORIES)) return { ok: false, error: "Pick what the problem is about." };
  if (r.urgency && !(r.urgency in REPORT_URGENCY)) return { ok: false, error: "Pick how urgent it is." };
  const d = (r.description ?? "").trim();
  if (d.length < MIN_DESCRIPTION) return { ok: false, error: "Describe the problem in a few words." };
  if (d.length > MAX_DESCRIPTION) return { ok: false, error: `Keep it under ${MAX_DESCRIPTION} characters.` };
  return { ok: true };
}

/**
 * Can this booking be used to report a room problem now? Approved bookings,
 * and ones released for no check-in (the student may not have been able to
 * get in - a broken door is exactly what should be reported), from just
 * before the start until a day after the end.
 */
export function canReport(
  b: { status: string; start_time: string; end_time: string; cancel_reason?: string | null },
  now: number,
): boolean {
  const usable = b.status === "approved" || (b.status === "cancelled" && b.cancel_reason === "no_checkin");
  if (!usable) return false;
  const from = new Date(b.start_time).getTime() - REPORT_WINDOW_BEFORE_MINS * 60_000;
  const until = new Date(b.end_time).getTime() + REPORT_WINDOW_AFTER_HOURS * 3_600_000;
  return now >= from && now <= until;
}

export const isOpen = (s: ReportStatus) => s === "open" || s === "in_progress";

/** Open issues per room: count, the categories, and whether any is urgent. */
export function issuesByFacility(rows: { facility_id: string; category: ReportCategory; urgency: ReportUrgency }[]) {
  const m: Record<string, { count: number; urgent: boolean; categories: ReportCategory[] }> = {};
  for (const r of rows) {
    const e = (m[r.facility_id] ??= { count: 0, urgent: false, categories: [] });
    e.count += 1;
    e.urgent ||= r.urgency === "urgent";
    if (!e.categories.includes(r.category)) e.categories.push(r.category);
  }
  return m;
}

/** Staff inbox order: open before in progress before closed; urgent first; oldest waiting first. */
export function sortForInbox<T extends Pick<RoomReport, "status" | "urgency" | "created_at">>(rows: T[]): T[] {
  const st: Record<ReportStatus, number> = { open: 0, in_progress: 1, resolved: 2, dismissed: 3 };
  const ur: Record<ReportUrgency, number> = { urgent: 0, normal: 1, low: 2 };
  return [...rows].sort((a, b) =>
    st[a.status] - st[b.status] ||
    (isOpen(a.status) ? ur[a.urgency] - ur[b.urgency] : 0) ||
    (isOpen(a.status) ? a.created_at.localeCompare(b.created_at) : b.created_at.localeCompare(a.created_at)));
}

/** "3 h", "2 d" - how long a report has been waiting. */
export function waitingFor(createdAt: string, now: number): string {
  const mins = Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
  if (mins < 60) return `${mins} min`;
  if (mins < 48 * 60) return `${Math.floor(mins / 60)} h`;
  return `${Math.floor(mins / 1440)} d`;
}
