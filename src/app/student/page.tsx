"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import {
  Facility, FacilityRule, Profile, Reservation, Equipment, typeLabel,
} from "@/lib/types";
import { recommendSlots, updateWeights, ScoredSlot, DEFAULT_WEIGHTS } from "@/lib/recommend";
import { ensureProfile } from "@/lib/profile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast, Toaster } from "sonner";
import Chatbot from "@/components/chatbot";
import AppShell from "@/components/app-shell";
import FacilityIso from "@/components/facility-iso";
import PopularTimes from "@/components/popular-times";
import { logEvent } from "@/lib/evaluation";

const STATUS_COLOR: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  approved: "default", pending: "secondary", rejected: "destructive", cancelled: "outline",
};

export default function StudentDashboard() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [rules, setRules] = useState<Record<string, FacilityRule>>({});
  const [equipment, setEquipment] = useState<Equipment[]>([]);
  const [busyNow, setBusyNow] = useState<Set<string>>(new Set());
  const [myBookings, setMyBookings] = useState<Reservation[]>([]);

  // navigation: venue -> facility -> booking form
  const [venue, setVenue] = useState<string | null>(null);
  const [facility, setFacility] = useState<Facility | null>(null);

  // booking form
  const [date, setDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [startTime, setStartTime] = useState("15:00");
  const [duration, setDuration] = useState(60);
  const [participants, setParticipants] = useState(2);
  const [purpose, setPurpose] = useState("");
  const [equipReq, setEquipReq] = useState<Record<string, number>>({});
  const [suggestions, setSuggestions] = useState<ScoredSlot[] | null>(null);
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
      const [{ data: f }, { data: r }, { data: e }] = await Promise.all([
        supabase.from("facilities").select("*").eq("status", "active").order("name"),
        supabase.from("facility_rules").select("*"),
        supabase.from("equipment").select("*").order("name"),
      ]);
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
      await loadBookings(p.id);
      setLoading(false);
    })();
  }, [router, loadBookings]);

  // ---------- booking ----------
  function buildWindow(): { start: Date; end: Date } {
    const start = new Date(`${date}T${startTime}:00`);
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
    const [oh, om] = rule.open_time.split(":").map(Number);
    const [ch, cm] = rule.close_time.split(":").map(Number);
    const open = new Date(start); open.setHours(oh, om, 0, 0);
    const close = new Date(start); close.setHours(ch, cm, 0, 0);
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
    const rule = rules[facility.id];

    const shortfall = await equipmentShortfall(start, end);
    if (shortfall) { toast.error(shortfall); return; }

    const status = rule?.auto_approve ? "approved" : "pending";
    const { data: created, error } = await supabase.from("reservations").insert({
      facility_id: facility.id, user_id: profile.id,
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

    toast.success(status === "approved"
      ? "Booked and auto-approved" + (eqRows.length ? " - equipment reserved" : "")
      : "Request submitted for approval" + (eqRows.length ? " with equipment" : ""));

    if (fromSuggestion) {
      logEvent("rec_accepted", { num: rank ?? 0 });
      const newW = updateWeights(profile.rec_weights ?? DEFAULT_WEIGHTS, fromSuggestion, start.getHours());
      await supabase.from("profiles").update({ rec_weights: newW }).eq("id", profile.id);
      setProfile({ ...profile, rec_weights: newW });
    }
    setSuggestions(null);
    setEquipReq({});
    await loadBookings(profile.id);
  }

  async function suggestAlternatives() {
    if (!facility) return;
    const rule = rules[facility.id];
    if (!rule) return;
    const dayStart = new Date(`${date}T00:00:00`);
    const { data: res } = await supabase
      .from("reservations").select("*")
      .eq("facility_id", facility.id)
      .gte("start_time", dayStart.toISOString())
      .lte("start_time", new Date(`${date}T23:59:59`).toISOString())
      .in("status", ["pending", "approved"]);
    const out = recommendSlots({
      facility, rule, reservations: (res as Reservation[]) ?? [],
      date: dayStart, durationMins: duration, participants,
      preferredHour: Number(startTime.split(":")[0]),
      weights: profile?.rec_weights ?? DEFAULT_WEIGHTS,
    });
    const shown = out.slots.slice(0, 4);
    setSuggestions(shown);
    if (shown.length > 0) logEvent("rec_shown", { num: shown.length });
    if (out.slots.length === 0)
      toast.info("No free slots left that day - try another date.");
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

  async function cancel(r: Reservation) {
    const ru = rules[r.facility_id];
    const hoursLeft = (new Date(r.start_time).getTime() - Date.now()) / 3600000;
    if (ru && hoursLeft < ru.cancellation_hours) {
      toast.error(`This facility needs ${ru.cancellation_hours}h cancellation notice.`);
      return;
    }
    await supabase.from("reservations").update({ status: "cancelled" }).eq("id", r.id);
    toast.success("Booking cancelled");
    if (profile) await loadBookings(profile.id);
  }

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
          {/* breadcrumb */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <button className="hover:text-foreground" onClick={() => { setVenue(null); setFacility(null); setSuggestions(null); }}>
              Venues
            </button>
            {venue && (
              <>
                <span>/</span>
                <button className="hover:text-foreground" onClick={() => { setFacility(null); setSuggestions(null); }}>
                  {venue}
                </button>
              </>
            )}
            {facility && (<><span>/</span><span className="text-foreground">{facility.name}</span></>)}
          </div>

          {/* step 1: venues */}
          {!venue && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {venues.map((v) => {
                const inVenue = facilities.filter((f) => f.venue === v);
                const freeCount = inVenue.filter((f) => !busyNow.has(f.id)).length;
                return (
                  <button key={v} onClick={() => setVenue(v)}
                    className="rounded-xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md">
                    <div className="h-28"><FacilityIso type={inVenue[0].type} busy={freeCount === 0} /></div>
                    <h3 className="pt-3 text-lg font-semibold">{v}</h3>
                    <p className="text-sm text-muted-foreground">
                      {inVenue.length} facilit{inVenue.length === 1 ? "y" : "ies"} - {freeCount} free right now
                    </p>
                    <p className="pt-1 text-xs text-muted-foreground">
                      {Array.from(new Set(inVenue.map((f) => typeLabel(f.type)))).join(", ")}
                    </p>
                  </button>
                );
              })}
            </div>
          )}

          {/* step 2: facilities in venue */}
          {venue && !facility && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {venueFacilities.map((f) => {
                const busy = busyNow.has(f.id);
                const r = rules[f.id];
                return (
                  <button key={f.id} onClick={() => { setFacility(f); setParticipants(Math.min(2, f.capacity)); }}
                    className="rounded-xl border bg-card p-5 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary hover:shadow-md">
                    <div className="h-32"><FacilityIso type={f.type} busy={busy} /></div>
                    <div className="flex items-center justify-between pt-3">
                      <h3 className="font-semibold">{f.name}</h3>
                      <Badge variant={busy ? "destructive" : "default"}>
                        {busy ? "In use" : "Available now"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {typeLabel(f.type)} - up to {f.capacity} people
                    </p>
                    {r && (
                      <p className="pt-1 text-xs text-muted-foreground">
                        {r.open_time.slice(0, 5)}-{r.close_time.slice(0, 5)} - {r.min_duration_mins}-{r.max_duration_mins} min
                        {r.auto_approve ? " - instant booking" : " - needs approval"}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}

          {/* step 3: booking form */}
          {facility && (
            <div className="grid gap-6 lg:grid-cols-5">
              <Card className="lg:col-span-3">
                <CardHeader>
                  <CardTitle className="font-display">Book {facility.name}</CardTitle>
                  <CardDescription>
                    Enter your preferred time - if it clashes, the system suggests the closest free slots
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Date</label>
                      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">Start time</label>
                      <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">
                        Duration ({rule?.min_duration_mins ?? 30}-{rule?.max_duration_mins ?? 120} min allowed)
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
                    <div>
                      <label className="text-xs font-medium text-muted-foreground">
                        People joining (max {facility.capacity})
                      </label>
                      <Input type="number" min={1} max={facility.capacity} value={participants}
                        onChange={(e) => setParticipants(Number(e.target.value))} />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs font-medium text-muted-foreground">Purpose (optional)</label>
                    <Input placeholder="e.g. group assignment discussion" value={purpose}
                      onChange={(e) => setPurpose(e.target.value)} />
                  </div>
                  <Button className="w-full" onClick={checkAndBook} disabled={checking}>
                    {checking ? "Checking availability..." : "Check availability & book"}
                  </Button>

                  {suggestions && suggestions.length > 0 && (
                    <div className="space-y-2 rounded-lg border bg-accent/40 p-3">
                      <p className="text-sm font-medium">Suggested alternatives (AI-ranked):</p>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {suggestions.map((s, i) => (
                          <button key={i} onClick={() => bookAt(s.start, s.end, s, i)}
                            className="rounded-md border bg-card p-2.5 text-left text-sm transition-colors hover:border-primary">
                            <span className="font-medium">
                              {s.start.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                              {" - "}
                              {s.end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                            {i === 0 && <Badge className="ml-2">Best</Badge>}
                            {s.reasons.length > 0 && (
                              <span className="block text-xs text-muted-foreground">{s.reasons.join(" - ")}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle>Equipment</CardTitle>
                  <CardDescription>
                    Reserve items with your booking - availability is checked for your time slot
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {facilityEquipment.length === 0 && (
                    <p className="text-sm text-muted-foreground">No requestable equipment for this facility type.</p>
                  )}
                  {facilityEquipment.map((e) => {
                    const q = equipReq[e.id] ?? 0;
                    return (
                      <div key={e.id} className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium">{e.name}</p>
                          <p className="text-xs text-muted-foreground">{e.total_qty} in inventory</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button size="sm" variant="outline" disabled={q === 0}
                            onClick={() => setEquipReq({ ...equipReq, [e.id]: q - 1 })}>-</Button>
                          <span className="w-6 text-center text-sm">{q}</span>
                          <Button size="sm" variant="outline" disabled={q >= e.total_qty}
                            onClick={() => setEquipReq({ ...equipReq, [e.id]: q + 1 })}>+</Button>
                        </div>
                      </div>
                    );
                  })}
                </CardContent>
              </Card>

              {/* popular times */}
              <Card className="lg:col-span-5">
                <CardContent className="pt-6">
                  <PopularTimes
                    facilityId={facility.id}
                    openHour={rule ? Number(rule.open_time.slice(0, 2)) : 8}
                    closeHour={rule ? Number(rule.close_time.slice(0, 2)) : 22}
                  />
                </CardContent>
              </Card>
            </div>
          )}

          {/* my bookings */}
          <Card>
            <CardHeader><CardTitle>My bookings</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Facility</TableHead><TableHead>When</TableHead>
                    <TableHead>Status</TableHead><TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myBookings.map((b) => (
                    <TableRow key={b.id}>
                      <TableCell>{facilities.find((f) => f.id === b.facility_id)?.name ?? "-"}</TableCell>
                      <TableCell>
                        {new Date(b.start_time).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}
                      </TableCell>
                      <TableCell>
                        <Badge variant={STATUS_COLOR[b.status]}>{b.status}</Badge>
                        {b.checked_in_at && <Badge variant="outline" className="ml-1">checked in</Badge>}
                        {b.no_show && <Badge variant="destructive" className="ml-1">no-show</Badge>}
                      </TableCell>
                      <TableCell className="space-x-1 whitespace-nowrap">
                        {b.status === "approved" && !b.checked_in_at && !b.no_show &&
                          Date.now() >= new Date(b.start_time).getTime() - 15 * 60000 &&
                          Date.now() <= new Date(b.end_time).getTime() && (
                            <Button size="sm" onClick={() => checkIn(b)}>Check in</Button>
                          )}
                        {(b.status === "pending" || b.status === "approved") &&
                          new Date(b.start_time) > new Date() && !b.checked_in_at && (
                            <Button size="sm" variant="outline" onClick={() => cancel(b)}>Cancel</Button>
                          )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {myBookings.length === 0 && (
                    <TableRow><TableCell colSpan={4} className="text-muted-foreground">No bookings yet</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
      <Chatbot />
    </AppShell>
  );
}
