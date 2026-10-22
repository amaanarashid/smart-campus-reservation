"use client";

import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  DoorOpen, Lightbulb, Loader2, Lock, LockOpen, MessageSquareText, Radio, Send, Snowflake,
} from "lucide-react";
import {
  DEFAULT_OVERRIDE_MINS, MAX_MESSAGE_CHARS, describeCommand,
  type CommandKind, type OverrideState,
} from "@/lib/room-commands-shared";
import { fmtTime } from "@/lib/time";

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

/**
 * Remote control for one smart room, next to its 3D twin: unlock, lights and
 * air-con overrides, a door-screen message, lockdown. Admins and the room's
 * managers only (the API checks). Shows each command until the room confirms it.
 */
export default function RoomControls({ facilityId }: { facilityId: string }) {
  const [rows, setRows] = useState<CommandRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [mins, setMins] = useState(DEFAULT_OVERRIDE_MINS);
  const [text, setText] = useState("");
  const [lastDelivery, setLastDelivery] = useState<"mqtt" | "http" | null>(null);
  const [missing, setMissing] = useState(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.from("room_commands")
      .select("id, kind, args, status, via, issued_at, done_at, result")
      .eq("facility_id", facilityId).order("issued_at", { ascending: false }).limit(8);
    if (error) { setMissing(/room_commands/.test(error.message)); return; }
    setMissing(false);
    setRows((data as CommandRow[]) ?? []);
  }, [facilityId]);

  useEffect(() => {
    const first = setTimeout(load, 0);
    const t = setInterval(load, 8000);       // backup; Realtime below is the fast path
    // "waiting for room" turns into "done" the moment the device confirms
    const channel = supabase.channel(`room-commands-${facilityId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "room_commands", filter: `facility_id=eq.${facilityId}` }, () => { load(); })
      .subscribe();
    return () => { clearTimeout(first); clearInterval(t); supabase.removeChannel(channel); };
  }, [load, facilityId]);

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
      if (kind === "message") setText("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  // current lockdown state = the latest lockdown command that was not dropped
  const lastLock = rows.find((r) => r.kind === "lockdown" && (r.status === "done" || r.status === "sent"));
  const lockedDown = !!lastLock?.args?.on;

  const override = (kind: "lights" | "ac", label: string, Icon: typeof Lightbulb) => (
    <div className="flex flex-wrap items-center gap-2">
      <span className="flex w-20 items-center gap-1.5 text-sm font-medium"><Icon className="h-4 w-4 text-primary" />{label}</span>
      {(["on", "off", "auto"] as OverrideState[]).map((st) => (
        <Button key={st} size="sm" variant={st === "auto" ? "ghost" : "outline"} className="h-8 min-w-14 capitalize"
          disabled={!!busy} onClick={() => send(kind, { state: st, mins }, `${kind}-${st}`)}>
          {busy === `${kind}-${st}` ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : st}
        </Button>
      ))}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="font-display flex items-center gap-2"><Radio className="h-5 w-5 text-primary" /> Remote control</CardTitle>
            <CardDescription>Signed commands to the room over MQTT; every action is logged</CardDescription>
          </div>
          {lastDelivery && (
            <Badge variant={lastDelivery === "mqtt" ? "default" : "secondary"}>
              {lastDelivery === "mqtt" ? "via MQTT - instant" : "via HTTP fallback - up to 5 s"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {missing ? (
          <p className="text-sm text-muted-foreground">Remote control is not set up yet - run supabase/upgrade-room-commands.sql.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="gap-1.5" disabled={!!busy} onClick={() => send("unlock", { secs: 8 }, "unlock")}>
                {busy === "unlock" ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />} Unlock door (8 s)
              </Button>
              <Button size="sm" variant={lockedDown ? "default" : "outline"}
                className={`gap-1.5 ${lockedDown ? "" : "text-destructive"}`} disabled={!!busy}
                onClick={() => send("lockdown", { on: !lockedDown }, "lockdown")}>
                {busy === "lockdown" ? <Loader2 className="h-4 w-4 animate-spin" /> : lockedDown ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                {lockedDown ? "Lift lockdown" : "Lock down keypad"}
              </Button>
            </div>

            <div className="space-y-2 rounded-xl border bg-muted/30 p-3">
              <div className="flex flex-wrap items-center gap-2 pb-1 text-xs text-muted-foreground">
                Override for
                {DURATIONS.map((d) => (
                  <button key={d} onClick={() => setMins(d)}
                    className={`rounded-full border px-2.5 py-0.5 transition-colors ${mins === d ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    {d} min
                  </button>
                ))}
                <span>then back to automatic</span>
              </div>
              {override("lights", "Lights", Lightbulb)}
              {override("ac", "Air-con", Snowflake)}
            </div>

            <div className="flex gap-2">
              <div className="relative flex-1">
                <MessageSquareText className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input className="pl-8" maxLength={MAX_MESSAGE_CHARS} value={text} placeholder="Message on the door screen"
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) send("message", { text, secs: 300 }, "message"); }} />
              </div>
              <Button size="sm" className="h-9 gap-1.5" disabled={!!busy || !text.trim()} onClick={() => send("message", { text, secs: 300 }, "message")}>
                {busy === "message" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Show 5 min
              </Button>
            </div>

            {rows.length > 0 && (
              <ol className="space-y-1.5 border-t pt-3">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="text-xs tabular-nums text-muted-foreground">{fmtTime(new Date(r.issued_at))}</span>
                    <span className="min-w-0 flex-1 truncate">{describeCommand(r.kind, r.args)}</span>
                    {r.result?.warned_occupants === true && <span className="text-xs text-muted-foreground">people warned first</span>}
                    {r.via && <span className="text-[11px] uppercase text-muted-foreground">{r.via}</span>}
                    <Badge variant={STATUS[r.status].variant} className="h-5 px-1.5 text-[10px]">
                      {r.status === "sent" && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}{STATUS[r.status].label}
                    </Badge>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
