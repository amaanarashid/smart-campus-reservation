"use client";

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import {
  Facility, FacilityRule, Profile, Reservation, Equipment, typeLabel,
  LostFoundItem, LostFoundCategory, LostFoundStatus, LOST_FOUND_CATEGORIES,
} from "@/lib/types";
import { fmtDay, fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { toast, Toaster } from "sonner";
import AppShell from "@/components/app-shell";
import FacilityIso from "@/components/facility-iso";
import RoomReports from "@/components/room-reports";
import NoShowBadge, { type BookingRisk } from "@/components/noshow-badge";
import { useConfirm } from "@/components/confirm-dialog";
import { issuesByFacility, type ReportCategory, type ReportUrgency } from "@/lib/reports";
import { ensureProfile } from "@/lib/profile";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { ReasonDialog, StaffBookingDialog } from "@/components/staff-booking";
import { CANCEL_REASONS, REJECT_REASONS, UPGRADE_HINT, needsStaffUpgrade } from "@/lib/staff-booking";

// smart-room section (charts, remote control) in its own bundle
// one room's live view (three.js twin, remote control) in its own bundle
const FacilityDetail = dynamic(() => import("@/components/facility-detail"), {
  loading: () => <div className="skeleton h-64 rounded-xl" />,
});
import {
  ArrowLeft, Ban, Boxes, CalendarDays, CalendarPlus, Check, CheckCircle2, Inbox, Loader2, MapPin, Radio,
  PackageSearch, UserX, Users2, X, TriangleAlert,
} from "lucide-react";

interface Row extends Reservation {
  profiles: { full_name: string } | null;
}

type View = "requests" | "schedule" | "rooms" | "lost" | "equipment";
type RoomView = "requests" | "schedule" | "live" | "problems" | "lost";
type OpenIssue = { facility_id: string; category: ReportCategory; urgency: ReportUrgency };

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
const initials = (name?: string | null) =>
  (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const mins = (r: Reservation) =>
  Math.round((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtDur = (m: number) => (m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** Small count bubble on a tab. */
function Count({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold leading-4 text-primary-foreground">
      {n}
    </span>
  );
}

/** Centered "nothing here" message used by every tab. */
function Empty({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-12 text-center">
      {icon}
      <p className="font-medium">{title}</p>
      <p className="text-sm text-muted-foreground">{text}</p>
    </div>
  );
}

/** Today's opening hours as a bar, with approved and pending bookings as blocks and a "now" line. */
function DayTimeline({ rule, bookings, now }: { rule?: FacilityRule; bookings: Row[]; now: number }) {
  const today = myDateKey(new Date(now || 0));
  const open = myAt(today, rule?.open_time.slice(0, 5) ?? "08:00").getTime();
  const close = myAt(today, rule?.close_time.slice(0, 5) ?? "22:00").getTime();
  const span = Math.max(close - open, 1);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - open) / span) * 100));
  const nowPct = now >= open && now <= close ? pct(now) : null;
  return (
    <div>
      <div className="relative h-3 overflow-hidden rounded-full bg-muted">
        {bookings.map((b) => {
          const s = pct(new Date(b.start_time).getTime());
          const e = pct(new Date(b.end_time).getTime());
          if (e <= s) return null;
          return (
            <div key={b.id}
              title={`${fmtTime(new Date(b.start_time))} - ${fmtTime(new Date(b.end_time))} · ${b.booking_kind === "block" ? "blocked" : b.profiles?.full_name ?? "student"} (${b.status})`}
              className={`absolute inset-y-0 ${b.status === "approved" ? "bg-primary" : "bg-primary/35"}`}
              style={{ left: `${s}%`, width: `${e - s}%` }} />
          );
        })}
        {nowPct !== null && (
          <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `${nowPct}%` }} />
        )}
      </div>
      <div className="flex justify-between pt-1 text-[10px] text-muted-foreground">
        <span>{fmtTime(new Date(open))}</span>
        <span>{fmtTime(new Date(close))}</span>
      </div>
    </div>
  );
}

function ManagerSkeleton() {
  return (
    <div className="space-y-5">
      <div className="skeleton h-10 w-full sm:w-[34rem]" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}
      </div>
    </div>
  );
}

export default function ManagerDashboard() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [rules, setRules] = useState<Record<string, FacilityRule>>({});
  const [pending, setPending] = useState<Row[]>([]);
  const [upcoming, setUpcoming] = useState<Row[]>([]);

  const [equipByRes, setEquipByRes] = useState<Record<string, string>>({});
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [newEquip, setNewEquip] = useState({ type: "", name: "", qty: 1 });

  const [lostItems, setLostItems] = useState<LostFoundItem[]>([]);
  const [lfFilter, setLfFilter] = useState<"all" | LostFoundStatus>("unclaimed");
  const emptyLf = {
    facility_id: "", item_name: "", category: "other" as LostFoundCategory,
    description: "", found_location: "", found_date: myDateKey(),
    reporter_name: "",
  };
  const [newLf, setNewLf] = useState({ ...emptyLf });
  // "Claimed" asks for the claimant in a dialog (window.prompt froze the page)
  const [claiming, setClaiming] = useState<LostFoundItem | null>(null);
  const [claim, setClaim] = useState({ name: "", contact: "" });

  // UI state
  const [view, setView] = useState<View>("rooms");
  const [selected, setSelected] = useState<string | null>(null); // open room (null = all rooms)
  const [roomView, setRoomView] = useState<RoomView>("requests");
  const [openIssues, setOpenIssues] = useState<OpenIssue[]>([]);
  const [acting, setActing] = useState<string | null>(null);     // row being saved
  const [nowMs, setNowMs] = useState(0);                          // ticking clock (never Date.now() in render)
  const [risks, setRisks] = useState<Record<string, BookingRisk>>({}); // no-show risk per booking (next 24 h)
  const [confirmDialog, confirm] = useConfirm();
  // reject / cancel ask for a reason first; walk-in booking and room block share one dialog
  const [reasonFor, setReasonFor] = useState<{ row: Row; mode: "reject" | "cancel" } | null>(null);
  const [staffBooking, setStaffBooking] = useState(false);

  // Queries run in parallel waves (setup -> my rooms' data -> per-booking extras)
  // so a refresh waits for 3 round trips instead of ~9 in a row.
  const load = useCallback(async (prof: Profile) => {
    const [{ data: f }, { data: ru }, { data: fm }] = await Promise.all([
      supabase.from("facilities_full").select("*").order("name"),
      supabase.from("effective_facility_rules").select("*"),
      // scope: admins see everything; managers only their assigned facilities
      prof.role === "admin"
        ? Promise.resolve({ data: null })
        : supabase.from("facility_managers").select("facility_id").eq("manager_id", prof.id),
    ]);
    const facs = (f as Facility[]) ?? [];
    setFacilities(facs);
    const rm: Record<string, FacilityRule> = {};
    ((ru as FacilityRule[]) ?? []).forEach((r) => { rm[r.facility_id] = r; });
    setRules(rm);

    const ids: string[] = prof.role === "admin"
      ? facs.map((x) => x.id)
      : ((fm as { facility_id: string }[] | null) ?? []).map((x) => x.facility_id);
    setAssignedIds(ids);

    if (ids.length === 0) {
      setPending([]); setUpcoming([]); setEquipment([]); setEquipByRes({});
      return;
    }

    // today starts at midnight Malaysia time, whatever the browser's timezone
    const todayStart = myAt(myDateKey(), "00:00");
    // equipment for my facility categories
    const myTypes = Array.from(new Set(facs.filter((x) => ids.includes(x.id)).map((x) => x.type)));
    const [{ data: p }, { data: u }, { data: eq }, { data: lf }, { data: iss }] = await Promise.all([
      supabase.from("reservations").select("*, profiles(full_name)")
        .eq("status", "pending").in("facility_id", ids).order("start_time"),
      supabase.from("reservations").select("*, profiles(full_name)")
        .eq("status", "approved").in("facility_id", ids)
        .gte("start_time", todayStart.toISOString())
        .order("start_time").limit(60),
      supabase.from("equipment").select("*").in("facility_type", myTypes).order("name"),
      // lost & found for my facilities
      supabase.from("lost_and_found").select("*").in("facility_id", ids)
        .order("created_at", { ascending: false }),
      // open room problems, for the badges on the room cards (absent before upgrade-room-reports.sql)
      supabase.from("facility_open_issues").select("facility_id, category, urgency").in("facility_id", ids),
    ]);
    setPending((p as Row[]) ?? []);
    setUpcoming((u as Row[]) ?? []);
    setEquipment((eq as Equipment[]) ?? []);
    setLostItems((lf as LostFoundItem[]) ?? []);
    setOpenIssues((iss as OpenIssue[]) ?? []);

    // requested equipment per pending reservation + no-show risk badges
    // (scored for the next 24 h; absent before upgrade-noshow.sql)
    const resIds = (p ?? []).map((x) => x.id);
    const scoredIds = [...(p ?? []), ...(u ?? [])].map((x) => x.id);
    const [{ data: re }, { data: br }] = await Promise.all([
      resIds.length > 0
        ? supabase.from("reservation_equipment").select("reservation_id, qty, equipment(name)").in("reservation_id", resIds)
        : Promise.resolve({ data: [] }),
      scoredIds.length > 0
        ? supabase.from("booking_risk").select("reservation_id, risk, reasons, threshold").in("reservation_id", scoredIds)
        : Promise.resolve({ data: [] }),
    ]);
    const m: Record<string, string> = {};
    (re as { reservation_id: string; qty: number; equipment: { name: string } | null }[] | null)?.forEach((x) => {
      const label = `${x.qty}x ${x.equipment?.name ?? "item"}`;
      m[x.reservation_id] = m[x.reservation_id] ? `${m[x.reservation_id]}, ${label}` : label;
    });
    setEquipByRes(m);
    const rk: Record<string, BookingRisk> = {};
    ((br as BookingRisk[] | null) ?? []).forEach((x) => { rk[x.reservation_id] = x; });
    setRisks(rk);
  }, []);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const prof = await ensureProfile();
      if (!prof) { router.replace("/login"); return; }
      if (prof.role !== "facility_manager" && prof.role !== "admin") { router.replace("/login"); return; }
      setProfile(prof);
      await load(prof);
      setNowMs(Date.now());
      setLoading(false);
    })();
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [router, load]);

  // new requests, check-ins and lost-and-found appear without reloading
  useAutoRefresh(() => profile && load(profile), 20_000, !loading && !!profile);

  async function decide(r: Row, status: "approved" | "rejected") {
    if (acting) return;
    // a rejection needs a written reason, because the student is shown it
    if (status === "rejected") { setReasonFor({ row: r, mode: "reject" }); return; }
    setActing(r.id);
    const { error } = await supabase.from("reservations").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); setActing(null); return; }
    toast.success("Request approved");
    if (profile) await load(profile);
    setActing(null);
  }

  /** Reject a request or cancel an approved booking, saving the reason the student will read. */
  async function submitReason(reason: string) {
    if (!reasonFor || acting) return;
    const { row, mode } = reasonFor;
    setActing(row.id);
    const patch = mode === "reject"
      ? { status: "rejected", staff_note: reason }
      : { status: "cancelled", cancel_reason: "staff", staff_note: reason };
    let { error } = await supabase.from("reservations").update(patch).eq("id", row.id);
    let noteLost = false;
    if (error && needsStaffUpgrade(error)) {
      // cancelling without telling the student why is the thing this exists to prevent
      if (mode === "cancel") { toast.error(`The booking was not cancelled. ${UPGRADE_HINT}`); setActing(null); return; }
      // rejecting worked before reasons existed: still reject, and say the reason was not saved
      ({ error } = await supabase.from("reservations").update({ status: "rejected" }).eq("id", row.id));
      noteLost = true;
    }
    if (error) { toast.error(error.message); setActing(null); return; }
    if (noteLost) toast.warning(`Request rejected, but the reason was not saved. ${UPGRADE_HINT}`);
    else toast.success(mode === "reject" ? "Request rejected. The student is told why." : "Booking cancelled. The student is told why.");
    setReasonFor(null);
    if (profile) await load(profile);
    setActing(null);
  }

  /** A block belongs to staff, so removing one needs no reason and notifies nobody. */
  async function removeBlock(r: Row) {
    if (acting) return;
    const start = new Date(r.start_time);
    const ok = await confirm({
      title: "Remove this block?",
      body: `${fLabel(r.facility_id)}, ${fmtRelativeDay(myDateKey(start), new Date(nowMs || 0))} ${fmtTime(start)} - ${fmtTime(new Date(r.end_time))}. Students will be able to book that time again.`,
      action: "Remove block",
      destructive: true,
    });
    if (!ok) return;
    setActing(r.id);
    const { error } = await supabase.from("reservations").update({ status: "cancelled", cancel_reason: "staff" }).eq("id", r.id);
    if (error) { toast.error(needsStaffUpgrade(error) ? UPGRADE_HINT : error.message); setActing(null); return; }
    toast.success("Block removed");
    if (profile) await load(profile);
    setActing(null);
  }

  async function markAttendance(r: Reservation, kind: "checked_in" | "no_show") {
    if (acting) return;
    setActing(r.id);
    const patch = kind === "checked_in"
      ? { checked_in_at: new Date().toISOString(), no_show: false }
      : { no_show: true };
    const { error } = await supabase.from("reservations").update(patch).eq("id", r.id);
    if (error) { toast.error(error.message); setActing(null); return; }
    toast.success(kind === "checked_in" ? "Marked as attended" : "Marked as no-show");
    if (profile) await load(profile);
    setActing(null);
  }

  async function saveQty(e: Equipment, qty: number) {
    const { error } = await supabase.from("equipment").update({ total_qty: qty }).eq("id", e.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`${e.name}: ${qty} in inventory`);
    if (profile) await load(profile);
  }

  async function addEquipment() {
    if (!newEquip.type || !newEquip.name.trim()) { toast.error("Pick a category and enter an item name"); return; }
    if (!Number.isFinite(newEquip.qty) || newEquip.qty < 1) { toast.error("Quantity must be at least 1"); return; }
    setActing("equip");
    const { error } = await supabase.from("equipment").insert({
      facility_type: newEquip.type, name: newEquip.name.trim(), total_qty: newEquip.qty,
    });
    setActing(null);
    if (error) { toast.error(error.message); return; }
    toast.success(`${newEquip.name.trim()} added`);
    setNewEquip({ type: "", name: "", qty: 1 });
    if (profile) await load(profile);
  }

  async function logLostItem() {
    if (!newLf.facility_id || !newLf.item_name.trim()) {
      toast.error("Pick the room and enter what was found"); return;
    }
    setActing("lf");
    const { error } = await supabase.from("lost_and_found").insert({
      facility_id: newLf.facility_id,
      item_name: newLf.item_name.trim(),
      category: newLf.category,
      description: newLf.description || null,
      found_location: newLf.found_location || null,
      found_date: newLf.found_date,
      reporter_name: newLf.reporter_name || null,
      logged_by: profile?.id ?? null,
    });
    setActing(null);
    if (error) { toast.error(error.message); return; }
    toast.success("Item logged to lost & found");
    setNewLf({ ...emptyLf });
    setLfFilter("unclaimed");
    if (profile) await load(profile);
  }

  async function setLfStatus(item: LostFoundItem, status: LostFoundStatus, extra: Partial<LostFoundItem> = {}) {
    if (status === "disposed") {
      const ok = await confirm({
        title: `Dispose of "${item.item_name}"?`,
        body: "It leaves the unclaimed list for good. Only do this once it has been thrown away or donated.",
        action: "Dispose",
        destructive: true,
      });
      if (!ok) return;
    }
    setActing(item.id);
    const { error } = await supabase.from("lost_and_found").update({ status, ...extra }).eq("id", item.id);
    setActing(null);
    if (error) { toast.error(error.message); return false; }
    toast.success(`Marked ${status}`);
    if (profile) await load(profile);
    return true;
  }

  function openClaim(item: LostFoundItem) {
    setClaim({ name: "", contact: "" });
    setClaiming(item);
  }

  async function saveClaim() {
    if (!claiming) return;
    if (!claim.name.trim()) { toast.error("Enter the name of the person collecting it"); return; }
    const ok = await setLfStatus(claiming, "claimed", {
      claimant_name: claim.name.trim(),
      claimant_contact: claim.contact.trim() || null,
    });
    if (ok) setClaiming(null);
  }

  function openRoom(id: string) {
    setSelected(id);
    // land on the queue if this room has live requests, otherwise its schedule
    const waiting = pending.some((r) => r.facility_id === id && new Date(r.end_time).getTime() > nowMs);
    setRoomView(waiting ? "requests" : "schedule");
    setNewLf((lf) => ({ ...lf, facility_id: id }));
    window.scrollTo({ top: 0 });
  }

  function closeRoom() {
    setSelected(null);
    setNewLf((lf) => ({ ...lf, facility_id: "" }));
  }

  async function refreshIssues() {
    const { data: iss } = await supabase.from("facility_open_issues").select("facility_id, category, urgency").in("facility_id", assignedIds);
    setOpenIssues((iss as OpenIssue[]) ?? []);
  }

  // ---------- derived ----------
  const now = nowMs;
  const todayKey = myDateKey(new Date(now || 0));
  const myTypes = Array.from(
    new Set(facilities.filter((f) => assignedIds.includes(f.id)).map((f) => f.type))
  );
  const myFacilities = facilities.filter((f) => assignedIds.includes(f.id));
  const fById = (id: string) => facilities.find((f) => f.id === id);
  const fLabel = (id: string) => fById(id)?.name ?? "-";
  const roomLost = selected ? lostItems.filter((i) => i.facility_id === selected) : lostItems;
  const filteredLost = lfFilter === "all" ? roomLost : roomLost.filter((i) => i.status === lfFilter);
  const unclaimed = roomLost.filter((i) => i.status === "unclaimed").length;
  const LF_STATUS_COLOR: Record<LostFoundStatus, "default" | "secondary" | "destructive" | "outline"> = {
    unclaimed: "secondary", claimed: "default", returned: "outline", disposed: "destructive",
  };

  const isRunning = (r: Reservation) =>
    new Date(r.start_time).getTime() <= now && new Date(r.end_time).getTime() > now;
  const inUse = new Set(upcoming.filter(isRunning).map((r) => r.facility_id));
  const onDay = (r: Reservation, key: string) => myDateKey(new Date(r.start_time)) === key;
  const todayAll = [...upcoming, ...pending].filter((r) => onDay(r, todayKey));
  const needsAttendance = (r: Reservation) =>
    new Date(r.start_time).getTime() <= now && !r.checked_in_at && !r.no_show;

  const byFacility = (r: Reservation) => !selected || r.facility_id === selected;
  // requests whose time has passed can only be rejected: put them after the live ones
  const shownPending = pending.filter(byFacility).sort((a, b) =>
    Number(new Date(a.end_time).getTime() <= now) - Number(new Date(b.end_time).getTime() <= now));
  const shownUpcoming = upcoming
    .filter(byFacility)
    .filter((r) => new Date(r.end_time).getTime() > now || onDay(r, todayKey));
  const awaitingAttendance = upcoming.filter(byFacility).filter(needsAttendance).length;
  // group the schedule by day
  const days: [string, Row[]][] = [];
  shownUpcoming.forEach((r) => {
    const k = myDateKey(new Date(r.start_time));
    const g = days.find(([d]) => d === k);
    if (g) g[1].push(r); else days.push([k, [r]]);
  });
  const issues = issuesByFacility(openIssues);
  const problemCount = myFacilities
    .filter((f) => !selected || f.id === selected)
    .reduce((n, f) => n + (issues[f.id]?.count ?? 0), 0);
  const firstName = profile?.full_name.split(" ")[0];
  const selectedFacility = selected ? myFacilities.find((f) => f.id === selected) ?? null : null;

  // the same lists serve "all my rooms" and one open room (they follow `selected`)
  const requestsPane = (
    <>
            <p className="text-sm text-muted-foreground">
              {selected ? "Requests for this room" : "Requests for all your rooms"}, soonest first. The student is told either way.
            </p>
            {shownPending.length === 0 ? (
              <Card>
                <CardContent>
                  <Empty icon={<CheckCircle2 className="h-9 w-9 text-primary/60" />}
                    title="All caught up" text="No requests are waiting for you." />
                </CardContent>
              </Card>
            ) : (
              /* two requests side by side once the screen is wide enough */
              <div className="grid gap-3 xl:grid-cols-2">
              {shownPending.map((r, i) => {
                const f = fById(r.facility_id);
                const start = new Date(r.start_time);
                const end = new Date(r.end_time);
                const busyHere = acting === r.id;
                const over = f ? r.participants > f.capacity : false;
                const ended = end.getTime() <= now;
                const started = !ended && start.getTime() <= now;
                return (
                  <div key={r.id} style={stagger(i)}
                    className={`animate-reveal stagger flex flex-col gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-sm sm:flex-row ${ended ? "opacity-75" : ""}`}>
                    <div className="hidden h-20 w-24 shrink-0 overflow-hidden rounded-lg bg-muted/40 sm:block">
                      {f && <FacilityIso type={f.type} busy={false} />}
                    </div>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-foreground">
                          {initials(r.profiles?.full_name)}
                        </span>
                        <span className="font-medium">{r.profiles?.full_name ?? "Student"}</span>
                        <span className="text-xs text-muted-foreground">wants {f?.name ?? "a facility"}</span>
                        <NoShowBadge risk={risks[r.id]} />
                      </div>
                      <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1 font-medium text-foreground">
                          <CalendarDays className="h-3.5 w-3.5 text-primary" />
                          {/* one text node: in a flex row a separate "," got its own gap ("Aug , 2 pm") */}
                          <span>{cap(fmtRelativeDay(myDateKey(start), new Date(now || 0)))}, {fmtTime(start)} - {fmtTime(end)}</span>
                        </span>
                        <span>{fmtDur(mins(r))}</span>
                        <span className={`flex items-center gap-1 ${over ? "font-medium text-destructive" : ""}`}>
                          <Users2 className="h-3.5 w-3.5" /> {r.participants}{f ? ` / ${f.capacity}` : ""}
                          {over && " (over capacity)"}
                        </span>
                        {(started || ended) && (
                          <span className="font-medium text-destructive">
                            {ended ? "Already over" : "Already started"}
                          </span>
                        )}
                      </p>
                      {r.purpose && <p className="line-clamp-2 text-sm">&ldquo;{r.purpose}&rdquo;</p>}
                      {equipByRes[r.id] && (
                        <p className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Boxes className="h-3.5 w-3.5" /> {equipByRes[r.id]}
                        </p>
                      )}
                    </div>
                    <div className="flex shrink-0 gap-1.5 sm:flex-col">
                      {/* a request whose time has passed can only be cleared, not approved */}
                      {!ended && (
                        <Button className="h-9 px-3 text-sm flex-1 gap-1 sm:flex-none" disabled={!!acting} onClick={() => decide(r, "approved")}>
                          {busyHere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Approve
                        </Button>
                      )}
                      <Button variant="outline" className="h-9 px-3 text-sm flex-1 gap-1 sm:flex-none" disabled={!!acting}
                        onClick={() => decide(r, "rejected")}>
                        {busyHere && ended ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                        Reject
                      </Button>
                    </div>
                  </div>
                );
              })}
              </div>
            )}
    </>
  );
  const schedulePane = (
    <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                Approved bookings. Once a session starts, mark whether the student came.
              </p>
              <Button variant="outline" className="h-10 shrink-0 gap-2 px-4 text-sm font-semibold" onClick={() => setStaffBooking(true)}>
                <CalendarPlus className="h-4 w-4" /> Walk-in / block
              </Button>
            </div>
            {days.length === 0 ? (
              <Card>
                <CardContent>
                  <Empty icon={<CalendarDays className="h-9 w-9 text-muted-foreground/50" />}
                    title="Nothing scheduled" text="Approved bookings will show up here." />
                </CardContent>
              </Card>
            ) : (
              days.map(([key, rows]) => (
                <section key={key} aria-label={fmtRelativeDay(key, new Date(now || 0))}>
                  <p className="pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {fmtRelativeDay(key, new Date(now || 0))} · {rows.length} booking{rows.length === 1 ? "" : "s"}
                  </p>
                  <div className="grid gap-2 xl:grid-cols-2">
                    {rows.map((r, i) => {
                      const start = new Date(r.start_time);
                      const end = new Date(r.end_time);
                      const started = start.getTime() <= now;
                      const running = isRunning(r);
                      const done = end.getTime() <= now;
                      const busyHere = acting === r.id;
                      return (
                        <div key={r.id} style={stagger(i)}
                          className={`animate-reveal stagger flex flex-wrap items-center gap-3 rounded-xl border p-3 transition-all
                            ${running ? "border-primary/50 bg-accent/30" : "bg-card hover:bg-muted/30"} ${done && !running ? "opacity-70" : ""}`}>
                          <div className={`flex w-[4.5rem] shrink-0 flex-col items-center rounded-lg px-1 py-1.5 text-center
                            ${running ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}>
                            <span className="text-sm font-semibold leading-tight">{fmtTime(start)}</span>
                            <span className="text-[10px]">{fmtDur(mins(r))}</span>
                          </div>
                          <div className="min-w-[9rem] flex-1">
                            <p className="flex items-center gap-2 font-medium">
                              {fLabel(r.facility_id)}
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
                              {r.booking_kind === "block"
                                ? <>Blocked{r.staff_note ? `: ${r.staff_note}` : ""} · until {fmtTime(end)}</>
                                : <>{r.profiles?.full_name ?? "Student"} · {r.participants} people · until {fmtTime(end)}{r.booking_kind === "walk_in" ? " · walk-in" : ""}</>}
                            </p>
                            {!started && !r.checked_in_at && risks[r.id] && (
                              <div className="pt-1"><NoShowBadge risk={risks[r.id]} /></div>
                            )}
                          </div>
                          <div className="ml-auto flex flex-wrap items-center gap-1.5">
                            {r.booking_kind === "block" ? (
                              <>
                                <Badge variant="secondary" className="gap-1"><Ban className="h-3 w-3" />blocked</Badge>
                                {!done && (
                                  <Button variant="ghost" className="h-9 px-3 text-sm text-muted-foreground" disabled={!!acting} onClick={() => removeBlock(r)}>
                                    {busyHere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null} Remove block
                                  </Button>
                                )}
                              </>
                            ) : (
                            <>
                            {r.checked_in_at ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />checked in</Badge>
                              : r.no_show ? <Badge variant="destructive">no-show</Badge>
                              : started ? (
                                <>
                                  <Button variant="outline" className="h-9 px-3 text-sm animate-soft-pulse gap-1" disabled={!!acting}
                                    onClick={() => markAttendance(r, "checked_in")}>
                                    {busyHere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                    Attended
                                  </Button>
                                  <Button variant="ghost" className="h-9 px-3 text-sm gap-1 text-destructive" disabled={!!acting}
                                    onClick={() => markAttendance(r, "no_show")}>
                                    <UserX className="h-3.5 w-3.5" /> No-show
                                  </Button>
                                </>
                              )
                              : <span className="text-xs text-muted-foreground">not started</span>}
                            {/* staff can cancel until it ends; the student is told why */}
                            {!done && !r.no_show && (
                              <Button variant="ghost" className="h-9 px-3 text-sm gap-1 text-muted-foreground" disabled={!!acting}
                                onClick={() => setReasonFor({ row: r, mode: "cancel" })}>
                                <X className="h-3.5 w-3.5" /> Cancel
                              </Button>
                            )}
                            </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
    </>
  );
  const lostPane = (
    <>
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <PackageSearch className="h-5 w-5 text-primary" /> Lost &amp; found
                </CardTitle>
                <CardDescription>
                  Log items handed in at your rooms and track them until someone collects them
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5 xl:grid xl:grid-cols-[340px_minmax(0,1fr)] xl:items-start xl:gap-6 xl:space-y-0">
                {/* log form (a side column on wide screens) */}
                <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-3 xl:grid-cols-1">
                  <Select value={newLf.facility_id} onValueChange={(v) => setNewLf({ ...newLf, facility_id: v })}>
                    <SelectTrigger aria-label="Found in room" className="w-full"><SelectValue placeholder="Found in room" /></SelectTrigger>
                    <SelectContent>
                      {myFacilities.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Item (e.g. black wallet)" aria-label="Item found" value={newLf.item_name}
                    onChange={(e) => setNewLf({ ...newLf, item_name: e.target.value })} />
                  <Select value={newLf.category} onValueChange={(v) => setNewLf({ ...newLf, category: v as LostFoundCategory })}>
                    <SelectTrigger aria-label="Item category" className="w-full"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(LOST_FOUND_CATEGORIES) as LostFoundCategory[]).map((c) => (
                        <SelectItem key={c} value={c}>{LOST_FOUND_CATEGORIES[c]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Where exactly (e.g. under table 3)" aria-label="Where exactly it was found" value={newLf.found_location}
                    onChange={(e) => setNewLf({ ...newLf, found_location: e.target.value })} />
                  <Input type="date" aria-label="Date found" value={newLf.found_date} max={todayKey}
                    onChange={(e) => setNewLf({ ...newLf, found_date: e.target.value })} />
                  <Input placeholder="Handed in by (optional)" aria-label="Handed in by" value={newLf.reporter_name}
                    onChange={(e) => setNewLf({ ...newLf, reporter_name: e.target.value })} />
                  <Textarea className="sm:col-span-2 xl:col-span-1" placeholder="Description / distinguishing details (optional)"
                    aria-label="Description" value={newLf.description}
                    onChange={(e) => setNewLf({ ...newLf, description: e.target.value })} />
                  <Button onClick={logLostItem} disabled={acting === "lf"} className="h-9 gap-1 px-3 text-sm">
                    {acting === "lf" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Log item
                  </Button>
                </div>

                <div className="min-w-0 space-y-4">
                {/* filter */}
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show items">
                  {(["unclaimed", "claimed", "returned", "disposed", "all"] as const).map((s) => (
                    <button key={s} aria-pressed={lfFilter === s}
                      className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                        lfFilter === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                      }`}
                      onClick={() => setLfFilter(s)}>
                      {s}
                    </button>
                  ))}
                </div>

                {/* list */}
                <Table className="table-stack">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead><TableHead>Room</TableHead>
                      <TableHead>Found</TableHead><TableHead>Status</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredLost.map((i) => (
                      <TableRow key={i.id}>
                        <TableCell>
                          <span className="font-medium">{i.item_name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {LOST_FOUND_CATEGORIES[i.category]}
                            {i.found_location ? ` - ${i.found_location}` : ""}
                            {i.claimant_name ? ` - claimed by ${i.claimant_name}` : ""}
                            {i.claimant_contact ? ` (${i.claimant_contact})` : ""}
                          </span>
                        </TableCell>
                        <TableCell data-label="Room">{fLabel(i.facility_id)}</TableCell>
                        {/* found_date is a plain date: format it as one, not as UTC midnight */}
                        <TableCell data-label="Found" className="whitespace-nowrap text-sm">{fmtDay(i.found_date.slice(0, 10))}</TableCell>
                        <TableCell><Badge variant={LF_STATUS_COLOR[i.status]}>{i.status}</Badge></TableCell>
                        <TableCell className="space-x-1 whitespace-nowrap">
                          {i.status === "unclaimed" && (
                            <>
                              <Button className="h-9 px-3 text-sm" disabled={!!acting} onClick={() => openClaim(i)}>Claimed</Button>
                              <Button className="h-9 px-3 text-sm" variant="outline" disabled={!!acting} onClick={() => setLfStatus(i, "disposed")}>Dispose</Button>
                            </>
                          )}
                          {i.status === "claimed" && (
                            <Button className="h-9 px-3 text-sm" variant="outline" disabled={!!acting} onClick={() => setLfStatus(i, "returned")}>Mark returned</Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {filteredLost.length === 0 && (
                      <TableRow><TableCell colSpan={5} className="text-muted-foreground">No items in this view</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                </div>
              </CardContent>
            </Card>
    </>
  );

  return (
    <AppShell
      title={firstName ? `Hi, ${firstName}` : "Facility Management"}
      subtitle="Approve requests, mark attendance and look after your rooms"
      role="facility_manager"
      userName={profile?.full_name}
      focused
      wide="full"
    >
      {/* top-center: on phones a bottom toast covered the cards it was announcing */}
      <Toaster richColors position="top-center" />
      {confirmDialog}
      {reasonFor && (
        <ReasonDialog key={`${reasonFor.mode}-${reasonFor.row.id}`}
          title={reasonFor.mode === "reject" ? "Reject this request?" : "Cancel this booking?"}
          description={<>
            {reasonFor.row.profiles?.full_name ?? "The student"} · {fLabel(reasonFor.row.facility_id)} ·{" "}
            {fmtRelativeDay(myDateKey(new Date(reasonFor.row.start_time)), new Date(nowMs || 0))} at {fmtTime(new Date(reasonFor.row.start_time))}.
            {" "}They are notified with your reason.
          </>}
          presets={reasonFor.mode === "reject" ? REJECT_REASONS : CANCEL_REASONS}
          action={reasonFor.mode === "reject" ? "Reject request" : "Cancel booking"}
          busy={acting === reasonFor.row.id}
          onSubmit={submitReason}
          onClose={() => setReasonFor(null)} />
      )}
      {staffBooking && (
        <StaffBookingDialog facilities={myFacilities} rules={rules} facilityId={selected} now={nowMs}
          onClose={() => setStaffBooking(false)}
          onDone={async () => { setStaffBooking(false); if (profile) await load(profile); }} />
      )}
      {loading ? (
        <ManagerSkeleton />
      ) : assignedIds.length === 0 ? (
        <Card className="animate-reveal">
          <CardContent className="flex flex-col items-center justify-center gap-2 py-20 text-center">
            <MapPin className="h-9 w-9 text-muted-foreground/50" />
            <p className="font-medium">No facilities assigned to you yet</p>
            <p className="max-w-md text-sm text-muted-foreground">
              Ask an administrator to assign you to a facility - your rooms, approval queue and
              equipment inventory will appear here.
            </p>
          </CardContent>
        </Card>
      ) : (
        selectedFacility ? (
        /* ---------- one room: its requests, schedule, live view, problems, lost & found ---------- */
        <div key={selectedFacility.id} className="animate-step-in space-y-5">
          <div className="flex flex-wrap items-center gap-4">
            <Button variant="outline" className="h-10 shrink-0 gap-2 px-4 text-sm font-semibold" onClick={closeRoom}>
              <ArrowLeft className="h-4 w-4" /> All rooms
            </Button>
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <div className="hidden h-16 w-20 shrink-0 overflow-hidden rounded-lg bg-muted/40 sm:block">
                <FacilityIso type={selectedFacility.type} busy={inUse.has(selectedFacility.id)} />
              </div>
              <div className="min-w-0">
                <h2 className="font-display text-2xl font-semibold leading-tight">{selectedFacility.name}</h2>
                <p className="flex flex-wrap items-center gap-1.5 pt-0.5 text-sm text-muted-foreground">
                  {selectedFacility.venue} · {typeLabel(selectedFacility.type)} ·
                  <Users2 className="h-3.5 w-3.5" /> {selectedFacility.capacity}
                  {rules[selectedFacility.id] && <> · {rules[selectedFacility.id].auto_approve ? "instant booking" : "needs approval"}</>}
                </p>
              </div>
            </div>
            <Badge variant={inUse.has(selectedFacility.id) ? "destructive" : "default"} className="shrink-0">
              {inUse.has(selectedFacility.id) ? "In use" : selectedFacility.status !== "active" ? selectedFacility.status : "Free now"}
            </Badge>
          </div>
          <DayTimeline rule={rules[selectedFacility.id]} bookings={todayAll.filter((r) => r.facility_id === selectedFacility.id)} now={now} />

          <Tabs value={roomView} onValueChange={(v) => setRoomView(v as RoomView)} className="gap-5">
            <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] group-data-horizontal/tabs:h-10 sm:w-fit">
              <TabsTrigger value="requests" className="flex-none px-3">
                <Inbox className="h-4 w-4" /> Requests <Count n={shownPending.length} />
              </TabsTrigger>
              <TabsTrigger value="schedule" className="flex-none px-3">
                <CalendarDays className="h-4 w-4" /> Schedule <Count n={awaitingAttendance} />
              </TabsTrigger>
              <TabsTrigger value="live" className="flex-none px-3">
                <Radio className="h-4 w-4" /> Live room
              </TabsTrigger>
              <TabsTrigger value="problems" className="flex-none px-3">
                <TriangleAlert className="h-4 w-4" /> Problems <Count n={problemCount} />
              </TabsTrigger>
              <TabsTrigger value="lost" className="flex-none px-3">
                <PackageSearch className="h-4 w-4" /> Lost &amp; found <Count n={unclaimed} />
              </TabsTrigger>
            </TabsList>
            <TabsContent value="requests" className="space-y-3">{requestsPane}</TabsContent>
            <TabsContent value="schedule" className="space-y-5">{schedulePane}</TabsContent>
            <TabsContent value="live">
              {/* 3D twin, live readings, today, room log and remote control; built from bookings if the room has no device */}
              <FacilityDetail facility={selectedFacility} rule={rules[selectedFacility.id]} canSetup={false} />
            </TabsContent>
            <TabsContent value="problems">
              <RoomReports facilityId={selectedFacility.id} onActiveCount={refreshIssues} />
            </TabsContent>
            <TabsContent value="lost">{lostPane}</TabsContent>
          </Tabs>
        </div>
        ) : (
        <Tabs value={view} onValueChange={(v) => setView(v as View)} className="gap-5">
          {/* scrolls sideways on phones instead of squashing five tabs */}
          <TabsList className="w-full justify-start overflow-x-auto overflow-y-hidden [scrollbar-width:none] group-data-horizontal/tabs:h-10 sm:w-fit">
            <TabsTrigger value="rooms" className="flex-none px-3">
              <MapPin className="h-4 w-4" /> My rooms <Count n={problemCount} />
            </TabsTrigger>
            <TabsTrigger value="requests" className="flex-none px-3">
              <Inbox className="h-4 w-4" /> Requests <Count n={shownPending.length} />
            </TabsTrigger>
            <TabsTrigger value="schedule" className="flex-none px-3">
              <CalendarDays className="h-4 w-4" /> Schedule <Count n={awaitingAttendance} />
            </TabsTrigger>
            <TabsTrigger value="lost" className="flex-none px-3">
              <PackageSearch className="h-4 w-4" /> Lost &amp; found <Count n={unclaimed} />
            </TabsTrigger>
            <TabsTrigger value="equipment" className="flex-none px-3">
              <Boxes className="h-4 w-4" /> Equipment
            </TabsTrigger>
          </TabsList>

          {/* ---------- my rooms (landing) ---------- */}
          <TabsContent value="rooms" className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0 space-y-1.5">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{inUse.size} of {myFacilities.length}</span> in use now.
                {" Open a room to see its requests, schedule and live view."}
              </p>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-primary" /> approved</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-primary/35" /> pending</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground" /> now</span>
              </div>
              </div>
              <Button className="h-10 shrink-0 gap-2 px-4 text-sm font-semibold" onClick={() => setStaffBooking(true)}>
                <CalendarPlus className="h-4 w-4" /> Walk-in / block
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
              {myFacilities.map((f, i) => {
                const busy = inUse.has(f.id);
                const waiting = pending.filter((r) => r.facility_id === f.id).length;
                const todays = todayAll.filter((r) => r.facility_id === f.id);
                const r = rules[f.id];
                return (
                  <button key={f.id} onClick={() => openRoom(f.id)} aria-label={`Open ${f.name}`}
                    className="animate-reveal stagger group relative overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg"
                    style={stagger(i)}>
                    <div className="relative h-32 bg-muted/40">
                      <FacilityIso type={f.type} busy={busy} />
                      {waiting > 0 && (
                        <span className="animate-pop-in absolute right-2 top-2 flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground shadow">
                          <Inbox className="h-3 w-3" /> {waiting} waiting
                        </span>
                      )}
                      {f.status !== "active" && (
                        <span className="absolute left-2 top-2 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium capitalize shadow">
                          {f.status}
                        </span>
                      )}
                      {issues[f.id] && (
                        <span className={`absolute bottom-2 left-2 flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold shadow ${
                          issues[f.id].urgent ? "bg-destructive text-primary-foreground" : "bg-card text-primary"}`}>
                          <TriangleAlert className="h-3 w-3" /> {issues[f.id].count} problem{issues[f.id].count > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <div className="space-y-2.5 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <h3 className="font-display font-semibold leading-tight">{f.name}</h3>
                          <p className="text-xs text-muted-foreground">{f.venue} · {typeLabel(f.type)}</p>
                        </div>
                        <Badge variant={busy ? "destructive" : "default"} className="shrink-0">
                          {busy ? "In use" : "Free now"}
                        </Badge>
                      </div>
                      <p className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1"><Users2 className="h-3.5 w-3.5" /> {f.capacity}</span>
                        <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" /> {todays.length} today</span>
                        {r && <span>{r.auto_approve ? "instant" : "needs approval"}</span>}
                      </p>
                      <DayTimeline rule={r} bookings={todays} now={now} />
                    </div>
                  </button>
                );
              })}
            </div>
          </TabsContent>
          <TabsContent value="requests" className="space-y-3">{requestsPane}</TabsContent>
          <TabsContent value="schedule" className="space-y-5">{schedulePane}</TabsContent>
          <TabsContent value="lost">{lostPane}</TabsContent>

          {/* ---------- equipment ---------- */}
          <TabsContent value="equipment">
            <Card>
              <CardHeader>
                <CardTitle className="font-display flex items-center gap-2">
                  <Boxes className="h-5 w-5 text-primary" /> Equipment inventory
                </CardTitle>
                <CardDescription>
                  Items students can request with a booking ({myTypes.map(typeLabel).join(", ") || "none"}).
                  Change a quantity and press Enter or click away to save.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <Table className="table-stack">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Quantity</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {equipment.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">{e.name}</TableCell>
                        <TableCell data-label="Category">{typeLabel(e.facility_type)}</TableCell>
                        <TableCell data-label="Quantity">
                          {/* key on the saved value so a refresh shows the new number */}
                          <Input key={`${e.id}-${e.total_qty}`} type="number" min={0} defaultValue={e.total_qty} className="w-20"
                            aria-label={`Total ${e.name}`}
                            onKeyDown={(ev) => ev.key === "Enter" && (ev.target as HTMLInputElement).blur()}
                            onBlur={(ev) => { const q = Number(ev.target.value); if (Number.isInteger(q) && q >= 0 && q !== e.total_qty) saveQty(e, q); }} />
                        </TableCell>
                      </TableRow>
                    ))}
                    {equipment.length === 0 && (
                      <TableRow><TableCell colSpan={3} className="text-muted-foreground">No equipment yet</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
                <div className="grid gap-2 sm:grid-cols-4">
                  <Select value={newEquip.type} onValueChange={(v) => setNewEquip({ ...newEquip, type: v })}>
                    <SelectTrigger aria-label="Category" className="w-full"><SelectValue placeholder="Category" /></SelectTrigger>
                    <SelectContent>
                      {myTypes.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input placeholder="Item name" aria-label="Item name" value={newEquip.name}
                    onChange={(e) => setNewEquip({ ...newEquip, name: e.target.value })} />
                  <Input type="number" min={1} aria-label="Quantity" value={newEquip.qty}
                    onChange={(e) => setNewEquip({ ...newEquip, qty: Number(e.target.value) })} />
                  <Button onClick={addEquipment} disabled={acting === "equip"} className="h-9 gap-1 px-3 text-sm">
                    {acting === "equip" && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Add item
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
        )
      )}

      {/* who collected a lost item (replaces two window.prompt boxes) */}
      <Dialog open={!!claiming} onOpenChange={(open) => { if (!open) setClaiming(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Who is collecting {claiming?.item_name}?</DialogTitle>
            <DialogDescription>Saved with the item so you can trace it later.</DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); saveClaim(); }}>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Name</span>
              <Input autoFocus value={claim.name} onChange={(e) => setClaim({ ...claim, name: e.target.value })} />
            </label>
            <label className="block space-y-1 text-sm">
              <span className="font-medium">Email or phone <span className="font-normal text-muted-foreground">(optional)</span></span>
              <Input value={claim.contact} onChange={(e) => setClaim({ ...claim, contact: e.target.value })} />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" className="h-9 px-4 text-sm" onClick={() => setClaiming(null)}>Cancel</Button>
              <Button type="submit" disabled={!!acting} className="h-9 gap-1 px-4 text-sm">
                {acting === claiming?.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Mark claimed
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
