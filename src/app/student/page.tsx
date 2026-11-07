"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { busyQuery } from "@/lib/busy";
import { accessLabel, accessMessage, canBook, limitProblem, limitsLabel } from "@/lib/access";
import {
  BusySlot, Facility, FacilityRule, Profile, Reservation, Equipment, typeLabel,
} from "@/lib/types";
import {
  recommendAcross, learnPeakHours, updateWeights, ScoredSlot, PeakModel,
  DEFAULT_WEIGHTS, DEFAULT_PEAKS,
} from "@/lib/recommend";
import {
  initBandit, isBanditState, rankWithBandit, cascadeUpdate, compactBandit,
} from "@/lib/bandit";
import { addDays, fmtDay, fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";
import {
  clampDuration, durationOptions, firstSlot, fmtDuration, nearestTime, recentFacilityIds, timeOptions,
} from "@/lib/booking-form";
import { ensureProfile } from "@/lib/profile";
import { useAutoRefresh } from "@/lib/use-auto-refresh";

// the chat widget loads after the booking page, in its own bundle
const Chatbot = dynamic(() => import("@/components/chatbot"));
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast, Toaster } from "sonner";
import AppShell from "@/components/app-shell";
import FacilityIso from "@/components/facility-iso";
import VenueArt from "@/components/venue-art";
import PopularTimes from "@/components/popular-times";
import { BookingSteps, ChoiceChips, Disclosure } from "@/components/booking-ui";
import ReportProblemDialog, { CATEGORY_ICON } from "@/components/report-problem-dialog";
import {
  canReport, issuesByFacility, REPORT_CATEGORIES, REPORT_STATUS,
  type ReportCategory, type ReportUrgency, type RoomReport,
} from "@/lib/reports";
import { logEvent } from "@/lib/evaluation";
import {
  CalendarDays, CalendarPlus, Clock, CheckCircle2, ChevronDown, ArrowLeft, BarChart3, History, PackagePlus,
  Sparkles, MapPin, Users2, CalendarX, Copy, KeyRound, Loader2, TriangleAlert, MessageSquareWarning, Lock,
} from "lucide-react";

const STATUS_COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default", pending: "secondary", rejected: "destructive", cancelled: "outline",
};
const STATUS_LABEL: Record<string, string> = {
  approved: "Confirmed", pending: "Waiting for approval", rejected: "Declined", cancelled: "Cancelled",
};

/** Index for the .stagger utility: list items cascade in 55 ms apart. */
const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

/** Chart range for rooms: earliest opening to latest closing. */
function hoursOf(rs: FacilityRule[]) {
  if (rs.length === 0) return { open: 8, close: 22 };
  return {
    open: Math.min(...rs.map((r) => Number(r.open_time.slice(0, 2)))),
    close: Math.min(24, Math.max(...rs.map((r) => Number(r.close_time.slice(0, 2)) + (r.close_time.slice(3, 5) !== "00" ? 1 : 0)))),
  };
}

function DashboardSkeleton() {
  return (
    <div className="space-y-5" aria-busy="true" aria-label="Loading your bookings and rooms">
      <div className="skeleton h-10 w-64 max-w-full rounded-lg" />
      <div className="rounded-xl border bg-card p-6">
        <div className="skeleton h-4 w-48" />
        <div className="skeleton mt-4 h-6 w-64 max-w-full" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-44 rounded-xl" />)}
        </div>
      </div>
    </div>
  );
}

export default function StudentDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [rules, setRules] = useState<Record<string, FacilityRule>>({});
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [busyNow, setBusyNow] = useState<Set<string>>(new Set());
  const [myBookings, setMyBookings] = useState<Reservation[]>([]);
  // rooms fitted with a smart door: check-in happens at the keypad, not in the app
  const [doorRooms, setDoorRooms] = useState<Set<string>>(new Set());
  const [codes, setCodes] = useState<Record<string, { code: string; hint: string }>>({});

  // one task on screen at a time
  const [view, setView] = useState<"book" | "bookings">("book");
  const [justBooked, setJustBooked] = useState<string | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  // navigation: venue -> facility -> booking form
  const [venue, setVenue] = useState<string | null>(null);
  const [facility, setFacility] = useState<Facility | null>(null);

  // booking form
  const [date, setDate] = useState<string>(() => myDateKey());
  // empty until a room is opened; then the soonest bookable start, or what the student picked
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [participants, setParticipants] = useState(2);
  const [purpose, setPurpose] = useState("");
  const [equipReq, setEquipReq] = useState<Record<string, number>>({});
  const [suggestions, setSuggestions] = useState<ScoredSlot[] | null>(null);
  // what the student asked for when the suggestions were produced; the form
  // may change afterwards, but learning must be against the original request
  const [suggestCtx, setSuggestCtx] = useState<{ preferredHour: number; peaks: PeakModel } | null>(null);
  const [checking, setChecking] = useState(false);
  // which suggestion is being booked right now; blocks double clicks
  const [bookingKey, setBookingKey] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  /** two-step cancel: the booking waiting for "Yes, cancel" (heuristic review: no undo for a cancel) */
  const [confirmCancel, setConfirmCancel] = useState<string | null>(null);
  // room feedback
  const [myReports, setMyReports] = useState<RoomReport[]>([]);
  const [openIssues, setOpenIssues] = useState<{ facility_id: string; category: ReportCategory; urgency: ReportUrgency }[]>([]);
  const [reportFor, setReportFor] = useState<Reservation | null>(null);
  // A clock the UI re-renders from. Reading Date.now() during render is impure
  // (React Compiler can memoise it, leaving check-in buttons and deadlines
  // stale); this ticks every 30 s so time-dependent UI stays current.
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadBookings = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("reservations").select("*").eq("user_id", uid)
      .order("start_time", { ascending: false }).limit(20);
    setMyBookings((data as Reservation[]) ?? []);
    // own reports + known open issues (upgrade-room-reports.sql; absent = none)
    const [{ data: rep }, { data: iss }] = await Promise.all([
      supabase.from("room_reports").select("*").eq("reporter_id", uid).order("created_at", { ascending: false }).limit(50),
      supabase.from("facility_open_issues").select("facility_id, category, urgency"),
    ]);
    setMyReports((rep as RoomReport[]) ?? []);
    setOpenIssues((iss as { facility_id: string; category: ReportCategory; urgency: ReportUrgency }[]) ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const p = await ensureProfile();
      if (!p) { router.replace("/login"); return; }
      setProfile(p);
      // all first-load reads at once (one round trip of waiting, not five in a row)
      const nowIso = new Date().toISOString();
      const [{ data: f, error: fErr }, { data: r, error: rErr }, { data: e }, { data: cur }, { data: doors }] = await Promise.all([
        supabase.from("facilities_full").select("*").eq("status", "active").order("name"),
        supabase.from("effective_facility_rules").select("*"),
        supabase.from("equipment").select("*").order("name"),
        // which facilities are in use right now?
        busyQuery((t) => supabase
          .from(t).select("facility_id")
          .in("status", ["pending", "approved"])
          .lte("start_time", nowIso).gte("end_time", nowIso)),
        // view added by upgrade-room-access.sql; if it is not there yet, no doors
        supabase.from("door_facilities").select("facility_id"),
        loadBookings(p.id),
      ]);
      if (fErr || rErr) {
        setLoadError((fErr ?? rErr)!.message);
        console.error("student load:", fErr ?? rErr);
      }
      setFacilities((f as Facility[]) ?? []);
      const map: Record<string, FacilityRule> = {};
      (r as FacilityRule[] | null)?.forEach((x) => { map[x.facility_id] = x; });
      setRules(map);
      setEquipment((e as Equipment[]) ?? []);
      setBusyNow(new Set(((cur as { facility_id: string }[] | null) ?? []).map((x) => x.facility_id)));
      setDoorRooms(new Set((doors ?? []).map((d: { facility_id: string }) => d.facility_id)));
      setNowMs(Date.now());
      setLoading(false);
    })();
  }, [router, loadBookings]);

  // keep "My bookings", in-use badges and known issues current without reloading
  useAutoRefresh(async () => {
    if (!profile) return;
    const nowIso = new Date().toISOString();
    const [{ data: cur }] = await Promise.all([
      busyQuery((t) => supabase.from(t).select("facility_id")
        .in("status", ["pending", "approved"]).lte("start_time", nowIso).gte("end_time", nowIso)),
      loadBookings(profile.id),
    ]);
    setBusyNow(new Set((cur ?? []).map((x) => x.facility_id)));
    setNowMs(Date.now());
  }, 20_000, !loading && !!profile);

  // ---------- booking ----------
  function buildWindow(): { start: Date; end: Date } {
    const start = myAt(date, startTime);
    return { start, end: new Date(start.getTime() + duration * 60000) };
  }

  function validateRules(start: Date, end: Date): string | null {
    if (!facility) return "Pick a facility first.";
    const rule = rules[facility.id];
    if (!rule) return "No booking rules configured for this facility.";
    const now = new Date();
    if (start <= now) return "That time is in the past.";
    if (duration < rule.min_duration_mins)
      return `Minimum booking for ${facility.name} is ${rule.min_duration_mins} minutes.`;
    if (duration > rule.max_duration_mins)
      return `Maximum booking for ${facility.name} is ${rule.max_duration_mins} minutes.`;
    const maxDay = new Date(now); maxDay.setDate(maxDay.getDate() + rule.max_advance_days);
    if (start > maxDay) return `Bookings open ${rule.max_advance_days} days in advance.`;
    if (participants > facility.capacity)
      return `${facility.name} holds ${facility.capacity}; reduce the group size.`;
    if (!canBook(rule, profile?.member_type)) return accessMessage(rule.category_name, rule);
    const limit = limitProblem(rule.category_name, rule,
      myBookings.map((b) => ({ ...b, sameType: facilities.find((x) => x.id === b.facility_id)?.category_id === facility.category_id })),
      start, end, now);
    if (limit) return limit;
    const open = myAt(date, rule.open_time.slice(0, 5));
    const close = myAt(date, rule.close_time.slice(0, 5));
    if (start < open || end > close)
      return `${facility.name} operates ${rule.open_time.slice(0, 5)}-${rule.close_time.slice(0, 5)}.`;
    return null;
  }

  async function equipmentShortfall(start: Date, end: Date): Promise<string | null> {
    const wanted = Object.entries(equipReq).filter(([, q]) => q > 0);
    if (wanted.length === 0) return null;
    // reservations overlapping the window anywhere on campus (equipment pools
    // are shared across facilities of the same type)
    const { data: overlapping } = await busyQuery((t) => supabase
      .from(t).select("id")
      .in("status", ["pending", "approved"])
      .lt("start_time", end.toISOString()).gt("end_time", start.toISOString()));
    const ids = (overlapping ?? []).map((x) => x.id);
    const used: Record<string, number> = {};
    if (ids.length > 0) {
      const { data: re } = await supabase
        .from("reservation_equipment").select("equipment_id, qty")
        .in("reservation_id", ids);
      (re ?? []).forEach((x) => { used[x.equipment_id] = (used[x.equipment_id] ?? 0) + x.qty; });
    }
    for (const [eqId, qty] of wanted) {
      const item = equipment.find((e) => e.id === eqId);
      if (!item) continue;
      const free = item.total_qty - (used[eqId] ?? 0);
      if (qty > free)
        return `Only ${Math.max(free, 0)} of "${item.name}" available at that time (you asked for ${qty}).`;
    }
    return null;
  }

  async function bookAt(start: Date, end: Date, fromSuggestion?: ScoredSlot, rank?: number) {
    if (!profile || !facility) return;
    // a suggestion may be for a different facility of the same category
    const target = fromSuggestion
      ? facilities.find((f) => f.id === fromSuggestion.facilityId) ?? facility
      : facility;
    const rule = rules[target.id];

    const shortfall = await equipmentShortfall(start, end);
    if (shortfall) { toast.error(shortfall); return; }

    const status = rule?.auto_approve ? "approved" : "pending";
    const { data: created, error } = await supabase.from("reservations").insert({
      facility_id: target.id, user_id: profile.id,
      start_time: start.toISOString(), end_time: end.toISOString(),
      participants, purpose: purpose || null, status,
    }).select().single();

    if (error || !created) {
      if (error?.message.includes("no_overlap")) {
        toast.error("That slot was taken just now - here are alternatives.");
        await suggestAlternatives();
      } else toast.error(error?.message ?? "Booking failed");
      return;
    }

    const eqRows = Object.entries(equipReq)
      .filter(([, q]) => q > 0)
      .map(([equipment_id, qty]) => ({ reservation_id: created.id, equipment_id, qty }));
    if (eqRows.length > 0) {
      const { error: eqErr } = await supabase.from("reservation_equipment").insert(eqRows);
      if (eqErr) toast.warning("Booked, but equipment request failed: " + eqErr.message);
    }

    const where = target.id !== facility.id ? ` - ${target.name}` : "";
    toast.success(status === "approved"
      ? "Booked and auto-approved" + where + (eqRows.length ? " - equipment reserved" : "")
      : "Request submitted for approval" + where + (eqRows.length ? " with equipment" : ""));

    if (fromSuggestion && suggestions) {
      const idx = rank ?? 0;
      logEvent("rec_accepted", {
        num: idx,
        note: `same_facility=${fromSuggestion.features[4]};day_offset=${Math.round(1 / fromSuggestion.features[5] - 1)}`,
      });

      // Baseline weights: learn against the hour the student ASKED for.
      const ctx = suggestCtx ?? { preferredHour: Number(startTime.split(":")[0]), peaks: DEFAULT_PEAKS };
      const newW = updateWeights(profile.rec_weights ?? DEFAULT_WEIGHTS, fromSuggestion, ctx.preferredHour, ctx.peaks);

      // Bandit: cascade feedback over the list the student actually saw.
      const stored = profile.rec_bandit;
      const current = isBanditState(stored) ? stored : initBandit();
      const newB = compactBandit(cascadeUpdate(current, suggestions, idx));

      const { error: upErr } = await supabase
        .from("profiles").update({ rec_weights: newW, rec_bandit: newB }).eq("id", profile.id);
      if (upErr) {
        // rec_bandit column missing until upgrade-recommender.sql is run;
        // still save the baseline weights rather than lose both
        console.warn("bandit not saved:", upErr.message);
        await supabase.from("profiles").update({ rec_weights: newW }).eq("id", profile.id);
        setProfile({ ...profile, rec_weights: newW });
      } else {
        setProfile({ ...profile, rec_weights: newW, rec_bandit: newB });
      }
    }
    setSuggestions(null);
    setSuggestCtx(null);
    setEquipReq({});
    await loadBookings(profile.id);
    // done: show the new booking and leave the form ready for next time
    setPurpose("");
    setStartTime("");
    setDate(myDateKey());
    setFacility(null);
    setVenue(null);
    setJustBooked(created.id);
    setView("bookings");
    window.scrollTo(0, 0);
  }

  async function suggestAlternatives() {
    if (!facility || !rules[facility.id]) return;
    const LOOK_AHEAD = 2;

    // every facility of the same category is a candidate
    const ids = facilities.filter((f) => f.category_id === facility.category_id).map((f) => f.id);
    const from = myAt(date, "00:00").toISOString();
    const to = myAt(addDays(date, LOOK_AHEAD + 1), "00:00").toISOString();
    const since = myAt(addDays(myDateKey(), -60), "00:00").toISOString();

    const [{ data: res }, { data: hist }] = await Promise.all([
      // bookings over the whole search window, for conflict checks
      busyQuery((t) => supabase.from(t).select("id,facility_id,start_time,end_time,status")
        .in("facility_id", ids).in("status", ["pending", "approved"])
        .lt("start_time", to).gt("end_time", from)),
      // recent demand for this category, for learning peak hours
      busyQuery((t) => supabase.from(t).select("start_time,end_time,status")
        .in("facility_id", ids).in("status", ["pending", "approved"])
        .gte("start_time", since)),
    ]);

    const peaks = learnPeakHours(hist ?? []);
    const preferredHour = Number(startTime.split(":")[0]);
    const out = recommendAcross({
      requested: facility, facilities: facilities.filter((x) => canBook(rules[x.id], profile?.member_type)), rules,
      reservations: (res as BusySlot[] | null) ?? [],
      date, durationMins: duration, participants, preferredHour,
      weights: profile?.rec_weights ?? DEFAULT_WEIGHTS,
      peaks, lookAheadDays: LOOK_AHEAD,
    });

    const stored = profile?.rec_bandit;
    const bandit = isBanditState(stored) ? stored : initBandit();
    const shown = rankWithBandit(out.slots, bandit).slice(0, 4);

    setSuggestions(shown);
    setSuggestCtx({ preferredHour, peaks });
    if (shown.length > 0) {
      logEvent("rec_shown", {
        num: shown.length,
        note: `peaks=${peaks.learned ? "learned" : "default"};lookahead=${out.usedLookAhead}`,
      });
    }
    if (shown.length === 0) toast.info(out.rejectedReason ?? "No free slots nearby - try another date.");
    else if (out.usedLookAhead)
      toast.info(`${fmtRelativeDay(date)} is full everywhere - showing the next days with space.`);
  }

  async function checkAndBook() {
    setChecking(true);
    setSuggestions(null);
    try {
      const { start, end } = buildWindow();
      const ruleError = validateRules(start, end);
      if (ruleError) { toast.error(ruleError); return; }
      const { data: clash } = await busyQuery((t) => supabase
        .from(t).select("id")
        .eq("facility_id", facility!.id)
        .in("status", ["pending", "approved"])
        .lt("start_time", end.toISOString()).gt("end_time", start.toISOString())
        .limit(1));
      if (clash && clash.length > 0) {
        toast.error("That time is taken. Here are the best alternatives:");
        await suggestAlternatives();
        return;
      }
      await bookAt(start, end);
    } finally {
      setChecking(false);
    }
  }

  // ---------- derived ----------
  const venues = Array.from(new Set(facilities.map((f) => f.venue)));
  const venueFacilities = facilities.filter((f) => f.venue === venue);
  const venueHours = hoursOf(venueFacilities.map((f) => rules[f.id]).filter(Boolean));
  // rooms this student can book first, so nothing locked is in the way
  const mixedTypes = new Set(venueFacilities.map((f) => f.type)).size > 1;
  const sortedRooms = [...venueFacilities].sort((a, b) =>
    Number(!canBook(rules[a.id], profile?.member_type)) - Number(!canBook(rules[b.id], profile?.member_type)));
  const facilityEquipment = facility
    ? equipment.filter((e) => e.facility_type === facility.type)
    : [];
  const rule = facility ? rules[facility.id] : null;
  const roomHours = hoursOf(rule ? [rule] : []);
  const durations = durationOptions(rule);
  const starts = timeOptions(rule, date, duration, new Date(nowMs || 0));
  const slotReady = starts.includes(startTime);
  const equipCount = Object.values(equipReq).reduce((a, q) => a + q, 0);

  // ---------- moving through the steps ----------
  function openRoom(f: Facility) {
    const r = rules[f.id];
    const d = clampDuration(duration, r);
    const clock = new Date();
    setVenue(f.venue);
    setFacility(f);
    setParticipants(Math.min(2, f.capacity));
    setDuration(d);
    setEquipReq({});
    setSuggestions(null);
    // comparing rooms: keep the chosen time if it also works here
    if (!timeOptions(r, date, d, clock).includes(startTime)) {
      const slot = firstSlot(r, d, clock);
      setDate(slot.date);
      setStartTime(slot.time);
    }
  }

  function chooseVenue(v: string) {
    const rooms = facilities.filter((f) => f.venue === v);
    // only one room: nothing to choose, so skip the step
    if (rooms.length === 1 && canBook(rules[rooms[0].id], profile?.member_type)) openRoom(rooms[0]);
    else setVenue(v);
  }

  function goToStep(index: number) {
    setFacility(null);
    if (index === 0) setVenue(null);
    setSuggestions(null);
  }

  function changeDate(d: string) {
    setDate(d);
    setStartTime(nearestTime(timeOptions(rule, d, duration, new Date()), startTime));
    setSuggestions(null);
  }

  function changeDuration(d: number) {
    setDuration(d);
    setStartTime(nearestTime(timeOptions(rule, date, d, new Date()), startTime));
    setSuggestions(null);
  }

  async function checkIn(r: Reservation) {
    const { error } = await supabase.from("reservations")
      .update({ checked_in_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Checked in - enjoy your session");
    if (profile) await loadBookings(profile.id);
  }

  // One booking at a time: a fast double click on a suggestion used to send
  // two inserts, and the second came back as a confusing "slot was taken".
  async function bookSuggestion(s: ScoredSlot, rank: number) {
    if (bookingKey) return;
    setBookingKey(`${s.facilityId}-${s.start.getTime()}`);
    try {
      await bookAt(s.start, s.end, s, rank);
    } finally {
      setBookingKey(null);
    }
  }

  async function copyCode(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("Code copied");
    } catch {
      toast.info(`Your code is ${code}`);
    }
  }

  async function showDoorCode(r: Reservation) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(`/api/bookings/code?id=${encodeURIComponent(r.id)}`, {
      headers: session ? { Authorization: `Bearer ${session.access_token}` } : {},
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) { toast.error(j.error ?? "Could not get the door code"); return; }
    setCodes((prev) => ({ ...prev, [r.id]: { code: j.code, hint: j.hint } }));
  }

  // +30 min on a running, checked-in booking, if the room is free next
  async function extend(r: Reservation) {
    if (extendingId) return;
    setExtendingId(r.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/bookings/extend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}),
        },
        body: JSON.stringify({ id: r.id }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { toast.error(j.error ?? "Could not extend the booking"); return; }
      toast.success(j.message);
      if (profile) await loadBookings(profile.id);
    } finally {
      setExtendingId(null);
    }
  }

  async function cancel(r: Reservation) {
    const ru = rules[r.facility_id];
    const hoursLeft = (new Date(r.start_time).getTime() - Date.now()) / 3600000;
    if (ru && hoursLeft < ru.cancellation_hours) {
      toast.error(`This facility needs ${ru.cancellation_hours}h cancellation notice.`);
      return;
    }
    const { error } = await supabase.from("reservations")
      .update({ status: "cancelled", cancel_reason: "user" }).eq("id", r.id);
    if (error) {
      // cancel_reason column arrives with upgrade-auto-release.sql; cancel regardless
      const retry = await supabase.from("reservations").update({ status: "cancelled" }).eq("id", r.id);
      if (retry.error) { toast.error(retry.error.message); return; }
    }
    toast.success("Booking cancelled");
    if (profile) await loadBookings(profile.id);
  }

  const now = nowMs;

  // My bookings: anything still to come or running first (soonest first),
  // history underneath and collapsed by default
  const isActive = (b: Reservation) =>
    (b.status === "approved" || b.status === "pending") && new Date(b.end_time).getTime() > now;
  const activeBookings = myBookings.filter(isActive)
    .sort((a, b) => a.start_time.localeCompare(b.start_time));
  const pastBookings = myBookings.filter((b) => !isActive(b));
  const pendingCount = activeBookings.filter((b) => b.status === "pending").length;
  // shown above the booking flow only when it is running or within a day
  const upNext = activeBookings[0] && new Date(activeBookings[0].start_time).getTime() - now < 86_400_000
    ? activeBookings[0] : null;

  const todayKey = myDateKey(new Date(now || 0));
  const issues = issuesByFacility(openIssues);
  const stepKey = !venue ? "venues" : !facility ? `venue:${venue}` : `facility:${facility.id}`;
  const recentRooms = recentFacilityIds(myBookings)
    .map((id) => facilities.find((f) => f.id === id))
    .filter((f): f is Facility => !!f && canBook(rules[f.id], profile?.member_type));
  const tomorrowKey = addDays(todayKey, 1);
  const quickDays = [
    { value: todayKey, label: "Today" },
    ...(rule && rule.max_advance_days >= 1 ? [{ value: tomorrowKey, label: "Tomorrow" }] : []),
  ];

  // a new step or new suggestions must not open off screen (long lists on phones)
  useEffect(() => {
    const top = flowRef.current?.getBoundingClientRect().top;
    if (top !== undefined && top < 72) window.scrollBy(0, top - 80);
  }, [stepKey]);
  const hasSuggestions = !!suggestions?.length;
  useEffect(() => {
    if (hasSuggestions) suggestionsRef.current?.scrollIntoView({ block: "nearest" });
  }, [hasSuggestions]);

  function renderBooking(b: Reservation, i: number) {
    const f = facilities.find((x) => x.id === b.facility_id);
    const start = new Date(b.start_time);
    const end = new Date(b.end_time);
    const [, dayNum, mon] = fmtDay(myDateKey(start)).split(" ");
    const hasDoor = doorRooms.has(b.facility_id);
    const ended = end.getTime() <= now;
    const running = b.status === "approved" && start.getTime() <= now && now < end.getTime();
    const canCheckIn = !hasDoor && b.status === "approved" && !b.checked_in_at && !b.no_show &&
      now >= start.getTime() - 15 * 60000 && now <= end.getTime();
    const canShowCode = hasDoor && b.status === "approved" && end.getTime() > now;
    const code = codes[b.id];
    const canCancel = (b.status === "pending" || b.status === "approved") &&
      start.getTime() > now && !b.checked_in_at;
    const noticeH = rules[b.facility_id]?.cancellation_hours ?? 0;
    const cancelOpen = start.getTime() - now >= noticeH * 3_600_000;
    const grace = rules[b.facility_id]?.checkin_grace_mins;
    const checkInBy = grace ? new Date(start.getTime() + grace * 60000) : null;
    const showDeadline = !!checkInBy && b.status === "approved" && !b.checked_in_at &&
      now >= start.getTime() - 15 * 60000 && now < checkInBy.getTime();
    const canExtend = running && !!b.checked_in_at;
    const endingSoon = canExtend && end.getTime() - now <= 10 * 60000;
    const released = b.status === "cancelled" && b.cancel_reason === "no_checkin";
    const faded = b.status === "cancelled" || b.status === "rejected" || ended;
    const reportable = canReport(b, now);
    const reports = myReports.filter((r) => r.reservation_id === b.id);

    return (
      <div key={b.id} style={stagger(i)}
        className={`animate-reveal stagger flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 transition-all
          ${running ? "border-primary/50 bg-accent/30" : ""} ${justBooked === b.id ? "ring-2 ring-primary/40" : ""} ${faded ? "opacity-70" : ""}`}>
        <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-lg
          ${running ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
          <span className="text-[10px] uppercase leading-none">{mon}</span>
          <span className="font-display text-lg font-semibold leading-tight">{dayNum}</span>
        </div>
        <div className="min-w-0 flex-1 basis-48">
          <p className="flex items-center gap-2 font-medium">
            {f?.name ?? "Facility"}
            {running && (
              <span className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
                Now
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {capitalise(fmtRelativeDay(myDateKey(start), new Date(now || 0)))}, {fmtTime(start)} - {fmtTime(end)}
            {f ? ` - ${f.venue}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 pt-1.5 empty:hidden">
            {released
              ? <Badge variant="destructive">Released - no check-in</Badge>
              // a finished booking that went ahead needs no "confirmed" label
              : !(b.status === "approved" && ended) && <Badge variant={STATUS_COLOR[b.status]}>{STATUS_LABEL[b.status]}</Badge>}
            {b.checked_in_at && <Badge variant="outline" className="gap-1"><CheckCircle2 className="h-3 w-3" />Checked in</Badge>}
            {b.cancel_reason === "early_leave" && b.status === "approved" && (
              <Badge variant="secondary">Ended early - room empty</Badge>
            )}
            {b.no_show && !released && <Badge variant="destructive">No-show</Badge>}
            {!!b.extended_mins && <Badge variant="outline">Extended +{b.extended_mins} min</Badge>}
          </div>
          {showDeadline && checkInBy && (
            <p className="pt-1.5 text-xs font-medium text-primary">
              {hasDoor ? "Enter your door code by " : "Check in by "}
              {fmtTime(checkInBy)} or this booking is released
            </p>
          )}
          {reports.map((r) => {
            const Icon = CATEGORY_ICON[r.category];
            const done = r.status === "resolved" || r.status === "dismissed";
            return (
              <p key={r.id} className={`mt-1.5 flex flex-wrap items-center gap-1.5 text-xs ${done ? "text-muted-foreground" : "text-foreground"}`}>
                <Icon className="h-3.5 w-3.5 shrink-0 text-primary" />
                You reported: {REPORT_CATEGORIES[r.category].toLowerCase()}
                <Badge variant={r.status === "resolved" ? "default" : r.status === "dismissed" ? "outline" : "secondary"} className="h-5 px-1.5 text-[10px]">
                  {REPORT_STATUS[r.status]}
                </Badge>
                {r.staff_note && <span className="text-muted-foreground">- {r.staff_note}</span>}
              </p>
            );
          })}
        </div>
        {/* filled button = what to do now; everything else stays quiet */}
        <div className="ml-auto flex flex-wrap justify-end gap-1.5">
          {canCheckIn && (
            <Button size="sm" className={showDeadline ? "animate-soft-pulse" : ""} onClick={() => checkIn(b)}>
              Check in
            </Button>
          )}
          {canShowCode && !code && (
            <Button size="sm" variant={start.getTime() - now <= 3_600_000 ? "default" : "outline"}
              className={`gap-1.5 ${showDeadline ? "animate-soft-pulse" : ""}`} onClick={() => showDoorCode(b)}>
              <KeyRound className="h-3.5 w-3.5" /> Door code
            </Button>
          )}
          {canExtend && (
            <Button size="sm" variant={endingSoon ? "default" : "outline"}
              className={`gap-1.5 ${endingSoon ? "animate-soft-pulse" : ""}`}
              disabled={!!extendingId} onClick={() => extend(b)}
              title="Add 30 minutes if the room is free next">
              {extendingId === b.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
              +30 min
            </Button>
          )}
          {canCancel && !cancelOpen && (
            <span className="self-center text-[11px] text-muted-foreground">Too late to cancel ({noticeH} h notice)</span>
          )}
          {canCancel && cancelOpen && (confirmCancel === b.id ? (
            <span className="animate-pop-in flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">Cancel this booking?</span>
              <Button size="sm" variant="destructive" onClick={() => { setConfirmCancel(null); cancel(b); }}>Yes, cancel</Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmCancel(null)}>Keep it</Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmCancel(b.id)}>Cancel</Button>
          ))}
          {reportable && (
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setReportFor(b)}
              title="Something wrong in the room? Tell the facility team">
              <MessageSquareWarning className="h-3.5 w-3.5" /> Report a problem
            </Button>
          )}
        </div>
        {code && (
          <div className="animate-pop-in flex w-full flex-wrap items-center gap-3 rounded-lg border border-primary/40 bg-accent/60 px-3 py-2">
            <span className="flex gap-1" style={{ perspective: "400px" }} aria-label={`Door code ${code.code}`}>
              {code.code.split("").map((d, k) => (
                <span key={k} style={{ animationDelay: `${120 + k * 70}ms` }}
                  className="animate-digit-in font-display flex h-9 w-7 items-center justify-center rounded-md bg-card text-xl font-semibold shadow-sm">
                  {d}
                </span>
              ))}
            </span>
            <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Copy code" aria-label="Copy code"
              onClick={() => copyCode(code.code)}>
              <Copy className="h-4 w-4" />
            </Button>
            <span className="min-w-40 flex-1 text-[11px] leading-snug text-muted-foreground">{code.hint}</span>
          </div>
        )}
      </div>
    );
  }

  const firstName = profile?.full_name.split(" ")[0];
  const stepTitle = !venue ? "Where do you want to book?"
    : !facility ? `Which room in ${venue}?`
    : `When do you need ${facility.name}?`;
  const stepHint = !venue ? "Pick a place to see what is free right now."
    : !facility ? "Choose a room. You pick the time next."
    : "If that time is taken, we suggest the closest free options.";

  return (
    <AppShell
      title={firstName ? `Hi, ${firstName}` : "Welcome"}
      subtitle="Book a campus room or court in three steps"
      role="student"
      userName={profile?.full_name}
      focused
    >
      {/* top-center: on phones a bottom toast covered the suggestion cards it was announcing */}
      <Toaster richColors position="top-center" />
      {loading ? (
        <DashboardSkeleton />
      ) : (
        <Tabs value={view} onValueChange={(v) => { setView(v as "book" | "bookings"); setJustBooked(null); }} className="gap-5">
          <TabsList className="w-full group-data-horizontal/tabs:h-10 sm:w-fit">
            <TabsTrigger value="book" className="px-4">
              <CalendarPlus className="h-4 w-4" /> Book
            </TabsTrigger>
            <TabsTrigger value="bookings" className="px-4">
              <CalendarDays className="h-4 w-4" /> My bookings
              {activeBookings.length > 0 && (
                <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-primary-foreground">
                  {activeBookings.length}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="book" className="space-y-5">
            {/* the one thing a returning student may need right now */}
            {upNext && !venue && (
              <section aria-label="Up next" className="animate-reveal space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Up next</h2>
                  {activeBookings.length > 1 && (
                    <button onClick={() => setView("bookings")} className="text-xs font-medium text-primary hover:underline">
                      See all {activeBookings.length}
                    </button>
                  )}
                </div>
                {renderBooking(upNext, 0)}
              </section>
            )}

            <Card ref={flowRef} className="animate-reveal min-w-0">
              <CardHeader className="gap-3 pb-1">
                <BookingSteps
                  current={!venue ? 0 : !facility ? 1 : 2}
                  steps={[
                    { label: "Place", value: venue ?? undefined },
                    { label: "Room", value: facility?.name },
                    { label: "Time" },
                  ]}
                  onGo={goToStep}
                />
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="font-display text-xl">{stepTitle}</CardTitle>
                    <CardDescription>{stepHint}</CardDescription>
                  </div>
                  {venue && (
                    <Button variant="outline" className="h-10 shrink-0 gap-2 border-primary/50 px-4 font-semibold text-primary hover:bg-accent hover:text-primary"
                      onClick={() => goToStep(facility && venueFacilities.length > 1 ? 1 : 0)}>
                      <ArrowLeft className="h-4 w-4" /> Back
                    </Button>
                  )}
                </div>
              </CardHeader>

              <CardContent>
                {loadError && (
                  <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
                    <p className="font-medium text-destructive">Could not load facilities</p>
                    <p className="pt-1 text-muted-foreground">{loadError}</p>
                    <p className="pt-1 text-xs text-muted-foreground">
                      If this mentions a missing table or view, run the latest migration
                      (supabase/setup-all.sql) in the Supabase SQL editor.
                    </p>
                  </div>
                )}
                {!loadError && facilities.length === 0 && (
                  <div className="flex flex-col items-center gap-2 py-12 text-center">
                    <MapPin className="h-8 w-8 text-muted-foreground/50" />
                    <p className="font-medium">No facilities available yet</p>
                    <p className="text-sm text-muted-foreground">
                      An administrator needs to add a facility type and its rooms/courts first.
                    </p>
                  </div>
                )}

                {/* keyed by step so moving venue -> room -> form replays the slide-in */}
                <div key={stepKey} className="animate-step-in">
                  {/* step 1: place */}
                  {!venue && (
                    <div className="space-y-4">
                      {recentRooms.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                            <History className="h-3.5 w-3.5" /> Book again
                          </span>
                          {recentRooms.map((f) => (
                            <button key={f.id} onClick={() => openRoom(f)}
                              className="rounded-full border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-primary hover:bg-muted">
                              {f.name} <span className="font-normal text-muted-foreground">- {f.venue}</span>
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {venues.map((v, i) => {
                          const inVenue = facilities.filter((f) => f.venue === v);
                          const freeCount = inVenue.filter((f) => !busyNow.has(f.id)).length;
                          return (
                            <button key={v} onClick={() => chooseVenue(v)} style={stagger(i)}
                              className="animate-reveal stagger flex items-stretch overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md sm:flex-col">
                              <div className="w-24 shrink-0 bg-muted/40 sm:h-24 sm:w-full">
                                <VenueArt name={v} types={inVenue.map((f) => f.type)} busy={freeCount === 0} />
                              </div>
                              <div className="min-w-0 flex-1 p-3">
                                <h3 className="font-display font-semibold">{v}</h3>
                                <p className="truncate text-xs text-muted-foreground">
                                  {Array.from(new Set(inVenue.map((f) => typeLabel(f.type)))).join(", ")}
                                </p>
                                <div className="pt-2">
                                  <Badge variant={freeCount ? "secondary" : "destructive"}>
                                    {freeCount ? `${freeCount} of ${inVenue.length} free now` : "All in use now"}
                                  </Badge>
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* step 2: room */}
                  {venue && !facility && (
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {sortedRooms.map((f, i) => {
                          const busy = busyNow.has(f.id);
                          const r = rules[f.id];
                          const locked = !canBook(r, profile?.member_type);
                          return (
                            <button key={f.id} disabled={locked} onClick={() => openRoom(f)} style={stagger(i)}
                              title={locked ? accessMessage(f.name, r) : undefined}
                              className={`animate-reveal stagger flex items-stretch overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all sm:flex-col ${
                                locked ? "cursor-not-allowed opacity-60" : "hover:-translate-y-0.5 hover:border-primary hover:shadow-md"}`}>
                              <div className={`w-24 shrink-0 bg-muted/40 sm:h-24 sm:w-full ${locked ? "grayscale" : ""}`}>
                                <FacilityIso type={f.type} busy={busy} />
                              </div>
                              <div className="min-w-0 flex-1 p-3">
                                <div className="flex items-start justify-between gap-2">
                                  <h3 className="font-display font-semibold">{f.name}</h3>
                                  {!locked && (
                                    <Badge variant={busy ? "destructive" : "secondary"} className="shrink-0">
                                      {busy ? "In use" : "Free now"}
                                    </Badge>
                                  )}
                                </div>
                                <p className="pt-0.5 text-xs text-muted-foreground">
                                  {mixedTypes ? `${typeLabel(f.type)} - ` : ""}up to {f.capacity} people{r ? ` - ${r.auto_approve ? "instant" : "needs approval"}` : ""}
                                </p>
                                {locked && (
                                  <p className="flex items-center gap-1 pt-1 text-xs font-medium">
                                    <Lock className="h-3 w-3" /> {accessLabel(r)}
                                  </p>
                                )}
                                {issues[f.id] && (
                                  <p className={`flex items-center gap-1 pt-1 text-xs font-medium ${issues[f.id].urgent ? "text-destructive" : "text-primary"}`}>
                                    <TriangleAlert className="h-3 w-3 shrink-0" />
                                    Known issue: {issues[f.id].categories.map((c) => REPORT_CATEGORIES[c].toLowerCase()).join(", ")}
                                  </p>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <Disclosure title="See when it is usually busy" icon={<BarChart3 className="h-4 w-4 text-primary" />}>
                        <PopularTimes
                          key={venue}
                          rooms={venueFacilities.map((f) => ({ id: f.id, name: f.name }))}
                          openHour={venueHours.open}
                          closeHour={venueHours.close}
                        />
                      </Disclosure>
                    </div>
                  )}

                  {/* step 3: time. Choices come from the room's rules, so most mistakes cannot be made. */}
                  {facility && (
                    <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
                      <div className="space-y-4">
                        {issues[facility.id] && (
                          <p className={`flex items-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium ${issues[facility.id].urgent ? "border-destructive/40 text-destructive" : "text-primary"}`}>
                            <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
                            Known issue: {issues[facility.id].categories.map((c) => REPORT_CATEGORIES[c].toLowerCase()).join(", ")}
                          </p>
                        )}
                        <div className="space-y-1.5">
                          <p className="text-sm font-medium">Day</p>
                          <div className="flex flex-wrap items-center gap-2">
                            <ChoiceChips label="Day" value={date} onChange={changeDate} options={quickDays} />
                            <Input type="date" aria-label="Date" value={date}
                              min={todayKey}
                              max={rule ? addDays(todayKey, rule.max_advance_days) : undefined}
                              className={`h-9 w-auto ${quickDays.some((d) => d.value === date) ? "text-muted-foreground" : "border-primary"}`}
                              onChange={(e) => { if (e.target.value) changeDate(e.target.value); }} />
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-x-8 gap-y-4">
                          <div className="space-y-1.5">
                            <p className="text-sm font-medium">Start time</p>
                            {starts.length === 0 ? (
                              <p className="flex h-9 items-center text-sm text-muted-foreground">No times left that day - try another day.</p>
                            ) : (
                              <Select value={slotReady ? startTime : ""} onValueChange={(v) => { setStartTime(v); setSuggestions(null); }}>
                                <SelectTrigger aria-label="Start time" className="w-44"><SelectValue placeholder="Pick a time" /></SelectTrigger>
                                <SelectContent>
                                  {starts.map((t) => <SelectItem key={t} value={t}>{fmtTime(myAt(date, t))}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                          <div className="space-y-1.5">
                            <p className="text-sm font-medium">How long</p>
                            {durations.length <= 6 ? (
                              <ChoiceChips label="How long" value={duration} onChange={changeDuration}
                                options={durations.map((d) => ({ value: d, label: fmtDuration(d) }))} />
                            ) : (
                              <Select value={String(duration)} onValueChange={(v) => changeDuration(Number(v))}>
                                <SelectTrigger aria-label="How long" className="w-44"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {durations.map((d) => <SelectItem key={d} value={String(d)}>{fmtDuration(d)}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1.5">
                          <p className="text-sm font-medium">
                            People <span className="font-normal text-muted-foreground">(max {facility.capacity})</span>
                          </p>
                          <div className="flex items-center gap-1.5">
                            <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="One person fewer" disabled={participants <= 1}
                              onClick={() => { setParticipants(Math.max(1, participants - 1)); setSuggestions(null); }}>-</Button>
                            <Input type="number" aria-label="People joining" min={1} max={facility.capacity} value={participants}
                              className="h-9 w-16 text-center"
                              onChange={(e) => { setParticipants(Math.max(1, Number(e.target.value) || 1)); setSuggestions(null); }} />
                            <Button variant="outline" size="sm" className="h-9 w-9 p-0" aria-label="One person more" disabled={participants >= facility.capacity}
                              onClick={() => { setParticipants(participants + 1); setSuggestions(null); }}>+</Button>
                          </div>
                        </div>

                        <div className="space-y-2 pt-1">
                          <Disclosure
                            title={facilityEquipment.length > 0 ? "Add a purpose or equipment" : "Add a purpose"}
                            hint={equipCount > 0 ? `${equipCount} item${equipCount === 1 ? "" : "s"}` : "Optional"}
                            icon={<PackagePlus className="h-4 w-4 text-primary" />}>
                            <div className="space-y-3">
                              <div className="space-y-1.5">
                                <p className="text-xs font-medium">Purpose</p>
                                <Input aria-label="Purpose" placeholder="e.g. group assignment discussion" value={purpose}
                                  onChange={(e) => setPurpose(e.target.value)} />
                              </div>
                              {facilityEquipment.length > 0 && (
                                <div className="space-y-1.5">
                                  <p className="text-xs font-medium">
                                    Equipment <span className="font-normal text-muted-foreground">(checked against stock when you book)</span>
                                  </p>
                                  {facilityEquipment.map((e) => {
                                    const q = equipReq[e.id] ?? 0;
                                    return (
                                      <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2">
                                        <div>
                                          <p className="text-sm font-medium">{e.name}</p>
                                          <p className="text-xs text-muted-foreground">{e.total_qty} in stock</p>
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={q === 0} aria-label={`One ${e.name} fewer`}
                                            onClick={() => setEquipReq({ ...equipReq, [e.id]: q - 1 })}>-</Button>
                                          <span className={`w-5 text-center text-sm ${q ? "font-semibold text-primary" : ""}`}>{q}</span>
                                          <Button size="sm" variant="outline" className="h-8 w-8 p-0" disabled={q >= e.total_qty} aria-label={`One ${e.name} more`}
                                            onClick={() => setEquipReq({ ...equipReq, [e.id]: q + 1 })}>+</Button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </Disclosure>
                          <Disclosure title="See when this room is usually busy" icon={<BarChart3 className="h-4 w-4 text-primary" />}>
                            <PopularTimes
                              key={facility.id}
                              rooms={[{ id: facility.id, name: facility.name }]}
                              openHour={roomHours.open}
                              closeHour={roomHours.close}
                            />
                          </Disclosure>
                        </div>
                      </div>

                      {/* review, then the one primary action */}
                      <aside aria-label="Your booking" className="space-y-3 lg:sticky lg:top-20">
                        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
                          <div>
                            <p className="font-display text-lg font-semibold leading-tight">{facility.name}</p>
                            <p className="text-xs text-muted-foreground">{typeLabel(facility.type)} - {facility.venue}</p>
                          </div>
                          <ul className="space-y-1.5 text-sm">
                            <li className="flex items-center gap-2">
                              <CalendarDays className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {capitalise(fmtRelativeDay(date, new Date(now || 0)))}
                              {date <= addDays(todayKey, 1) && <span className="text-muted-foreground">{fmtDay(date)}</span>}
                            </li>
                            <li className="flex items-center gap-2">
                              <Clock className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {slotReady
                                ? `${fmtTime(myAt(date, startTime))} - ${fmtTime(new Date(myAt(date, startTime).getTime() + duration * 60000))}`
                                : <span className="text-muted-foreground">Pick a time</span>}
                            </li>
                            <li className="flex items-center gap-2">
                              <Users2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                              {participants} {participants === 1 ? "person" : "people"}
                            </li>
                            {equipCount > 0 && (
                              <li className="flex items-center gap-2">
                                <PackagePlus className="h-4 w-4 shrink-0 text-muted-foreground" />
                                {equipCount} equipment item{equipCount === 1 ? "" : "s"}
                              </li>
                            )}
                          </ul>
                          <Button className="w-full gap-2" size="lg" onClick={checkAndBook} disabled={checking || !slotReady}
                            variant={suggestions?.length ? "outline" : "default"}>
                            {checking ? (
                              <><Loader2 className="h-4 w-4 animate-spin" /> Checking availability...</>
                            ) : rule?.auto_approve ? "Book this time" : "Request this time"}
                          </Button>
                          <div className="space-y-1 text-xs text-muted-foreground">
                            <p>{rule?.auto_approve ? "Confirmed straight away." : "Staff approve this first - you will be notified."}</p>
                            {rule && <p>{rule.cancellation_hours > 0 ? `You can cancel up to ${rule.cancellation_hours} h before.` : "You can cancel any time before it starts."}</p>}
                            {(accessLabel(rule) || limitsLabel(rule)) && (
                              <p>{[accessLabel(rule), limitsLabel(rule) && `Fair use: ${limitsLabel(rule)}`].filter(Boolean).join(" - ")}</p>
                            )}
                          </div>
                        </div>

                        {suggestions && suggestions.length > 0 && (
                          <div ref={suggestionsRef} className="animate-field-in space-y-2 rounded-xl border border-primary/30 bg-accent/40 p-3">
                            <p className="flex items-center gap-1.5 text-sm font-medium">
                              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                              That time is taken - AI-ranked alternatives:
                            </p>
                            <div className="grid gap-2">
                              {suggestions.map((s, i) => {
                                const key = `${s.facilityId}-${s.start.getTime()}`;
                                const isBooking = bookingKey === key;
                                return (
                                  <button key={key} onClick={() => bookSuggestion(s, i)}
                                    disabled={bookingKey !== null}
                                    style={stagger(i)}
                                    className={`animate-reveal stagger relative rounded-lg border bg-card p-3 text-left transition-all
                                      hover:-translate-y-0.5 hover:border-primary hover:shadow-md active:translate-y-0 active:scale-[0.99]
                                      disabled:cursor-wait disabled:opacity-60 disabled:hover:translate-y-0
                                      ${i === 0 ? "border-primary/60 ring-2 ring-primary/15" : ""}
                                      ${isBooking ? "!opacity-100 border-primary" : ""}`}>
                                    <div className="flex items-center justify-between">
                                      <span className="font-display font-semibold">
                                        {fmtTime(s.start)} - {fmtTime(s.end)}
                                      </span>
                                      {isBooking ? (
                                        <span className="flex items-center gap-1.5 text-xs font-medium text-primary">
                                          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                                          Booking
                                        </span>
                                      ) : i === 0 && (
                                        <Badge className="animate-pop-in gap-1" style={{ animationDelay: "250ms" }}>
                                          <Sparkles className="h-3 w-3" /> Best
                                        </Badge>
                                      )}
                                    </div>
                                    {(s.facilityId !== facility.id || s.dateKey !== date) && (
                                      <span className="block pt-0.5 text-xs font-medium text-primary">
                                        {s.facilityId !== facility.id ? s.facilityName : facility.name}
                                        {s.dateKey !== date && ` - ${fmtRelativeDay(s.dateKey)}`}
                                      </span>
                                    )}
                                    {s.reasons.length > 0 && (
                                      <span className="block pt-0.5 text-xs text-muted-foreground">{s.reasons.join(" - ")}</span>
                                    )}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </aside>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="bookings">
            <Card className="animate-reveal">
              <CardHeader className="pb-2">
                <CardTitle className="font-display text-xl">My bookings</CardTitle>
                <CardDescription>
                  {activeBookings.length} coming up{pendingCount > 0 ? ` - ${pendingCount} waiting for approval` : ""}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {myBookings.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <CalendarX className="h-8 w-8 text-muted-foreground/50" />
                    <p className="font-medium">No bookings yet</p>
                    <Button onClick={() => setView("book")}>Make your first booking</Button>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="space-y-2">
                      {activeBookings.length === 0 ? (
                        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">
                          Nothing coming up.
                          <Button size="sm" onClick={() => setView("book")}>Book a room</Button>
                        </div>
                      ) : activeBookings.map((b, i) => renderBooking(b, i))}
                    </div>
                    {pastBookings.length > 0 && (
                      <div>
                        <button onClick={() => setShowPast((v) => !v)}
                          className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                          aria-expanded={showPast}>
                          <ChevronDown className={`h-4 w-4 transition-transform duration-300 ${showPast ? "rotate-180" : ""}`} />
                          Past and cancelled ({pastBookings.length})
                        </button>
                        {showPast && (
                          <div className="space-y-2 pt-2">
                            {pastBookings.map((b, i) => renderBooking(b, i))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
      {reportFor && (
        <ReportProblemDialog open={!!reportFor} onOpenChange={(v) => { if (!v) setReportFor(null); }}
          facilityId={reportFor.facility_id}
          facilityName={facilities.find((x) => x.id === reportFor.facility_id)?.name ?? "the room"}
          reservationId={reportFor.id}
          onSent={() => { if (profile) loadBookings(profile.id); }} />
      )}
      <Chatbot />
    </AppShell>
  );
}
