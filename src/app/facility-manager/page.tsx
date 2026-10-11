"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Facility, FacilityRule, Profile, Reservation, Equipment, typeLabel,
  LostFoundItem, LostFoundCategory, LostFoundStatus, LOST_FOUND_CATEGORIES,
} from "@/lib/types";
import { fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast, Toaster } from "sonner";
import AppShell from "@/components/app-shell";
import FacilityIso from "@/components/facility-iso";
import { ensureProfile } from "@/lib/profile";
import {
  Boxes, CalendarDays, Check, CheckCircle2, Clock, Inbox, Loader2, MapPin,
  PackageSearch, UserX, Users2, X,
} from "lucide-react";

interface Row extends Reservation {
  profiles: { full_name: string } | null;
}

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
const initials = (name?: string | null) =>
  (name ?? "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join("") || "?";
const mins = (r: Reservation) =>
  Math.round((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 60000);
const fmtDur = (m: number) => (m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

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
              title={`${fmtTime(new Date(b.start_time))} - ${fmtTime(new Date(b.end_time))} · ${b.profiles?.full_name ?? "student"} (${b.status})`}
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
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[84px]" />)}
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-60" />)}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="skeleton h-72" /><div className="skeleton h-72" />
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

  // UI state
  const [selected, setSelected] = useState<string | null>(null); // facility filter
  const [acting, setActing] = useState<string | null>(null);     // reservation being updated
  const [nowMs, setNowMs] = useState(0);                          // ticking clock (never Date.now() in render)

  const load = useCallback(async (prof: Profile) => {
    const [{ data: f }, { data: ru }] = await Promise.all([
      supabase.from("facilities_full").select("*").order("name"),
      supabase.from("effective_facility_rules").select("*"),
    ]);
    const facs = (f as Facility[]) ?? [];
    setFacilities(facs);
    const rm: Record<string, FacilityRule> = {};
    ((ru as FacilityRule[]) ?? []).forEach((r) => { rm[r.facility_id] = r; });
    setRules(rm);

    // scope: admins see everything; managers only their assigned facilities
    let ids: string[];
    if (prof.role === "admin") {
      ids = facs.map((x) => x.id);
    } else {
      const { data: fm } = await supabase
        .from("facility_managers").select("facility_id").eq("manager_id", prof.id);
      ids = (fm ?? []).map((x) => x.facility_id);
    }
    setAssignedIds(ids);

    if (ids.length === 0) {
      setPending([]); setUpcoming([]); setEquipment([]); setEquipByRes({});
      return;
    }

    const { data: p } = await supabase
      .from("reservations").select("*, profiles(full_name)")
      .eq("status", "pending").in("facility_id", ids).order("start_time");
    setPending((p as Row[]) ?? []);
    // requested equipment per pending reservation
    const resIds = (p ?? []).map((x) => x.id);
    if (resIds.length > 0) {
      const { data: re } = await supabase
        .from("reservation_equipment")
        .select("reservation_id, qty, equipment(name)")
        .in("reservation_id", resIds);
      const m: Record<string, string> = {};
      (re as { reservation_id: string; qty: number; equipment: { name: string } | null }[] | null)?.forEach((x) => {
        const label = `${x.qty}x ${x.equipment?.name ?? "item"}`;
        m[x.reservation_id] = m[x.reservation_id] ? `${m[x.reservation_id]}, ${label}` : label;
      });
      setEquipByRes(m);
    } else setEquipByRes({});

    // today starts at midnight Malaysia time, whatever the browser's timezone
    const todayStart = myAt(myDateKey(), "00:00");
    const { data: u } = await supabase
      .from("reservations").select("*, profiles(full_name)")
      .eq("status", "approved").in("facility_id", ids)
      .gte("start_time", todayStart.toISOString())
      .order("start_time").limit(60);
    setUpcoming((u as Row[]) ?? []);

    // equipment for my facility categories
    const myTypes = Array.from(new Set(facs.filter((x) => ids.includes(x.id)).map((x) => x.type)));
    const { data: eq } = await supabase
      .from("equipment").select("*").in("facility_type", myTypes).order("name");
    setEquipment((eq as Equipment[]) ?? []);

    // lost & found for my facilities
    const { data: lf } = await supabase
      .from("lost_and_found").select("*").in("facility_id", ids)
      .order("created_at", { ascending: false });
    setLostItems((lf as LostFoundItem[]) ?? []);
  }, []);

  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const prof = await ensureProfile();
      if (!prof) { router.push("/login"); return; }
      if (prof.role !== "facility_manager" && prof.role !== "admin") { router.push("/login"); return; }
      setProfile(prof);
      await load(prof);
      setNowMs(Date.now());
      setLoading(false);
    })();
    const t = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [router, load]);

  async function decide(r: Reservation, status: "approved" | "rejected") {
    if (acting) return;
    setActing(r.id);
    const { error } = await supabase.from("reservations").update({ status }).eq("id", r.id);
    if (error) { toast.error(error.message); setActing(null); return; }
    toast.success(`Request ${status}`);
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
    if (!newEquip.type || !newEquip.name) { toast.error("Category and item name required"); return; }
    const { error } = await supabase.from("equipment").insert({
      facility_type: newEquip.type, name: newEquip.name, total_qty: newEquip.qty,
    });
    if (error) { toast.error(error.message); return; }
    setNewEquip({ type: "", name: "", qty: 1 });
    if (profile) await load(profile);
  }

  async function logLostItem() {
    if (!newLf.facility_id || !newLf.item_name) {
      toast.error("Facility and item name are required"); return;
    }
    const { error } = await supabase.from("lost_and_found").insert({
      facility_id: newLf.facility_id,
      item_name: newLf.item_name,
      category: newLf.category,
      description: newLf.description || null,
      found_location: newLf.found_location || null,
      found_date: newLf.found_date,
      reporter_name: newLf.reporter_name || null,
      logged_by: profile?.id ?? null,
    });
    if (error) { toast.error(error.message); return; }
    toast.success("Item logged to lost & found");
    setNewLf({ ...emptyLf });
    if (profile) await load(profile);
  }

  async function setLfStatus(item: LostFoundItem, status: LostFoundStatus) {
    let patch: Partial<LostFoundItem> = { status };
    if (status === "claimed") {
      const name = window.prompt("Claimant name:");
      if (name === null) return;
      const contact = window.prompt("Claimant contact (email or phone):") ?? "";
      patch = { status, claimant_name: name || null, claimant_contact: contact || null };
    }
    const { error } = await supabase.from("lost_and_found").update(patch).eq("id", item.id);
    if (error) { toast.error(error.message); return; }
    toast.success(`Marked ${status}`);
    if (profile) await load(profile);
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
  const filteredLost = lfFilter === "all" ? lostItems : lostItems.filter((i) => i.status === lfFilter);
  const LF_STATUS_COLOR: Record<LostFoundStatus, "default" | "secondary" | "destructive" | "outline"> = {
    unclaimed: "secondary", claimed: "default", returned: "outline", disposed: "destructive",
  };

  const isRunning = (r: Reservation) =>
    new Date(r.start_time).getTime() <= now && new Date(r.end_time).getTime() > now;
  const inUse = new Set(upcoming.filter(isRunning).map((r) => r.facility_id));
  const onDay = (r: Reservation, key: string) => myDateKey(new Date(r.start_time)) === key;
  const todayAll = [...upcoming, ...pending].filter((r) => onDay(r, todayKey));
  const todayApproved = upcoming.filter((r) => onDay(r, todayKey));
  const awaitingAttendance = upcoming.filter((r) =>
    new Date(r.start_time).getTime() <= now && !r.checked_in_at && !r.no_show).length;

  const byFacility = (r: Reservation) => !selected || r.facility_id === selected;
  const shownPending = pending.filter(byFacility);
  const shownUpcoming = upcoming
    .filter(byFacility)
    .filter((r) => new Date(r.end_time).getTime() > now || onDay(r, todayKey));
  // group the schedule by day
  const days: [string, Row[]][] = [];
  shownUpcoming.forEach((r) => {
    const k = myDateKey(new Date(r.start_time));
    const g = days.find(([d]) => d === k);
    if (g) g[1].push(r); else days.push([k, [r]]);
  });
  const selectedFacility = selected ? fById(selected) : null;

  return (
    <AppShell
      title="Facility Management"
      subtitle={`Welcome${profile ? `, ${profile.full_name}` : ""} - review requests and keep an eye on your rooms`}
      role="facility_manager"
      userName={profile?.full_name}
    >
      <Toaster richColors />
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
      <>
        {/* summary strip */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {([
            ["Waiting for approval", pending.length, Inbox],
            ["Bookings today", todayApproved.length, CalendarDays],
            ["Rooms in use now", `${inUse.size} / ${myFacilities.length}`, Users2],
            ["Attendance to mark", awaitingAttendance, Clock],
          ] as const).map(([label, value, Icon], i) => (
            <Card key={label} className="animate-reveal stagger transition-shadow hover:shadow-md" style={stagger(i)}>
              <CardContent className="flex items-center gap-4 py-5">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="h-5 w-5" />
                </span>
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
                  <p className="font-display animate-count text-2xl font-semibold leading-tight">{value}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* my facilities */}
        <Card className="animate-reveal" style={{ animationDelay: "150ms" }}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="font-display flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" /> Your facilities
                </CardTitle>
                <CardDescription>
                  Live status and today&apos;s schedule. Click a room to focus the queue and schedule on it.
                </CardDescription>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-primary" /> approved</span>
                <span className="flex items-center gap-1.5"><span className="h-2.5 w-4 rounded-sm bg-primary/35" /> pending</span>
                <span className="flex items-center gap-1.5"><span className="h-3 w-0.5 bg-foreground" /> now</span>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
              {myFacilities.map((f, i) => {
                const busy = inUse.has(f.id);
                const waiting = pending.filter((r) => r.facility_id === f.id).length;
                const todays = todayAll.filter((r) => r.facility_id === f.id);
                const isSel = selected === f.id;
                const r = rules[f.id];
                return (
                  <button key={f.id} onClick={() => setSelected(isSel ? null : f.id)}
                    aria-pressed={isSel}
                    className={`animate-reveal stagger group relative overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg
                      ${isSel ? "border-primary ring-2 ring-primary/40" : "hover:border-primary"}
                      ${selected && !isSel ? "opacity-60 hover:opacity-100" : ""}`}
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
          </CardContent>
        </Card>

        {selectedFacility && (
          <div className="animate-pop-in flex flex-wrap items-center gap-2 rounded-xl border border-primary/40 bg-accent/40 px-4 py-2.5 text-sm">
            <MapPin className="h-4 w-4 text-primary" />
            Showing only <span className="font-semibold">{selectedFacility.name}</span>
            <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1" onClick={() => setSelected(null)}>
              <X className="h-3.5 w-3.5" /> Show all
            </Button>
          </div>
        )}

        <div className="grid items-start gap-6 xl:grid-cols-2">
          {/* approval queue */}
          <Card className="animate-reveal" style={{ animationDelay: "220ms" }}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <Inbox className="h-5 w-5 text-primary" /> Approval queue
                {shownPending.length > 0 && <Badge className="ml-1">{shownPending.length}</Badge>}
              </CardTitle>
              <CardDescription>Requests for your facilities, soonest first</CardDescription>
            </CardHeader>
            <CardContent>
              {shownPending.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <CheckCircle2 className="h-9 w-9 text-primary/60" />
                  <p className="font-medium">All caught up</p>
                  <p className="text-sm text-muted-foreground">No requests are waiting for you.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {shownPending.map((r, i) => {
                    const f = fById(r.facility_id);
                    const start = new Date(r.start_time);
                    const busyHere = acting === r.id;
                    const over = f ? r.participants > f.capacity : false;
                    return (
                      <div key={r.id} style={stagger(i)}
                        className="animate-reveal stagger flex gap-3 rounded-xl border bg-card p-3 transition-all hover:shadow-sm">
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
                          </div>
                          <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            <span className="flex items-center gap-1 font-medium text-foreground">
                              <CalendarDays className="h-3.5 w-3.5 text-primary" />
                              <span className="capitalize">{fmtRelativeDay(myDateKey(start), new Date(now || 0))}</span>,
                              {" "}{fmtTime(start)} - {fmtTime(new Date(r.end_time))}
                            </span>
                            <span>{fmtDur(mins(r))}</span>
                            <span className={`flex items-center gap-1 ${over ? "font-medium text-destructive" : ""}`}>
                              <Users2 className="h-3.5 w-3.5" /> {r.participants}{f ? ` / ${f.capacity}` : ""}
                            </span>
                          </p>
                          {r.purpose && <p className="line-clamp-2 text-sm">&ldquo;{r.purpose}&rdquo;</p>}
                          {equipByRes[r.id] && (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Boxes className="h-3.5 w-3.5" /> {equipByRes[r.id]}
                            </p>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col gap-1.5">
                          <Button size="sm" className="gap-1" disabled={!!acting} onClick={() => decide(r, "approved")}>
                            {busyHere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                            Approve
                          </Button>
                          <Button size="sm" variant="outline" className="gap-1" disabled={!!acting}
                            onClick={() => decide(r, "rejected")}>
                            <X className="h-3.5 w-3.5" /> Reject
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* schedule */}
          <Card className="animate-reveal" style={{ animationDelay: "280ms" }}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" /> Today &amp; upcoming
              </CardTitle>
              <CardDescription>Approved bookings. Mark attendance once a session has started.</CardDescription>
            </CardHeader>
            <CardContent className="xl:max-h-[38rem] xl:overflow-y-auto">
              {days.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <CalendarDays className="h-9 w-9 text-muted-foreground/50" />
                  <p className="font-medium">Nothing scheduled</p>
                  <p className="text-sm text-muted-foreground">Approved bookings will show up here.</p>
                </div>
              ) : (
                <div className="space-y-5">
                  {days.map(([key, rows]) => (
                    <div key={key}>
                      <p className="sticky top-0 z-10 bg-card pb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {fmtRelativeDay(key, new Date(now || 0))} · {rows.length} booking{rows.length === 1 ? "" : "s"}
                      </p>
                      <div className="space-y-2">
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
                                <span className="text-[10px] opacity-80">{fmtDur(mins(r))}</span>
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
                                  {r.profiles?.full_name ?? "Student"} · {r.participants} people · until {fmtTime(end)}
                                </p>
                              </div>
                              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                                {r.checked_in_at ? <Badge className="gap-1"><CheckCircle2 className="h-3 w-3" />checked in</Badge>
                                  : r.no_show ? <Badge variant="destructive">no-show</Badge>
                                  : started ? (
                                    <>
                                      <Button size="sm" variant="outline" className="animate-soft-pulse gap-1" disabled={!!acting}
                                        onClick={() => markAttendance(r, "checked_in")}>
                                        {busyHere ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                                        Attended
                                      </Button>
                                      <Button size="sm" variant="ghost" className="gap-1 text-destructive" disabled={!!acting}
                                        onClick={() => markAttendance(r, "no_show")}>
                                        <UserX className="h-3.5 w-3.5" /> No-show
                                      </Button>
                                    </>
                                  )
                                  : <span className="text-xs text-muted-foreground">not started</span>}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="grid items-start gap-6 2xl:grid-cols-2">
        <Card className="animate-reveal" style={{ animationDelay: "340ms" }}>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Boxes className="h-5 w-5 text-primary" /> Equipment inventory
            </CardTitle>
            <CardDescription>
              Items for your facility categories ({myTypes.map(typeLabel).join(", ") || "none"}).
              Edit a quantity and press Enter to save.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead><TableHead>Category</TableHead><TableHead>Quantity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {equipment.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="font-medium">{e.name}</TableCell>
                    <TableCell>{typeLabel(e.facility_type)}</TableCell>
                    <TableCell>
                      <Input type="number" min={0} defaultValue={e.total_qty} className="w-20"
                        onKeyDown={(ev) => ev.key === "Enter" &&
                          saveQty(e, Number((ev.target as HTMLInputElement).value))} />
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
                <SelectTrigger><SelectValue placeholder="Category" /></SelectTrigger>
                <SelectContent>
                  {myTypes.map((t) => <SelectItem key={t} value={t}>{typeLabel(t)}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Item name" value={newEquip.name}
                onChange={(e) => setNewEquip({ ...newEquip, name: e.target.value })} />
              <Input type="number" min={1} value={newEquip.qty}
                onChange={(e) => setNewEquip({ ...newEquip, qty: Number(e.target.value) })} />
              <Button onClick={addEquipment}>Add item</Button>
            </div>
          </CardContent>
        </Card>

        {/* lost & found */}
        <Card className="animate-reveal" style={{ animationDelay: "400ms" }}>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <PackageSearch className="h-5 w-5 text-primary" /> Lost &amp; found
            </CardTitle>
            <CardDescription>
              Log items handed in at your facilities and track them until they are claimed
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* log form */}
            <div className="grid gap-2 rounded-xl border bg-muted/30 p-3 sm:grid-cols-3">
              <Select value={newLf.facility_id} onValueChange={(v) => setNewLf({ ...newLf, facility_id: v })}>
                <SelectTrigger><SelectValue placeholder="Found at facility" /></SelectTrigger>
                <SelectContent>
                  {myFacilities.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Input placeholder="Item (e.g. black wallet)" value={newLf.item_name}
                onChange={(e) => setNewLf({ ...newLf, item_name: e.target.value })} />
              <Select value={newLf.category} onValueChange={(v) => setNewLf({ ...newLf, category: v as LostFoundCategory })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(LOST_FOUND_CATEGORIES) as LostFoundCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{LOST_FOUND_CATEGORIES[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Where exactly (e.g. under table 3)" value={newLf.found_location}
                onChange={(e) => setNewLf({ ...newLf, found_location: e.target.value })} />
              <Input type="date" value={newLf.found_date}
                onChange={(e) => setNewLf({ ...newLf, found_date: e.target.value })} />
              <Input placeholder="Handed in by (optional)" value={newLf.reporter_name}
                onChange={(e) => setNewLf({ ...newLf, reporter_name: e.target.value })} />
              <Textarea className="sm:col-span-2" placeholder="Description / distinguishing details (optional)"
                value={newLf.description} onChange={(e) => setNewLf({ ...newLf, description: e.target.value })} />
              <Button onClick={logLostItem}>Log item</Button>
            </div>

            {/* filter */}
            <div className="flex flex-wrap gap-1.5">
              {(["unclaimed", "claimed", "returned", "disposed", "all"] as const).map((s) => (
                <button key={s}
                  className={`rounded-full border px-3 py-1 text-xs capitalize transition-colors ${
                    lfFilter === s ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"
                  }`}
                  onClick={() => setLfFilter(s)}>
                  {s}
                </button>
              ))}
            </div>

            {/* list */}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead><TableHead>Facility</TableHead>
                  <TableHead>Found</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
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
                      </span>
                    </TableCell>
                    <TableCell>{fLabel(i.facility_id)}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {new Date(i.found_date).toLocaleDateString([], { day: "2-digit", month: "short" })}
                    </TableCell>
                    <TableCell><Badge variant={LF_STATUS_COLOR[i.status]}>{i.status}</Badge></TableCell>
                    <TableCell className="space-x-1 whitespace-nowrap">
                      {i.status === "unclaimed" && (
                        <>
                          <Button size="sm" onClick={() => setLfStatus(i, "claimed")}>Claimed</Button>
                          <Button size="sm" variant="outline" onClick={() => setLfStatus(i, "disposed")}>Dispose</Button>
                        </>
                      )}
                      {i.status === "claimed" && (
                        <Button size="sm" variant="outline" onClick={() => setLfStatus(i, "returned")}>Mark returned</Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {filteredLost.length === 0 && (
                  <TableRow><TableCell colSpan={5} className="text-muted-foreground">No items in this view</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        </div>
      </>
      )}
    </AppShell>
  );
}
