import { resolveScene } from "./scene";

/**
 * Helpers for the admin "New facility" and "Add room" wizards. Pure, so the
 * naming and defaults are unit-tested (facility-setup.test.ts).
 */

export interface RuleDefaults {
  open_time: string; close_time: string;
  min_duration_mins: number; max_duration_mins: number;
  max_advance_days: number; cancellation_hours: number;
  auto_approve: boolean; checkin_grace_mins: number | null;
}

export interface Preset { name: string; capacity: number; rules: RuleDefaults }

const r = (o: string, c: string, min: number, max: number, adv: number, cancel: number, auto: boolean, grace: number | null): RuleDefaults =>
  ({ open_time: o, close_time: c, min_duration_mins: min, max_duration_mins: max, max_advance_days: adv, cancellation_hours: cancel, auto_approve: auto, checkin_grace_mins: grace });

/** Common campus facilities with sensible starting rules (all editable). */
export const PRESETS: Preset[] = [
  { name: "Badminton", capacity: 4, rules: r("08:00", "22:00", 60, 120, 14, 24, false, 15) },
  { name: "Futsal", capacity: 12, rules: r("08:00", "22:00", 60, 120, 14, 24, false, 15) },
  { name: "Basketball", capacity: 10, rules: r("08:00", "22:00", 60, 120, 14, 24, false, 15) },
  { name: "Tennis", capacity: 4, rules: r("07:00", "22:00", 60, 120, 14, 24, false, 15) },
  { name: "Discussion Room", capacity: 6, rules: r("08:00", "22:00", 30, 120, 7, 2, true, 15) },
  { name: "Meeting Room", capacity: 10, rules: r("08:00", "20:00", 30, 180, 14, 12, false, 15) },
  { name: "Event Hall", capacity: 150, rules: r("08:00", "22:00", 120, 480, 30, 72, false, null) },
  { name: "Computer Lab", capacity: 30, rules: r("08:00", "20:00", 60, 180, 14, 24, false, 15) },
];

export const DEFAULT_RULES: RuleDefaults = r("08:00", "22:00", 30, 120, 14, 24, false, null);

export function findPreset(name: string): Preset | undefined {
  const n = name.trim().toLowerCase();
  return PRESETS.find((p) => p.name.toLowerCase() === n);
}

const slugify = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/**
 * Category slugs are unique campus-wide, so a second "Badminton" at another
 * venue becomes "badminton_sports_complex" (pictures still match by keyword).
 */
export function uniqueSlug(name: string, venue: string, existing: string[]): string {
  const taken = new Set(existing);
  const base = slugify(name) || "facility";
  if (!taken.has(base)) return base;
  const withVenue = `${base}_${slugify(venue)}`.replace(/_+$/, "");
  if (!taken.has(withVenue)) return withVenue;
  for (let i = 2; ; i++) if (!taken.has(`${withVenue}_${i}`)) return `${withVenue}_${i}`;
}

/** "Court" for courts, "Room" for rooms, "Lane" for pools... or the word the existing rooms already use. */
export function roomPrefix(typeName: string, existingNames: string[] = []): string {
  const counts = new Map<string, number>();
  for (const n of existingNames) {
    const m = n.trim().match(/^(.*?)\s*(\d+|[A-Z])$/);
    if (m && m[1]) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  const used = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (used) return used[0];
  switch (resolveScene(typeName)) {
    case "court": case "net_court": return "Court";
    case "pool": return "Lane";
    case "hall": return "Hall";
    case "gym": return "Zone";
    default: return "Room";
  }
}

/** Next free numbered names: Court 1-4 exist -> "Court 5", "Court 6". Letters continue too (Room A -> Room B). */
export function nextRoomNames(existingNames: string[], prefix: string, count: number): string[] {
  const p = prefix.trim();
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const letters = existingNames.map((n) => n.trim().match(new RegExp(`^${esc}\\s+([A-Z])$`, "i"))?.[1]).filter(Boolean) as string[];
  const out: string[] = [];
  if (letters.length && !existingNames.some((n) => new RegExp(`^${esc}\\s+\\d+$`, "i").test(n.trim()))) {
    let code = Math.max(...letters.map((l) => l.toUpperCase().charCodeAt(0))) + 1;
    while (out.length < count && code <= 90) {
      const name = `${p} ${String.fromCharCode(code++)}`;
      if (!taken.has(name.toLowerCase())) out.push(name);
    }
    if (out.length === count) return out;
  }
  for (let i = 1; out.length < count; i++) {
    const name = p ? `${p} ${i}` : String(i);
    if (!taken.has(name.toLowerCase()) && !out.includes(name)) out.push(name);
  }
  return out;
}

/** The capacity most rooms of this type already have (ties -> larger), or a fallback. */
export function typicalCapacity(capacities: number[], fallback: number): number {
  if (!capacities.length) return fallback;
  const counts = new Map<number, number>();
  for (const c of capacities) counts.set(c, (counts.get(c) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
}

/** Problems with a rule set, in plain words (empty = fine). */
export function ruleProblems(v: RuleDefaults): string[] {
  const p: string[] = [];
  if (v.open_time >= v.close_time) p.push("Closing time must be after opening time.");
  if (v.min_duration_mins < 15) p.push("Shortest booking must be at least 15 minutes.");
  if (v.min_duration_mins > v.max_duration_mins) p.push("Shortest booking is longer than the longest.");
  if (v.max_advance_days < 1) p.push("Bookings must open at least 1 day ahead.");
  if (v.cancellation_hours < 0) p.push("Cancellation notice can't be negative.");
  return p;
}
