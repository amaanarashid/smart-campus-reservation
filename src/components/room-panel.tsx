"use client";

import { useCallback, useEffect, useState, type ComponentType, type CSSProperties } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import FacilityIso from "@/components/facility-iso";
import RoomControls from "@/components/room-controls";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import {
  AirVent, AlarmClock, Bell, CalendarPlus, Cpu, DoorClosed, DoorOpen, KeyRound, Leaf,
  Lightbulb, LightbulbOff, PersonStanding, RefreshCw, Snowflake, TimerReset, Wifi, WifiOff, Zap,
} from "lucide-react";
import {
  AC_KW, CO2_KG_PER_KWH, LIGHT_KW, energyReport, lastWeek,
  type EnergyBooking, type EnergyEvent, type EnergyReport,
} from "@/lib/energy";
import { fmtDay, fmtRelativeDay, fmtTime, myAt, myDateKey } from "@/lib/time";

interface DeviceRow {
  id: string; facility_id: string; label: string; active: boolean; last_seen_at: string | null;
}
interface RoomEvent extends EnergyEvent { id: number; device_id: string; facility_id: string }

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** What each event looks like in the log. */
const EVENT_META: Record<string, { label: string; Icon: ComponentType<{ className?: string }>; warn?: boolean }> = {
  unlock_ok: { label: "Door unlocked with code", Icon: KeyRound },
  unlock_denied: { label: "Wrong code at the door", Icon: KeyRound, warn: true },
  door_open: { label: "Door opened", Icon: DoorOpen },
  door_closed: { label: "Door closed", Icon: DoorClosed },
  presence_on: { label: "People detected", Icon: PersonStanding },
  presence_off: { label: "Room empty", Icon: PersonStanding },
  lights_on: { label: "Lights on", Icon: Lightbulb },
  lights_off: { label: "Lights off", Icon: LightbulbOff },
  ac_on: { label: "Air-con on", Icon: Snowflake },
  ac_off: { label: "Air-con off", Icon: AirVent },
  reminder: { label: "End-of-booking reminder", Icon: AlarmClock },
  booking_ended: { label: "Booking ended", Icon: Bell },
  overstay: { label: "Still occupied after the end", Icon: Bell, warn: true },
  extended: { label: "Booking extended", Icon: CalendarPlus },
  extend_denied: { label: "Extension refused", Icon: CalendarPlus, warn: true },
  released_early: { label: "Early release check", Icon: TimerReset },
  heartbeat: { label: "Heartbeat", Icon: Cpu },
};

function describe(e: RoomEvent): string {
  const d = (e.detail ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case "door_open": return d.forced ? "Door opened without a code" : "Door opened";
    case "ac_on": return d.precool ? "Air-con on (pre-cooling)" : "Air-con on";
    case "reminder": return `Reminder: ${d.minutes_left ?? "?"} min left`;
    case "extended": return `Extended +${d.added_mins ?? "?"} min (${d.via ?? "?"})`;
    case "extend_denied": return `Extension refused: ${String(d.reason ?? "").replace(/_/g, " ")}`;
    case "released_early": return d.released ? `Released early: ${d.freed_mins} min given back` : `Early release skipped (${d.reason ?? ""})`;
    case "booking_ended": return d.occupied ? "Booking ended, people still inside" : "Booking ended, room empty";
    case "overstay": return `Still occupied${d.minutes_over != null ? `, ${d.minutes_over} min over` : ""}`;
    default: return EVENT_META[e.kind]?.label ?? e.kind;
  }
}

/** Latest on/off state of an output from the event log (newest first). */
function lastState(events: RoomEvent[], on: string, off: string): boolean | null {
  const e = events.find((x) => x.kind === on || x.kind === off);
  return e ? e.kind === on : null;
}

function Tile({ label, on, onText, offText, Icon, i }: {
  label: string; on: boolean | null; onText: string; offText: string;
  Icon: ComponentType<{ className?: string }>; i: number;
}) {
  return (
    <div style={stagger(i)}
      className={`animate-reveal stagger flex items-center gap-3 rounded-xl border p-3 transition-colors ${
        on ? "border-primary/50 bg-accent/40" : "bg-card"}`}>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors ${
        on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div>
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="font-medium">{on === null ? "No data yet" : on ? onText : offText}</p>
      </div>
    </div>
  );
}

/**
 * Live readings and energy for smart rooms. Admins see every room; a facility
 * manager sees only the rooms they manage (room_devices_visible and the
 * room_events policy both filter by facility_managers). `hideWhenEmpty` lets
 * the manager dashboard drop the section when none of their rooms has a device.
 */
export default function RoomPanel({ hideWhenEmpty = false, heading }: { hideWhenEmpty?: boolean; heading?: string }) {
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [names, setNames] = useState<Record<string, { name: string; type: string }>>({});
  const [events, setEvents] = useState<RoomEvent[]>([]);
  const [bookings, setBookings] = useState<(EnergyBooking & { facility_id: string })[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [nowMs, setNowMs] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const now = new Date();
    const { fromDay } = lastWeek(now);
    const since = new Date(myAt(fromDay, "00:00").getTime() - 86_400_000).toISOString();
    // the view exposes devices to their managers without the key hash
    let { data: devs, error } = await supabase.from("room_devices_visible")
      .select("id, facility_id, label, active, last_seen_at").order("label");
    if (error) {
      // before upgrade-room-end.sql: admins can still read the table itself
      ({ data: devs, error } = await supabase.from("room_devices")
        .select("id, facility_id, label, active, last_seen_at").order("label"));
    }
    if (error) { setState("missing"); return; }
    const list = (devs as DeviceRow[]) ?? [];
    setDevices(list);
    setSelected((s) => s ?? list[0]?.id ?? null);
    const facIds = list.map((d) => d.facility_id);
    if (facIds.length) {
      const [{ data: f }, { data: ev }, { data: bk }] = await Promise.all([
        supabase.from("facilities_full").select("id, name, type").in("id", facIds),
        supabase.from("room_events").select("id, device_id, facility_id, reservation_id, at, kind, detail")
          .in("facility_id", facIds).gte("at", since).order("at", { ascending: false }).limit(3000),
        supabase.from("reservations").select("id, facility_id, start_time, end_time, status, checked_in_at, cancel_reason")
          .in("facility_id", facIds).gte("start_time", since),
      ]);
      const m: Record<string, { name: string; type: string }> = {};
      ((f as { id: string; name: string; type: string }[]) ?? []).forEach((x) => { m[x.id] = { name: x.name, type: x.type }; });
      setNames(m);
      setEvents((ev as RoomEvent[]) ?? []);
      setBookings((bk as (EnergyBooking & { facility_id: string })[]) ?? []);
    }
    setNowMs(now.getTime());
    setState("ready");
  }, []);

  useEffect(() => {
    // first load, then refresh every 30 s while the tab is open
    const first = setTimeout(load, 0);
    const t = setInterval(load, 30_000);
    return () => { clearTimeout(first); clearInterval(t); };
  }, [load]);

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  if (state === "loading") {
    return (
      <div className="space-y-4">
        <div className="skeleton h-40" />
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}</div>
        <div className="skeleton h-72" />
      </div>
    );
  }

  if (state === "missing" || devices.length === 0) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="animate-reveal">
        <CardContent className="flex flex-col items-center gap-2 py-16 text-center">
          <Cpu className="h-10 w-10 text-muted-foreground/40" />
          <p className="font-display text-lg font-semibold">No smart rooms yet</p>
          <p className="max-w-md text-sm text-muted-foreground">
            {state === "missing"
              ? "Run supabase/upgrade-room-access.sql and upgrade-room-end.sql in the Supabase SQL editor first."
              : "Register a room's door in the Supabase SQL editor:"}
          </p>
          {state !== "missing" && (
            <code className="rounded-lg bg-muted px-3 py-2 text-xs">
              select public.register_room_device(&apos;Room name&apos;, &apos;a-long-random-key&apos;);
            </code>
          )}
        </CardContent>
      </Card>
    );
  }

  const device = devices.find((d) => d.id === selected) ?? devices[0];
  const fac = names[device.facility_id];
  const now = new Date(nowMs || 0);
  const devEvents = events.filter((e) => e.facility_id === device.facility_id);
  const devBookings = bookings.filter((b) => b.facility_id === device.facility_id);
  const { fromDay, toDay } = lastWeek(now);
  const report: EnergyReport = energyReport(devEvents, devBookings, fromDay, toDay, now);
  const online = !!device.last_seen_at && nowMs - new Date(device.last_seen_at).getTime() < 2 * 60_000;
  const running = devBookings.find((b) => b.status === "approved" &&
    new Date(b.start_time).getTime() <= nowMs && nowMs < new Date(b.end_time).getTime());
  const lights = lastState(devEvents, "lights_on", "lights_off");
  const ac = lastState(devEvents, "ac_on", "ac_off");
  const people = lastState(devEvents, "presence_on", "presence_off");
  const door = lastState(devEvents, "door_open", "door_closed");
  const chart = report.days.map((d) => ({
    day: fmtDay(d.day).split(" ").slice(0, 2).join(" "),
    "Conventional room": d.baselineKwh,
    "Smart room": d.actualKwh,
  }));
  const powerKw = (lights ? LIGHT_KW : 0) + (ac ? AC_KW : 0);
  const today = report.days[report.days.length - 1];
  const usedPct = report.totals.bookedMins ? Math.round((report.totals.usedMins / report.totals.bookedMins) * 100) : 0;

  return (
    <div className="space-y-6">
      {heading && (
        <div className="flex items-center gap-2 pt-2">
          <Cpu className="h-5 w-5 text-primary" />
          <h2 className="font-display text-xl font-semibold">{heading}</h2>
          <span className="text-sm text-muted-foreground">live readings and energy, refreshed every 30 s</span>
        </div>
      )}
      {/* device picker, when there is more than one smart room */}
      {devices.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {devices.map((d) => (
            <button key={d.id} onClick={() => setSelected(d.id)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                d.id === device.id ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
              {names[d.facility_id]?.name ?? d.label}
            </button>
          ))}
        </div>
      )}

      {/* live status */}
      <Card className="animate-reveal overflow-hidden">
        <div className="grid gap-0 md:grid-cols-[260px_minmax(0,1fr)]">
          <div className="relative h-44 bg-muted/40 md:h-auto">
            {fac && <FacilityIso type={fac.type} busy={!!running} />}
            <span className={`absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold shadow ${
              online ? "bg-card text-foreground" : "bg-destructive text-primary-foreground"}`}>
              {online ? <Wifi className="h-3.5 w-3.5 text-primary" /> : <WifiOff className="h-3.5 w-3.5" />}
              {online ? "Device online" : "Device offline"}
            </span>
          </div>
          <div className="space-y-4 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-xl font-semibold">{fac?.name ?? device.label}</h3>
                <p className="text-sm text-muted-foreground">
                  {running
                    ? `Booked until ${fmtTime(new Date(running.end_time))}${running.checked_in_at ? " · checked in" : " · waiting for check-in"}`
                    : "No booking running"}
                  {device.last_seen_at && ` · last heard ${fmtTime(new Date(device.last_seen_at))}`}
                </p>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Refresh
              </Button>
            </div>
            {/* live power reading: what the room is drawing now, from the switched loads */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-xl border bg-muted/30 px-4 py-3">
              <div className="flex items-center gap-2">
                <Zap className={`h-5 w-5 ${powerKw > 0 ? "text-primary" : "text-muted-foreground"}`} />
                <span className="font-display text-2xl font-semibold tabular-nums">{powerKw.toFixed(2)}</span>
                <span className="text-sm text-muted-foreground">kW now</span>
              </div>
              <div className="h-2 min-w-[8rem] flex-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${Math.round((powerKw / (LIGHT_KW + AC_KW)) * 100)}%` }} />
              </div>
              <div className="text-sm">
                <span className="font-semibold tabular-nums">{today?.actualKwh ?? 0} kWh</span>
                <span className="text-muted-foreground"> today · {today?.lightsMins ?? 0} min lights · {today?.acMins ?? 0} min air-con</span>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
              <Tile i={0} label="Presence" on={people} onText="People inside" offText="Empty" Icon={PersonStanding} />
              <Tile i={1} label="Lights" on={lights} onText="On" offText="Off" Icon={lights ? Lightbulb : LightbulbOff} />
              <Tile i={2} label="Air-con" on={ac} onText="Cooling" offText="Off" Icon={Snowflake} />
              <Tile i={3} label="Door" on={door} onText="Open" offText="Closed" Icon={door ? DoorOpen : DoorClosed} />
            </div>
          </div>
        </div>
      </Card>

      {/* remote control (the API lets only admins and this room's managers use it) */}
      <RoomControls facilityId={device.facility_id} />

      {/* energy */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {([
          ["Saved this week", `${report.totals.savedKwh} kWh`, `${report.totals.savedPct}% less than a conventional room`, Leaf],
          ["Smart room used", `${report.totals.actualKwh} kWh`, `vs ${report.totals.baselineKwh} kWh if always on when booked`, Zap],
          ["CO₂ avoided", `${report.totals.co2Kg} kg`, `at ${CO2_KG_PER_KWH} kg CO₂ per kWh`, Leaf],
          ["Booked time used", `${usedPct}%`, `${report.totals.usedMins} of ${report.totals.bookedMins} booked min had people`, PersonStanding],
        ] as const).map(([label, value, sub, Icon], i) => (
          <Card key={label} className="animate-reveal stagger" style={stagger(i)}>
            <CardContent className="flex items-start gap-3 py-5">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{label}</p>
                <p className="font-display animate-count text-2xl font-semibold leading-tight">{value}</p>
                <p className="pt-0.5 text-xs text-muted-foreground">{sub}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_420px]">
        <Card className="animate-reveal" style={{ animationDelay: "150ms" }}>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" /> Energy per day, last 7 days
            </CardTitle>
            <CardDescription>
              Conventional room: lights and air-con on for every booked minute, including no-shows and early
              leavers. Smart room: what the device actually switched on. E = P × t with lights {LIGHT_KW} kW and
              air-con {AC_KW} kW (assumed ratings).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chart} margin={{ left: -10, right: 8 }}>
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
                ["No-shows released", report.counts.noShowsReleased],
                ["Early releases", report.counts.earlyReleases],
                ["Extensions", report.counts.extensions],
                ["Overstays", report.counts.overstays],
                ["Reminders", report.counts.reminders],
              ] as const).map(([label, n]) => (
                <div key={label} className="rounded-lg border bg-muted/30 px-2 py-2">
                  <p className="font-display text-xl font-semibold">{n}</p>
                  <p className="text-[11px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* event log */}
        <Card className="animate-reveal" style={{ animationDelay: "220ms" }}>
          <CardHeader>
            <CardTitle className="font-display flex items-center gap-2">
              <Cpu className="h-5 w-5 text-primary" /> Room log
            </CardTitle>
            <CardDescription>What the room reported, newest first</CardDescription>
          </CardHeader>
          <CardContent className="max-h-[30rem] overflow-y-auto">
            {devEvents.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Nothing yet - start the Wokwi simulation and the events appear here.
              </p>
            ) : (
              <ol className="space-y-2">
                {devEvents.filter((e) => e.kind !== "heartbeat").slice(0, 40).map((e) => {
                  const meta = EVENT_META[e.kind] ?? { label: e.kind, Icon: Cpu };
                  return (
                    <li key={e.id} className="flex items-start gap-3 rounded-lg px-1 py-1">
                      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${
                        meta.warn ? "bg-destructive/10 text-destructive" : "bg-accent text-accent-foreground"}`}>
                        <meta.Icon className="h-3.5 w-3.5" />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm leading-snug">{describe(e)}</p>
                        <p className="text-xs text-muted-foreground">
                          {fmtRelativeDay(myDateKey(new Date(e.at)), now)}, {fmtTime(new Date(e.at))}
                        </p>
                      </div>
                      {meta.warn && <Badge variant="destructive" className="shrink-0">check</Badge>}
                    </li>
                  );
                })}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
