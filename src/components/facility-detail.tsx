"use client";

import { useCallback, useEffect, useState, type ComponentType } from "react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import type { Facility, FacilityRule } from "@/lib/types";
import { typeLabel } from "@/lib/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, CalendarDays, Cpu, DoorClosed, DoorOpen, Leaf, Lightbulb, LightbulbOff, Lock,
  LockOpen, MapPin, PersonStanding, Snowflake, Users2, Wifi, WifiOff, Zap,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { twinReading, type TwinBooking, type TwinEvent } from "@/lib/twin-state";
import { AC_KW, LIGHT_KW, energyReport, lastWeek, type EnergyBooking, type EnergyEvent } from "@/lib/energy";
import { fmtDay, fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";

// three.js is only downloaded when a facility is opened
const RoomTwin = dynamic(() => import("@/components/room-twin"), {
  ssr: false,
  loading: () => <div className="skeleton h-full w-full" />,
});

interface DeviceRow { id: string; label: string; last_seen_at: string | null }
interface Ev extends TwinEvent, EnergyEvent { id: number; detail?: unknown; reservation_id: string | null }
interface Bk extends TwinBooking, EnergyBooking { id: string; participants: number; profiles: { full_name: string } | null }

const LIVE_MS = 5_000;      // fast poll: latest events, so Wokwi changes show within seconds
const ENERGY_MS = 60_000;   // slow poll: a week of events for the energy figures

const EVENT_LABEL: Record<string, string> = {
  unlock_ok: "Door unlocked with code", unlock_denied: "Wrong code at the door",
  door_open: "Door opened", door_closed: "Door closed",
  presence_on: "People detected", presence_off: "Room empty",
  lights_on: "Lights on", lights_off: "Lights off", ac_on: "Air-con on", ac_off: "Air-con off",
  reminder: "End-of-booking reminder", booking_ended: "Booking ended", overstay: "Still occupied after the end",
  extended: "Booking extended", extend_denied: "Extension refused", released_early: "Early release check",
};
const WARN = new Set(["unlock_denied", "overstay", "extend_denied"]);

function Live({ label, on, onText, offText, Icon }: {
  label: string; on: boolean; onText: string; offText: string; Icon: ComponentType<{ className?: string }>;
}) {
  return (
    <div className={`flex items-center gap-3 rounded-xl border p-3 transition-colors duration-500 ${on ? "border-primary/50 bg-accent/40" : "bg-card"}`}>
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-500 ${
        on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="truncate text-sm font-medium">{on ? onText : offText}</p>
      </div>
    </div>
  );
}

/**
 * One facility, opened from the admin Smart room grid: a 3D twin fed by the
 * room's Wokwi device (or by its bookings if it has none), live readings,
 * today's schedule, the room log and the energy figures.
 */
export default function FacilityDetail({ facility, rule, onBack }: {
  facility: Facility;
  rule?: FacilityRule;
  onBack: () => void;
}) {
  const [device, setDevice] = useState<DeviceRow | null>(null);
  const [events, setEvents] = useState<Ev[]>([]);
  const [weekEvents, setWeekEvents] = useState<Ev[]>([]);
  const [bookings, setBookings] = useState<Bk[]>([]);
  const [weekBookings, setWeekBookings] = useState<Bk[]>([]);
  const [polledAt, setPolledAt] = useState(0);
  const [nowMs, setNowMs] = useState(0);

  const loadLive = useCallback(async () => {
    const today = myDateKey();
    const [{ data: dev }, { data: ev }, { data: bk }] = await Promise.all([
      supabase.from("room_devices_visible").select("id, label, last_seen_at").eq("facility_id", facility.id).maybeSingle(),
      supabase.from("room_events").select("id, at, kind, detail, reservation_id")
        .eq("facility_id", facility.id).order("at", { ascending: false }).limit(60),
      supabase.from("reservations")
        .select("id, start_time, end_time, status, checked_in_at, cancel_reason, participants, profiles(full_name)")
        .eq("facility_id", facility.id)
        .gte("start_time", myAt(today, "00:00").toISOString())
        .lt("start_time", myAt(today, "23:59").toISOString())
        .order("start_time"),
    ]);
    setDevice((dev as DeviceRow | null) ?? null);
    setEvents((ev as Ev[]) ?? []);
    setBookings((bk as unknown as Bk[]) ?? []);
    const t = Date.now();
    setPolledAt(t);
    setNowMs(t);
  }, [facility.id]);

  const loadWeek = useCallback(async () => {
    const { fromDay } = lastWeek(new Date());
    const since = new Date(myAt(fromDay, "00:00").getTime() - 86_400_000).toISOString();
    const [{ data: ev }, { data: bk }] = await Promise.all([
      supabase.from("room_events").select("id, at, kind, detail, reservation_id")
        .eq("facility_id", facility.id).gte("at", since).order("at", { ascending: false }).limit(3000),
      supabase.from("reservations")
        .select("id, start_time, end_time, status, checked_in_at, cancel_reason, participants, profiles(full_name)")
        .eq("facility_id", facility.id).gte("start_time", since),
    ]);
    setWeekEvents((ev as Ev[]) ?? []);
    setWeekBookings((bk as unknown as Bk[]) ?? []);
  }, [facility.id]);

  useEffect(() => {
    const first = setTimeout(() => { loadLive(); loadWeek(); }, 0);
    const live = setInterval(loadLive, LIVE_MS);
    const week = setInterval(loadWeek, ENERGY_MS);
    const clock = setInterval(() => setNowMs(Date.now()), 1000);   // countdown + "updated 3 s ago"
    return () => { clearTimeout(first); clearInterval(live); clearInterval(week); clearInterval(clock); };
  }, [loadLive, loadWeek]);

  const now = new Date(nowMs || 0);
  const reading = twinReading({
    events, bookings, facilityActive: facility.status === "active",
    hasDevice: !!device, lastSeenAt: device?.last_seen_at ?? null, now,
  });
  const running = reading.running as Bk | null;
  const secsLeft = running ? Math.max(0, Math.floor((new Date(running.end_time).getTime() - nowMs) / 1000)) : 0;
  const powerKw = (reading.lights ? LIGHT_KW : 0) + (reading.ac ? AC_KW : 0);
  const { fromDay, toDay } = lastWeek(now);
  const energy = device && nowMs ? energyReport(weekEvents, weekBookings, fromDay, toDay, now) : null;
  const todayKwh = energy?.days[energy.days.length - 1]?.actualKwh ?? 0;
  const statusText = { free: "Free now", booked: "Booked - waiting for check-in", in_use: "In use", offline: "Offline", inactive: "Offline for maintenance" }[reading.status];
  const ago = polledAt ? Math.max(0, Math.round((nowMs - polledAt) / 1000)) : null;

  return (
    <div className="animate-step-in space-y-6">
      {/* header */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" className="gap-1.5" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" /> All rooms
        </Button>
        <div className="min-w-0">
          <h2 className="font-display text-2xl font-semibold leading-tight">{facility.name}</h2>
          <p className="flex flex-wrap items-center gap-1.5 pt-0.5 text-sm text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" /> {facility.venue} · {typeLabel(facility.type)} ·
            <Users2 className="h-3.5 w-3.5" /> {facility.capacity}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Badge variant={reading.status === "in_use" ? "destructive" : reading.status === "free" ? "default" : "secondary"}>
            {statusText}
          </Badge>
          {reading.source === "device" ? (
            <span className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${reading.online ? "" : "border-destructive/50 text-destructive"}`}>
              {reading.online ? (
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
                </span>
              ) : <WifiOff className="h-3.5 w-3.5" />}
              {reading.online ? "Live from Wokwi" : "Device offline"}
              {ago !== null && <span className="text-muted-foreground">· {ago}s ago</span>}
            </span>
          ) : (
            <span className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground">
              No smart device - shown from bookings
            </span>
          )}
        </div>
      </div>

      {/* twin + live panel */}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="overflow-hidden p-0">
          <div className="h-[340px] bg-gradient-to-b from-muted/30 to-muted/60 sm:h-[460px] 2xl:h-[540px]">
            <RoomTwin type={facility.type} capacity={facility.capacity} state={reading} />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-3 py-4">
              {running ? (
                <div className={`rounded-xl border p-3 ${secsLeft <= 600 ? "border-primary/50 bg-accent/40" : ""}`}>
                  <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Booking now</p>
                  <p className="font-medium">{running.profiles?.full_name ?? "Student"} · {running.participants} people</p>
                  <p className="text-sm text-muted-foreground">
                    {fmtTime(new Date(running.start_time))} - {fmtTime(new Date(running.end_time))}
                    {running.checked_in_at ? " · checked in" : " · not checked in yet"}
                  </p>
                  <p className="font-display pt-1 text-2xl font-semibold tabular-nums">
                    {Math.floor(secsLeft / 60)}:{String(secsLeft % 60).padStart(2, "0")}
                    <span className="pl-1.5 text-sm font-normal text-muted-foreground">left</span>
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed p-3 text-sm text-muted-foreground">No booking running right now.</div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <Live label="Presence" on={reading.people} onText="People inside" offText="Empty" Icon={PersonStanding} />
                <Live label="Lights" on={reading.lights} onText="On" offText="Off" Icon={reading.lights ? Lightbulb : LightbulbOff} />
                <Live label="Air-con" on={reading.ac} onText="Cooling" offText="Off" Icon={Snowflake} />
                <Live label="Door" on={reading.doorOpen} onText="Open" offText="Closed" Icon={reading.doorOpen ? DoorOpen : DoorClosed} />
              </div>
              {reading.source === "device" && (
                <>
                  <Live label="Lock" on={reading.unlocked} onText="Unlocked" offText="Locked" Icon={reading.unlocked ? LockOpen : Lock} />
                  <div className="flex items-center gap-3 rounded-xl border bg-muted/30 px-3 py-2.5">
                    <Zap className={`h-5 w-5 ${powerKw ? "text-primary" : "text-muted-foreground"}`} />
                    <span className="font-display text-xl font-semibold tabular-nums">{powerKw.toFixed(2)} kW</span>
                    <span className="ml-auto text-xs text-muted-foreground">{todayKwh} kWh today</span>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {energy && (
            <Card>
              <CardContent className="grid grid-cols-3 gap-2 py-4 text-center">
                {([
                  ["Saved", `${energy.totals.savedKwh} kWh`],
                  ["Less energy", `${energy.totals.savedPct}%`],
                  ["CO₂ avoided", `${energy.totals.co2Kg} kg`],
                ] as const).map(([l, v]) => (
                  <div key={l}>
                    <p className="font-display text-lg font-semibold">{v}</p>
                    <p className="text-[11px] text-muted-foreground">{l}, 7 days</p>
                  </div>
                ))}
                <p className="col-span-3 flex items-center justify-center gap-1 pt-1 text-[11px] text-muted-foreground">
                  <Leaf className="h-3 w-3" /> vs a room powered for every booked minute - chart below
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {/* schedule + log */}
      <div className="grid items-start gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2"><CalendarDays className="h-5 w-5 text-primary" /> Today</CardTitle>
            <CardDescription>
              {rule ? `Open ${rule.open_time.slice(0, 5)}-${rule.close_time.slice(0, 5)} · ${rule.min_duration_mins}-${rule.max_duration_mins} min · ${rule.auto_approve ? "instant booking" : "needs approval"}` : "Bookings today"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {bookings.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No bookings today.</p>
            ) : (
              <ol className="space-y-2">
                {bookings.map((b) => {
                  const isNow = running?.id === b.id;
                  const ended = new Date(b.end_time).getTime() <= nowMs;
                  return (
                    <li key={b.id} className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${isNow ? "border-primary/50 bg-accent/40" : ""} ${ended || b.status === "cancelled" ? "opacity-60" : ""}`}>
                      <span className="w-28 shrink-0 text-sm font-medium tabular-nums">
                        {fmtTime(new Date(b.start_time))} - {fmtTime(new Date(b.end_time))}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">{b.profiles?.full_name ?? "Student"}</span>
                      <Badge variant={b.status === "approved" ? "default" : b.status === "pending" ? "secondary" : "outline"}>
                        {b.cancel_reason === "no_checkin" ? "released" : b.checked_in_at ? "checked in" : b.status}
                      </Badge>
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              {device ? <Wifi className="h-5 w-5 text-primary" /> : <Cpu className="h-5 w-5 text-primary" />} Room log
            </CardTitle>
            <CardDescription>{device ? `What ${device.label} reported, newest first` : "This room has no smart device"}</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[22rem] overflow-y-auto">
            {!device ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Register a device for this room to get live readings:
                <code className="mt-2 block rounded bg-muted px-2 py-1 text-xs">select public.register_room_device(&apos;{facility.name}&apos;, &apos;a-long-random-key&apos;);</code>
              </p>
            ) : events.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing yet - start the Wokwi simulation.</p>
            ) : (
              <ol className="space-y-1.5">
                {events.filter((e) => e.kind !== "heartbeat").slice(0, 30).map((e) => (
                  <li key={e.id} className="flex items-center gap-2 text-sm">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${WARN.has(e.kind) ? "bg-destructive" : "bg-primary"}`} />
                    <span className="min-w-0 flex-1 truncate">{EVENT_LABEL[e.kind] ?? e.kind}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {fmtRelativeDay(myDateKey(new Date(e.at)), now)}, {fmtTime(new Date(e.at))}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      {/* energy chart */}
      {energy && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2"><Zap className="h-5 w-5 text-primary" /> Energy per day, last 7 days</CardTitle>
            <CardDescription>
              Conventional room: lights and air-con on for every booked minute, including no-shows and early leavers.
              Smart room: what the device actually switched on. E = P × t with lights {LIGHT_KW} kW and air-con {AC_KW} kW (assumed ratings).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={energy.days.map((d) => ({
                day: fmtDay(d.day).split(" ").slice(0, 2).join(" "),
                "Conventional room": d.baselineKwh, "Smart room": d.actualKwh,
              }))} margin={{ left: -10, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} unit=" kWh" width={60} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => `${v} kWh`} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Conventional room" fill="var(--chart-5)" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Smart room" fill="var(--chart-1)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
            <div className="grid gap-2 text-center sm:grid-cols-5">
              {([
                ["No-shows released", energy.counts.noShowsReleased],
                ["Early releases", energy.counts.earlyReleases],
                ["Extensions", energy.counts.extensions],
                ["Overstays", energy.counts.overstays],
                ["Reminders", energy.counts.reminders],
              ] as const).map(([label, n]) => (
                <div key={label} className="rounded-lg border bg-muted/30 px-2 py-2">
                  <p className="font-display text-xl font-semibold">{n}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
