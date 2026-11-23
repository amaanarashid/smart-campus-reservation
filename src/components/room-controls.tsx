"use client";

import { useCallback, useEffect, useState, type ComponentType, type CSSProperties, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { useAutoRefresh } from "@/lib/use-auto-refresh";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  ChevronDown, DoorClosed, DoorOpen, Lightbulb, LightbulbOff, Loader2, Lock, LockOpen,
  MessageSquareText, PersonStanding, Send, ShieldAlert, Snowflake,
} from "lucide-react";
import {
  COMMAND_TTL_S, DEFAULT_OVERRIDE_MINS, MAX_MESSAGE_CHARS, describeCommand,
  type CommandKind, type OverrideState,
} from "@/lib/room-commands-shared";
import { fmtTime } from "@/lib/time";
import { capabilities, type Capabilities } from "@/lib/room-config";

interface CommandRow {
  id: string; kind: CommandKind; args: Record<string, unknown>; status: "sent" | "done" | "failed" | "expired";
  via: "mqtt" | "http" | null; issued_at: string; done_at: string | null; result: Record<string, unknown> | null;
}

const STATUS: Record<CommandRow["status"], { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  sent: { label: "waiting for room", variant: "secondary" },
  done: { label: "done", variant: "default" },
  failed: { label: "failed", variant: "destructive" },
  expired: { label: "not delivered", variant: "outline" },
};
const DURATIONS = [15, 30, 60, 120];
/** How long a tile keeps showing "not delivered" after a command failed. */
const FAILED_SHOWN_MS = 2 * 60_000;

type Bool = boolean | null;
/** What the room reports right now (from its event log); null = no data yet. */
export interface RoomState { people: Bool; lights: Bool; ac: Bool; door: Bool; unlocked?: Bool }
type Ctl = "lights" | "ac" | "lock";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** One status tile. With `onToggle` it opens to show its controls. */
function Tile({
  i, label, text, sub, on, Icon, iconClass = "", sending = false, failed = false, progress = 0,
  expanded = false, wide = false, onToggle, children,
}: {
  i: number; label: string; text: string; sub?: string | null; on: boolean;
  Icon: ComponentType<{ className?: string }>; iconClass?: string;
  sending?: boolean; failed?: boolean;
  /** 0-1: how much of a manual override is left (thin bar along the bottom). */
  progress?: number;
  expanded?: boolean;
  /** Take the whole row (narrow layouts), so opening it moves nothing sideways. */
  wide?: boolean;
  onToggle?: () => void; children?: ReactNode;
}) {
  const head = (
    <>
      <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors duration-500 ${
        on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"} ${on && !sending ? iconClass : ""}`}>
        {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Icon className="h-5 w-5" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">{label}</span>
        <span className="block truncate text-sm font-medium">{text}</span>
        {sub && <span className={`block truncate text-[11px] ${failed ? "font-medium text-destructive" : "text-muted-foreground"}`}>{sub}</span>}
      </span>
      {onToggle && <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} />}
    </>
  );
  return (
    <div style={stagger(i)}
      className={`animate-reveal stagger relative overflow-hidden rounded-xl border transition-colors duration-500 ${
        on ? "border-primary/50 bg-accent/40" : "bg-card"} ${wide ? "col-span-full" : ""} ${
        sending ? "border-primary" : failed ? "border-destructive/60" : ""} ${onToggle ? "hover:border-primary/60" : ""}`}>
      {/* its own layer, so it never restarts the tile's entrance animation */}
      {sending && <span className="tile-sending pointer-events-none absolute inset-0 rounded-xl" aria-hidden />}
      {onToggle
        ? <button type="button" onClick={onToggle} aria-expanded={expanded} aria-label={`${label}: ${text}. ${expanded ? "Hide" : "Show"} controls`}
            className={`flex w-full items-center gap-3 p-3 text-left ${failed ? "tile-failed" : ""}`}>{head}</button>
        : <div className="flex items-center gap-3 p-3">{head}</div>}
      {expanded && <div className="animate-field-in space-y-2.5 border-t px-3 pb-3 pt-2.5">{children}</div>}
      {progress > 0 && (
        <span className="absolute inset-x-0 bottom-0 block h-0.5 bg-primary/20" aria-hidden>
          <span className="block h-full bg-primary transition-[width] duration-1000 ease-linear" style={{ width: `${Math.min(100, progress * 100)}%` }} />
        </span>
      )}
    </div>
  );
}

/**
 * The live tiles of one smart room (presence, lights, air-con, door, lock),
 * with the remote control built into them: tap Lights, Air-con or Lock to act
 * on it. Admins and the room's managers only (the API checks).
 *
 * A tile never pretends: after a tap it shows "sending" until the room
 * confirms, and its On/Off text only changes when the device reports it. A
 * manual override shows until when it holds, with a bar running down.
 * Only the controls the room's setup has are offered (`caps`, room-config.ts).
 * `controllable={false}` gives plain read-only tiles (a room with no device).
 * `children` sit between the tiles and the door-message row (the power line).
 */
export default function RoomControls({
  facilityId, caps = capabilities(null), state, controllable = true, columns = "two", children,
}: {
  facilityId: string;
  caps?: Capabilities;
  state: RoomState;
  controllable?: boolean;
  /** "two" for a narrow side column, "four" where the tiles have the full width. */
  columns?: "two" | "four";
  children?: ReactNode;
}) {
  const [rows, setRows] = useState<CommandRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mins, setMins] = useState(DEFAULT_OVERRIDE_MINS);
  const [text, setText] = useState("");
  const [lastDelivery, setLastDelivery] = useState<"mqtt" | "http" | null>(null);
  const [missing, setMissing] = useState(false);
  const [open, setOpen] = useState<Ctl | null>(null);
  const [armed, setArmed] = useState(false);       // lockdown asks twice
  const [showLog, setShowLog] = useState(false);
  const [now, setNow] = useState(0);               // ticking clock (never Date.now() in render)

  const load = useCallback(async () => {
    if (!controllable) return;
    const { data, error } = await supabase.from("room_commands")
      .select("id, kind, args, status, via, issued_at, done_at, result")
      .eq("facility_id", facilityId).order("issued_at", { ascending: false }).limit(8);
    if (error) { setMissing(/room_commands/.test(error.message)); return; }
    setMissing(false);
    setRows((data as CommandRow[]) ?? []);
  }, [facilityId, controllable]);

  useEffect(() => {
    const first = setTimeout(() => { setNow(Date.now()); load(); }, 0);
    const tick = setInterval(() => setNow(Date.now()), 5000);
    if (!controllable) return () => { clearTimeout(first); clearInterval(tick); };
    // "sending" turns into the real state the moment the device confirms
    const channel = supabase.channel(`room-commands-${facilityId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_commands", filter: `facility_id=eq.${facilityId}` }, () => { load(); })
      .subscribe();
    return () => { clearTimeout(first); clearInterval(tick); supabase.removeChannel(channel); };
  }, [load, facilityId, controllable]);
  useAutoRefresh(load, 8000, controllable);   // backup; Realtime above is the fast path

  async function send(kind: CommandKind, args: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/room/command", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ facility_id: facilityId, kind, args }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { toast.error(j.error ?? "Could not send the command"); return; }
      setLastDelivery(j.delivery);
      toast.success(j.message);
      // MQTT was set up but the broker did not deliver: say why (the command still arrives over HTTP)
      if (j.mqtt_error) toast.warning(`MQTT: ${j.mqtt_error}`, { duration: 12_000 });
      if (kind === "message") setText("");
      setNow(Date.now());
      await load();
    } finally {
      setBusy(null);
    }
  }

  // ---- what the command log says about each control ----
  const ageOf = (r: CommandRow) => now - new Date(r.issued_at).getTime();
  const waiting = (r: CommandRow | undefined) => !!r && !!now && r.status === "sent" && ageOf(r) < COMMAND_TTL_S * 1000;
  const dropped = (r: CommandRow | undefined) =>
    !!r && !!now && (r.status === "failed" || r.status === "expired") && ageOf(r) < FAILED_SHOWN_MS;

  function overrideOf(kind: "lights" | "ac") {
    const r = rows.find((x) => x.kind === kind);
    const forced = r && (r.status === "done" || r.status === "sent") && (r.args.state === "on" || r.args.state === "off") ? r : null;
    const length = forced ? Number(forced.args.mins ?? 0) * 60_000 : 0;
    const until = forced ? new Date(forced.issued_at).getTime() + length : 0;
    const active = !!forced && !!now && until > now;
    return {
      mode: (active ? forced!.args.state : "auto") as OverrideState,
      until: active ? until : 0,
      progress: active && length > 0 ? (until - now) / length : 0,
      sending: !!busy?.startsWith(`${kind}-`) || waiting(r),
      failed: dropped(r),
    };
  }
  const lightsCtl = overrideOf("lights");
  const acCtl = overrideOf("ac");
  const unlockRow = rows.find((r) => r.kind === "unlock");
  const lockdownRow = rows.find((r) => r.kind === "lockdown");
  // current lockdown state = the latest lockdown command that was not dropped
  const lockedDown = !!rows.find((r) => r.kind === "lockdown" && (r.status === "done" || r.status === "sent"))?.args?.on;
  const lockSending = busy === "unlock" || busy === "lockdown" || waiting(unlockRow) || waiting(lockdownRow);
  const lockFailed = dropped(unlockRow) || dropped(lockdownRow);

  const can = controllable && !missing;
  const stack = columns === "two";
  const canLights = can && !!caps.lights;
  const canAc = can && !!caps.ac;
  const canLock = can && (!!caps.door || !!caps.checkIn);
  const showLock = state.unlocked !== undefined || canLock;
  const toggle = (c: Ctl) => { setArmed(false); setOpen((o) => (o === c ? null : c)); };
  const word = (v: Bool, yes: string, no: string) => (v === null ? "No data yet" : v ? yes : no);
  const subOf = (c: ReturnType<typeof overrideOf>, enabled: boolean) =>
    !enabled ? null
      : c.sending ? "Sending to the room..."
      : c.failed ? "Not delivered"
      : c.until ? `Manual ${c.mode} until ${fmtTime(new Date(c.until))}`
      : "Automatic";

  const chip = (on: boolean) =>
    `rounded-full border px-2.5 py-0.5 transition-colors ${on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`;

  /** On / Off / Auto, and how long a manual choice holds. */
  const override = (kind: "lights" | "ac", c: ReturnType<typeof overrideOf>) => (
    <>
      <div className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-1" role="group" aria-label={kind === "ac" ? "Air-con" : "Lights"}>
        {(["on", "off", "auto"] as OverrideState[]).map((st) => (
          <button key={st} type="button" disabled={!!busy} aria-pressed={c.mode === st}
            onClick={() => send(kind, { state: st, mins }, `${kind}-${st}`)}
            className={`flex h-8 items-center justify-center rounded-md text-sm font-medium capitalize transition-all duration-300 disabled:opacity-60 ${
              c.mode === st ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>
            {busy === `${kind}-${st}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : st}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        On or off holds for
        {DURATIONS.map((d) => (
          <button key={d} type="button" aria-pressed={mins === d} onClick={() => setMins(d)} className={chip(mins === d)}>{d} min</button>
        ))}
        <span>then back to automatic</span>
      </div>
      {kind === "ac" && caps.ac === "ir" && !caps.acReady && (
        <p className="text-xs text-muted-foreground">The air-con make is not set yet, so the room can&apos;t send it commands. An admin can set it in Room setup.</p>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      {/* narrow: the two read-only tiles share a row and each control gets its own, so opening
          one moves nothing sideways. Wide: all in one grid, each opening in place. */}
      <div className={stack ? "grid grid-cols-2 gap-2" : "grid items-start gap-3 sm:grid-cols-2 2xl:grid-cols-4"}>
        <Tile i={0} label="Presence" on={!!state.people} text={word(state.people, "People inside", "Empty")}
          Icon={PersonStanding} iconClass="tile-presence" />

        <Tile i={1} label="Door" on={!!state.door} text={word(state.door, "Open", "Closed")}
          Icon={state.door ? DoorOpen : DoorClosed} />

        <Tile i={2} wide={stack} label="Lights" on={!!state.lights} text={word(state.lights, "On", "Off")}
          Icon={state.lights ? Lightbulb : LightbulbOff} iconClass="tile-glow"
          sub={subOf(lightsCtl, canLights)} sending={canLights && lightsCtl.sending} failed={canLights && lightsCtl.failed}
          progress={canLights ? lightsCtl.progress : 0}
          expanded={open === "lights"} onToggle={canLights ? () => toggle("lights") : undefined}>
          {override("lights", lightsCtl)}
        </Tile>

        <Tile i={3} wide={stack} label="Air-con" on={!!state.ac} text={word(state.ac, "Cooling", "Off")}
          Icon={Snowflake} iconClass="tile-spin"
          sub={subOf(acCtl, canAc)} sending={canAc && acCtl.sending} failed={canAc && acCtl.failed}
          progress={canAc ? acCtl.progress : 0}
          expanded={open === "ac"} onToggle={canAc ? () => toggle("ac") : undefined}>
          {override("ac", acCtl)}
        </Tile>

        {showLock && (
          <Tile i={4} wide={stack} label="Lock" on={!!state.unlocked}
            text={state.unlocked === undefined ? (lockedDown ? "Keypad locked down" : "Door lock") : word(state.unlocked, "Unlocked", "Locked")}
            Icon={state.unlocked ? LockOpen : Lock} iconClass="tile-unlock"
            sub={!canLock ? null : lockSending ? "Sending to the room..." : lockFailed ? "Not delivered"
              : lockedDown && state.unlocked !== undefined ? "Keypad locked down" : null}
            sending={canLock && lockSending} failed={canLock && lockFailed}
            expanded={open === "lock"} onToggle={canLock ? () => toggle("lock") : undefined}>
            <div className="flex flex-wrap items-center gap-2">
              {caps.door && (
                <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => send("unlock", { secs: 8 }, "unlock")}>
                  {busy === "unlock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />} Unlock for 8 s
                </Button>
              )}
              {caps.checkIn && (lockedDown ? (
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!!busy} onClick={() => send("lockdown", { on: false }, "lockdown")}>
                  {busy === "lockdown" ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockOpen className="h-4 w-4" />} Lift lockdown
                </Button>
              ) : armed ? (
                <span className="animate-pop-in flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Nobody can check in with a code until you lift it.</span>
                  <Button size="sm" variant="destructive" className="gap-1.5" disabled={!!busy}
                    onClick={() => { setArmed(false); send("lockdown", { on: true }, "lockdown"); }}>
                    {busy === "lockdown" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />} Yes, lock down
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setArmed(false)}>Keep open</Button>
                </span>
              ) : (
                <Button size="sm" variant="outline" className="gap-1.5 text-destructive" disabled={!!busy} onClick={() => setArmed(true)}>
                  <Lock className="h-4 w-4" /> Lock down keypad
                </Button>
              ))}
            </div>
          </Tile>
        )}
      </div>

      {children}

      {controllable && missing && (
        <p className="text-xs text-muted-foreground">Remote control is not set up yet - run supabase/upgrade-room-commands.sql.</p>
      )}

      {can && caps.message && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <MessageSquareText className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-8" maxLength={MAX_MESSAGE_CHARS} value={text} placeholder="Message on the door screen"
              aria-label="Message on the door screen"
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) send("message", { text, secs: 300 }, "message"); }} />
          </div>
          <Button size="sm" className="h-9 shrink-0 gap-1.5" disabled={!!busy || !text.trim()} onClick={() => send("message", { text, secs: 300 }, "message")}>
            {busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Show 5 min
          </Button>
        </div>
      )}

      {/* every command is logged; kept one tap away so the tiles stay calm */}
      {can && rows.length > 0 && (
        <div>
          <button type="button" onClick={() => setShowLog((v) => !v)} aria-expanded={showLog}
            className="flex w-full items-center gap-2 rounded-lg py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground">
            <ChevronDown className={`h-3.5 w-3.5 transition-transform duration-300 ${showLog ? "rotate-180" : ""}`} />
            Recent commands ({rows.length})
            {lastDelivery && (
              <Badge variant={lastDelivery === "mqtt" ? "default" : "secondary"} className="ml-auto h-5 px-1.5 text-[10px]">
                {lastDelivery === "mqtt" ? "via MQTT - instant" : "via HTTP - up to 5 s"}
              </Badge>
            )}
          </button>
          {showLog && (
            <ol className="animate-field-in space-y-1.5 pt-2">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(new Date(r.issued_at))}</span>
                  <span className="min-w-0 flex-1 truncate">{describeCommand(r.kind, r.args)}</span>
                  {r.result?.warned_occupants === true && <span className="text-xs text-muted-foreground">people warned first</span>}
                  {typeof r.result?.error === "string" && <span className="text-xs text-muted-foreground">{r.result.error}</span>}
                  {r.kind === "ir_learn" && typeof r.result?.protocol === "string" && (
                    <span className="text-xs text-muted-foreground">heard {r.result.protocol === "RAW" ? "an unknown make (recorded)" : r.result.protocol}</span>
                  )}
                  {r.via && <span className="text-[11px] uppercase text-muted-foreground">{r.via}</span>}
                  <Badge variant={STATUS[r.status].variant} className="h-5 px-1.5 text-[10px]">
                    {r.status === "sent" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{STATUS[r.status].label}
                  </Badge>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </div>
  );
}
