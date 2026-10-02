"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Facility, FacilityRule, Profile, Reservation, Equipment, typeLabel,
} from "@/lib/types";
import {
  recommendAcross, learnPeakHours, updateWeights, ScoredSlot, PeakModel,
  DEFAULT_WEIGHTS, DEFAULT_PEAKS,
} from "@/lib/recommend";
import {
  initBandit, isBanditState, rankWithBandit, cascadeUpdate, compactBandit,
} from "@/lib/bandit";
import { addDays, fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";
import { ensureProfile } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast, Toaster } from "sonner";
import Chatbot from "@/components/chatbot";
import AppShell from "@/components/app-shell";
import FacilityIso from "@/components/facility-iso";
import PopularTimes from "@/components/popular-times";
import { logEvent } from "@/lib/evaluation";
import {
  CalendarDays, Clock, CheckCircle2, ChevronRight, ArrowLeft,
  Sparkles, MapPin, Users2, CalendarX,
} from "lucide-react";

const STATUS_COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default", pending: "secondary", rejected: "destructive", cancelled: "outline",
};

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

  // navigation: venue -> facility -> booking form
  const [venue, setVenue] = useState<string | null>(null);
  const [facility, setFacility] = useState<Facility | null>(null);

  // booking form
  const [date, setDate] = useState<string>(() => myDateKey());
  const [startTime, setStartTime] = useState("15:00");
  const [duration, setDuration] = useState(60);
  const [participants, setParticipants] = useState(2);
  const [purpose, setPurpose] = useState("");
  const [equipReq, setEquipReq] = useState<Record<string, number>>({});
  const [suggestions, setSuggestions] = useState<ScoredSlot[] | null>(null);
  // what the student asked for when the suggestions were produced; the form
  // may change afterwards, but learning must be against the original request
  const [suggestCtx, setSuggestCtx] = useState<{ preferredHour: number; peaks: PeakModel } | null>(null);
  const [checking, setChecking] = useState(false);

  const loadBookings = useCallback(async (uid: string) => {
    const { data } = await supabase
      .from("reservations").select("*").eq("user_id", uid)
      .order("start_time", { ascending: false }).limit(20);
    setMyBookings((data as Reservation[]) ?? []);
  }, []);

  useEffect(() => {
    (async () => {
      const p = await ensureProfile();
      if (!p) { router.push("/login"); return; }
      setProfile(p);
      const [{ data: f, error: fErr }, { data: r, error: rErr }, { data: e }] = await Promise.all([
        supabase.from("facilities_full").select("*").eq("status", "active").order("name"),
        supabase.from("effective_facility_rules").select("*"),
        supabase.from("equipment").select("*").order("name"),
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
      // which facilities are in use right now?
      const nowIso = new Date().toISOString();
      const { data: cur } = await supabase
        .from("reservations").select("facility_id")
        .in("status", ["pending", "approved"])
        .lte("start_time", nowIso).gte("end_time", nowIso);
      setBusyNow(new Set((cur ?? []).map((x) => x.facility_id)));
      // view added by upgrade-room-access.sql; if it is not there yet, no doors
      const { data: doors } = await supabase.from("door_facilities").select("facility_id");
      setDoorRooms(new Set((doors ?? []).map((d: { facility_id: string }) => d.facility_id)));
      await loadBookings(p.id);
      setLoading(false);
    })();
  }, [router, loadBookings]);

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
    const { data: overlapping } = await supabase
      .from("reservations").select("id")
      .in("status", ["pending", "approved"])
      .lt("start_time", end.toISOString()).gt("end_time", start.toISOString());
    const ids = (overlapping ?? []).map((x) => x.id);
    let used: Record<string, number> = {};
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
      supabase.from("reservations").select("*")
        .in("facility_id", ids).in("status", ["pending", "approved"])
        .lt("start_time", to).gt("end_time", from),
      // recent demand for this category, for learning peak hours
      supabase.from("reservations").select("start_time,end_time,status")
        .in("facility_id", ids).in("status", ["pending", "approved"])
        .gte("start_time", since),
    ]);

    const peaks = learnPeakHours(hist ?? []);
    const preferredHour = Number(startTime.split(":")[0]);
    const out = recommendAcross({
      requested: facility, facilities, rules,
      reservations: (res as Reservation[]) ?? [],
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
      const { data: clash } = await supabase
        .from("reservations").select("id")
        .eq("facility_id", facility!.id)
        .in("status", ["pending", "approved"])
        .lt("start_time", end.toISOString()).gt("end_time", start.toISOString())
        .limit(1);
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
  const facilityEquipment = facility
    ? equipment.filter((e) => e.facility_type === facility.type)
    : [];
  const rule = facility ? rules[facility.id] : null;

  async function checkIn(r: Reservation) {
    const { error } = await supabase.from("reservations")
      .update({ checked_in_at: new Date().toISOString() }).eq("id", r.id);
    if (error) { toast.error(error.message); return; }
    toast.success("Checked in - enjoy your session");
    if (profile) await loadBookings(profile.id);
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

  // ---------- derived for the summary strip ----------
  const now = Date.now();
  const upcoming = myBookings.filter(
    (b) => (b.status === "approved" || b.status === "pending") && new Date(b.start_time).getTime() > now
  );
  const pendingCount = myBookings.filter((b) => b.status === "pending").length;

  return (
    <AppShell
      title="Student Dashboard"
      subtitle={`Welcome${profile ? `, ${profile.full_name}` : ""} - find and book campus facilities`}
      role="student"
      userName={profile?.full_name}
    >
      <Toaster richColors />
      {loading ? (
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          Loading your dashboard...
        </div>
      ) : (
        <>
          {/* summary strip */}
          <div className="grid gap-4 sm:grid-cols-3">
            {([
              ["Upcoming bookings", String(upcoming.length), CalendarDays],
              ["Awaiting approval", String(pendingCount), Clock],
              ["Facilities available now",
                String(facilities.filter((f) => !busyNow.has(f.id)).length), CheckCircle2],
            ] as const).map(([label, value, Icon], i) => (
              <Card key={label} className="animate-reveal transition-shadow hover:shadow-md"
                style={{ animationDelay: `${i * 70}ms` }}>
                <CardContent className="flex items-center gap-4 py-5">
                  <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                    <Icon className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
                    <p className="font-display animate-count text-2xl font-semibold leading-tight"
                      style={{ animationDelay: `${i * 70 + 150}ms` }}>{value}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* browse / book */}
          <Card className="animate-reveal" style={{ animationDelay: "210ms" }}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="font-display">
                    {!venue ? "Where do you want to book?"
                      : !facility ? venue
                      : `Book ${facility.name}`}
                  </CardTitle>
                  <CardDescription>
                    {!venue ? "Pick a venue to see its rooms and courts"
                      : !facility ? "Choose a room or court - live availability shown"
                      : "Enter your preferred time; if it clashes we suggest the closest free slots"}
                  </CardDescription>
                </div>
                {venue && (
                  <Button variant="outline" size="sm" className="gap-1.5"
                    onClick={() => { facility ? setFacility(null) : setVenue(null); setSuggestions(null); }}>
                    <ArrowLeft className="h-4 w-4" />
                    {facility ? "Other rooms" : "All venues"}
                  </Button>
                )}
              </div>

              {/* breadcrumb */}
              <nav className="flex flex-wrap items-center gap-1 pt-2 text-xs text-muted-foreground">
                <button className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                  onClick={() => { setVenue(null); setFacility(null); setSuggestions(null); }}>
                  All venues
                </button>
                {venue && (<>
                  <ChevronRight className="h-3 w-3" />
                  <button className="rounded px-1.5 py-0.5 hover:bg-muted hover:text-foreground"
                    onClick={() => { setFacility(null); setSuggestions(null); }}>{venue}</button>
                </>)}
                {facility && (<>
                  <ChevronRight className="h-3 w-3" />
                  <span className="rounded px-1.5 py-0.5 font-medium text-foreground">{facility.name}</span>
                </>)}
              </nav>
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

              {/* step 1: venues */}
              {!venue && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {venues.map((v, i) => {
                    const inVenue = facilities.filter((f) => f.venue === v);
                    const freeCount = inVenue.filter((f) => !busyNow.has(f.id)).length;
                    return (
                      <button key={v} onClick={() => setVenue(v)}
                        className="animate-reveal group overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg"
                        style={{ animationDelay: `${i * 60}ms` }}>
                        <div className="h-28 bg-muted/40"><FacilityIso type={inVenue[0].type} busy={freeCount === 0} /></div>
                        <div className="p-4">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-4 w-4 text-primary" />
                            <h3 className="font-display text-lg font-semibold">{v}</h3>
                          </div>
                          <p className="pt-1 text-sm text-muted-foreground">
                            {Array.from(new Set(inVenue.map((f) => typeLabel(f.type)))).join(", ")}
                          </p>
                          <div className="flex items-center gap-2 pt-2.5">
                            <Badge variant={freeCount ? "default" : "destructive"}>
                              {freeCount} of {inVenue.length} free
                            </Badge>
                            <span className="text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
                              View rooms
                            </span>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* step 2: facilities in venue */}
              {venue && !facility && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {venueFacilities.map((f, i) => {
                    const busy = busyNow.has(f.id);
                    const r = rules[f.id];
                    return (
                      <button key={f.id}
                        onClick={() => { setFacility(f); setParticipants(Math.min(2, f.capacity)); }}
                        className="animate-reveal overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-all hover:-translate-y-1 hover:border-primary hover:shadow-lg"
                        style={{ animationDelay: `${i * 60}ms` }}>
                        <div className="h-32 bg-muted/40"><FacilityIso type={f.type} busy={busy} /></div>
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-2">
                            <h3 className="font-display font-semibold">{f.name}</h3>
                            <Badge variant={busy ? "destructive" : "default"}>
                              {busy ? "In use" : "Free now"}
                            </Badge>
                          </div>
                          <p className="flex items-center gap-1.5 pt-1 text-sm text-muted-foreground">
                            <Users2 className="h-3.5 w-3.5" /> up to {f.capacity} people
                          </p>
                          {r && (
                            <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
                              <Clock className="h-3.5 w-3.5" />
                              {r.open_time.slice(0, 5)}-{r.close_time.slice(0, 5)} - {r.min_duration_mins}-{r.max_duration_mins} min
                              {r.auto_approve ? " - instant" : " - needs approval"}
                            </p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {/* step 3: booking form */}
              {facility && (
                <div className="grid gap-6 lg:grid-cols-5">
                  <div className="space-y-4 lg:col-span-3">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Date</label>
                        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">Start time</label>
                        <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">
                          Duration
                          <span className="pl-1 font-normal text-muted-foreground">
                            ({rule?.min_duration_mins ?? 30}-{rule?.max_duration_mins ?? 120} min)
                          </span>
                        </label>
                        <Select value={String(duration)} onValueChange={(v) => setDuration(Number(v))}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {[30, 60, 90, 120, 180, 240].map((d) => (
                              <SelectItem key={d} value={String(d)}>{d} min</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium">
                          People joining
                          <span className="pl-1 font-normal text-muted-foreground">(max {facility.capacity})</span>
                        </label>
                        <Input type="number" min={1} max={facility.capacity} value={participants}
                          onChange={(e) => setParticipants(Number(e.target.value))} />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Purpose <span className="font-normal text-muted-foreground">(optional)</span></label>
                      <Input placeholder="e.g. group assignment discussion" value={purpose}
                        onChange={(e) => setPurpose(e.target.value)} />
                    </div>
                    <Button className="w-full gap-2" size="lg" onClick={checkAndBook} disabled={checking}>
                      {checking ? (
                        <><span className="h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground/40 border-t-primary-foreground" />
                        Checking availability...</>
                      ) : (<>Check availability &amp; book</>)}
                    </Button>

                    {suggestions && suggestions.length > 0 && (
                      <div className="animate-field-in space-y-2 rounded-xl border border-primary/30 bg-accent/40 p-3">
                        <p className="flex items-center gap-1.5 text-sm font-medium">
                          <Sparkles className="h-4 w-4 text-primary" />
                          That time is taken - AI-ranked alternatives:
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {suggestions.map((s, i) => (
                            <button key={`${s.facilityId}-${s.start.getTime()}`} onClick={() => bookAt(s.start, s.end, s, i)}
                              className="rounded-lg border bg-card p-3 text-left transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-sm">
                              <div className="flex items-center justify-between">
                                <span className="font-display font-semibold">
                                  {fmtTime(s.start)} - {fmtTime(s.end)}
                                </span>
                                {i === 0 && <Badge>Best</Badge>}
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
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  {/* equipment */}
                  <div className="lg:col-span-2">
                    <div className="rounded-xl border bg-muted/30 p-4">
                      <h4 className="font-display font-semibold">Equipment</h4>
                      <p className="pb-3 text-xs text-muted-foreground">
                        Checked against stock for your time slot
                      </p>
                      <div className="space-y-2.5">
                        {facilityEquipment.length === 0 && (
                          <p className="text-sm text-muted-foreground">Nothing requestable here.</p>
                        )}
                        {facilityEquipment.map((e) => {
                          const q = equipReq[e.id] ?? 0;
                          return (
                            <div key={e.id} className="flex items-center justify-between gap-2 rounded-lg bg-card px-3 py-2">
                              <div>
                                <p className="text-sm font-medium">{e.name}</p>
                                <p className="text-xs text-muted-foreground">{e.total_qty} in stock</p>
                              </div>
                              <div className="flex items-center gap-1.5">
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={q === 0}
                                  onClick={() => setEquipReq({ ...equipReq, [e.id]: q - 1 })}>-</Button>
                                <span className={`w-5 text-center text-sm ${q ? "font-semibold text-primary" : ""}`}>{q}</span>
                                <Button size="sm" variant="outline" className="h-7 w-7 p-0" disabled={q >= e.total_qty}
                                  onClick={() => setEquipReq({ ...equipReq, [e.id]: q + 1 })}>+</Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* popular times */}
                  <div className="lg:col-span-5">
                    <div className="rounded-xl border bg-card p-4">
                      <PopularTimes
                        facilityId={facility.id}
                        openHour={rule ? Number(rule.open_time.slice(0, 2)) : 8}
                        closeHour={rule ? Number(rule.close_time.slice(0, 2)) : 22}
                      />
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* my bookings */}
          <Card className="animate-reveal" style={{ animationDelay: "280ms" }}>
            <CardHeader>
              <CardTitle className="font-display flex items-center gap-2">
                <CalendarDays className="h-5 w-5 text-primary" />
                My bookings
              </CardTitle>
              <CardDescription>Check in when your session starts, or cancel in advance</CardDescription>
            </CardHeader>
            <CardContent>
              {myBookings.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-center">
                  <CalendarX className="h-8 w-8 text-muted-foreground/50" />
                  <p className="font-medium">No bookings yet</p>
                  <p className="text-sm text-muted-foreground">Pick a venue above to make your first reservation.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {myBookings.map((b) => {
                    const f = facilities.find((x) => x.id === b.facility_id);
                    const start = new Date(b.start_time);
                    const hasDoor = doorRooms.has(b.facility_id);
                    const canCheckIn = !hasDoor && b.status === "approved" && !b.checked_in_at && !b.no_show &&
                      Date.now() >= start.getTime() - 15 * 60000 &&
                      Date.now() <= new Date(b.end_time).getTime();
                    const canShowCode = hasDoor && b.status === "approved" &&
                      new Date(b.end_time).getTime() > Date.now();
                    const code = codes[b.id];
                    const canCancel = (b.status === "pending" || b.status === "approved") &&
                      start.getTime() > Date.now() && !b.checked_in_at;
                    const grace = rules[b.facility_id]?.checkin_grace_mins;
                    const checkInBy = grace ? new Date(start.getTime() + grace * 60000) : null;
                    const showDeadline = !!checkInBy && b.status === "approved" && !b.checked_in_at &&
                      Date.now() < checkInBy.getTime();
                    const released = b.status === "cancelled" && b.cancel_reason === "no_checkin";
                    return (
                      <div key={b.id}
                        className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3 transition-colors hover:bg-muted/30">
                        <div className="flex h-11 w-11 shrink-0 flex-col items-center justify-center rounded-lg bg-accent text-accent-foreground">
                          <span className="text-[10px] uppercase leading-none">
                            {start.toLocaleDateString([], { month: "short" })}
                          </span>
                          <span className="font-display text-base font-semibold leading-tight">
                            {start.getDate()}
                          </span>
                        </div>
                        <div className="min-w-[9rem] flex-1">
                          <p className="font-medium">{f?.name ?? "Facility"}</p>
                          <p className="text-xs text-muted-foreground">
                            {start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {" - "}
                            {new Date(b.end_time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            {f ? ` - ${f.venue}` : ""}
                          </p>
                          {showDeadline && checkInBy && (
                            <p className="pt-0.5 text-xs font-medium text-primary">
                              {hasDoor ? "Enter your door code by " : "Check in by "}
                              {fmtTime(checkInBy)} or this booking is released
                            </p>
                          )}
                          {code && (
                            <div className="mt-1.5 inline-block rounded-lg border border-primary/40 bg-accent/60 px-3 py-1.5">
                              <span className="font-display text-xl font-semibold tracking-[0.3em]">{code.code}</span>
                              <span className="block text-[11px] text-muted-foreground">{code.hint}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {released
                            ? <Badge variant="destructive">released - no check-in</Badge>
                            : <Badge variant={STATUS_COLOR[b.status]}>{b.status}</Badge>}
                          {b.checked_in_at && <Badge variant="outline">checked in</Badge>}
                          {b.cancel_reason === "early_leave" && b.status === "approved" && (
                            <Badge variant="secondary">ended early - room empty</Badge>
                          )}
                          {b.no_show && !released && <Badge variant="destructive">no-show</Badge>}
                        </div>
                        <div className="ml-auto flex gap-1.5">
                          {canCheckIn && <Button size="sm" onClick={() => checkIn(b)}>Check in</Button>}
                          {canShowCode && !code && (
                            <Button size="sm" onClick={() => showDoorCode(b)}>Door code</Button>
                          )}
                          {canCancel && (
                            <Button size="sm" variant="outline" onClick={() => cancel(b)}>Cancel</Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
      <Chatbot />
    </AppShell>
  );
}
