export type Role = "student" | "facility_manager" | "admin";

export interface Profile {
  id: string;
  full_name: string;
  email: string;
  role: Role;
  rec_weights: RecWeights;
  /** LinUCB state for slot ranking; null until the student first gives feedback. */
  rec_bandit?: unknown;
}

export interface RecWeights {
  time: number;
  capacity: number;
  offpeak: number;
}

/** A facility category (Badminton, Futsal...). Added first; owns the rules. */
export interface FacilityCategory {
  id: string;
  name: string;
  slug: string;
  venue: string;
  description: string | null;
  open_time: string;
  close_time: string;
  slot_minutes: number;
  min_duration_mins: number;
  max_duration_mins: number;
  max_advance_days: number;
  cancellation_hours: number;
  auto_approve: boolean;
  checkin_grace_mins?: number | null;
}

/** An individual room/court, read from the `facilities_full` view. */
export interface Facility {
  id: string;
  name: string;
  category_id: string;
  category_name: string;
  type: string;      // category slug
  venue: string;
  location: string;  // mirrors venue
  capacity: number;
  description: string | null;
  status: "active" | "maintenance" | "inactive";
}

export interface Equipment {
  id: string;
  facility_type: string;
  name: string;
  total_qty: number;
}

export interface FacilityManager {
  id: string;
  facility_id: string;
  manager_id: string;
}

export type LostFoundCategory =
  | "electronics" | "clothing" | "books" | "keys" | "wallet"
  | "sports" | "id_card" | "other";

export type LostFoundStatus = "unclaimed" | "claimed" | "returned" | "disposed";

export interface LostFoundItem {
  id: string;
  facility_id: string;
  item_name: string;
  category: LostFoundCategory;
  description: string | null;
  found_location: string | null;
  found_date: string;
  reporter_name: string | null;
  status: LostFoundStatus;
  claimant_name: string | null;
  claimant_contact: string | null;
  notes: string | null;
  logged_by: string | null;
  created_at: string;
}

export interface AppNotification {
  id: string;
  user_id: string;
  title: string;
  body: string | null;
  type: string;
  entity_id: string | null;
  read: boolean;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  at: string;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  entity: string;
  entity_id: string | null;
  summary: string;
}

export const LOST_FOUND_CATEGORIES: Record<LostFoundCategory, string> = {
  electronics: "Electronics",
  clothing: "Clothing",
  books: "Books / Notes",
  keys: "Keys",
  wallet: "Wallet / Purse",
  sports: "Sports Gear",
  id_card: "ID / Card",
  other: "Other",
};

export interface ReservationEquipment {
  id: string;
  reservation_id: string;
  equipment_id: string;
  qty: number;
}

/** Resolved rules per facility (category value, or per-court override). */
export interface FacilityRule {
  facility_id: string;
  category_id: string;
  category_name: string;
  type: string;
  venue: string;
  open_time: string; // "08:00:00"
  close_time: string;
  slot_minutes: number;
  min_duration_mins: number;
  max_duration_mins: number;
  max_advance_days: number;
  cancellation_hours: number;
  auto_approve: boolean;
  has_override: boolean;
  /** Minutes after start before an un-checked-in booking is released; null = off. */
  checkin_grace_mins?: number | null;
}

export interface Reservation {
  id: string;
  facility_id: string;
  user_id: string;
  start_time: string;
  end_time: string;
  participants: number;
  purpose: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  checked_in_at: string | null;
  no_show: boolean;
  created_at: string;
  /** Why it was cancelled: user | no_checkin | early_leave | admin. */
  cancel_reason?: string | null;
  released_at?: string | null;
}

export const FACILITY_TYPE_LABELS: Record<string, string> = {
  discussion_room: "Discussion Room",
  futsal: "Futsal Court",
  basketball: "Basketball Court",
  badminton: "Badminton Court",
  meeting_room: "Meeting Room",
  event_hall: "Event Hall",
  other: "Other",
};

/** Human label for any category, including admin-created ones. */
export function typeLabel(t: string): string {
  return (
    FACILITY_TYPE_LABELS[t] ??
    t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
