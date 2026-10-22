"use client";

import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import type { Facility } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Check, CircuitBoard, Copy, KeyRound, Laptop, Loader2, TriangleAlert } from "lucide-react";

/**
 * Where the device runs. Stored as "wokwi" (simulated) or "mqtt" (physical,
 * kept for compatibility). Both talk to the app the same way: HTTPS for
 * status and events, MQTT over TLS for signed remote commands.
 */
export type Connection = "wokwi" | "mqtt";
export const DEVICE_KIND: Record<Connection, { short: string; title: string }> = {
  wokwi: { short: "Simulated", title: "Simulated (Wokwi)" },
  mqtt: { short: "Physical", title: "Physical (ESP32)" },
};
export interface SmartDevice {
  id: string; facility_id: string; label: string; active: boolean;
  last_seen_at: string | null; connection?: Connection | null;
}

/** A random device key (32 chars, URL-safe) and its SHA-256 in hex, made in the browser. */
async function newKey(): Promise<{ key: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  const key = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return { key, hash };
}

const KINDS: { id: Connection; text: string; Icon: typeof Laptop }[] = [
  { id: "wokwi", text: "The ESP32 door simulated in Wokwi (firmware/door-wokwi).", Icon: Laptop },
  { id: "mqtt", text: "A real ESP32 wired like the Wokwi circuit, running the same firmware.", Icon: CircuitBoard },
];

function CopyLine({ label, value }: { label: string; value: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="min-w-0 space-y-1">
      {label && <p className="text-xs font-medium text-muted-foreground">{label}</p>}
      <div className="flex min-w-0 items-start gap-2 rounded-md border bg-muted/40 py-1.5 pl-3 pr-1.5">
        {value.includes("\n")
          ? <pre className="min-w-0 flex-1 overflow-x-auto whitespace-pre py-1 font-mono text-[11px] leading-relaxed">{value}</pre>
          : <code className="min-w-0 flex-1 break-all py-1 font-mono text-[11px] leading-relaxed">{value}</code>}
        <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" aria-label={`Copy ${label}`}
          onClick={async () => { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); }}>
          {done ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  );
}

/**
 * Connect an existing room to a smart device, or give a connected room a new
 * key (`rekey`). The key is generated here, only its hash is saved, and it is
 * shown once together with what to paste into the sketch or device.
 */
export default function SmartRoomConnect({ open, onOpenChange, facilities, devices, rekey, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilities: Facility[];
  devices: SmartDevice[];
  rekey?: SmartDevice | null;
  onDone: () => Promise<void> | void;
}) {
  const [facilityId, setFacilityId] = useState("");
  const [kind, setKind] = useState<Connection>("wokwi");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ id: string; key: string; kind: Connection; room: string } | null>(null);

  const connected = new Set(devices.filter((d) => d.active).map((d) => d.facility_id));
  const choices = facilities.filter((f) => !connected.has(f.id));
  const targetId = rekey?.facility_id ?? facilityId;
  const targetKind: Connection = rekey ? (rekey.connection ?? "wokwi") : kind;

  function close(v: boolean) {
    if (!v) { setResult(null); setFacilityId(""); setKind("wokwi"); }
    onOpenChange(v);
  }

  async function connect() {
    const room = facilities.find((f) => f.id === targetId);
    if (!room) { toast.error("Pick a room first"); return; }
    setBusy(true);
    const { key, hash } = await newKey();
    const row = { facility_id: room.id, label: `${room.name} door`, key_hash: hash, active: true, connection: targetKind };
    let res = await supabase.from("room_devices").upsert(row, { onConflict: "facility_id" }).select("id").single();
    if (res.error && /connection/.test(res.error.message)) {
      // upgrade-room-connect.sql not run yet: save without the connection type
      const { connection: _omit, ...rest } = row; void _omit;
      res = await supabase.from("room_devices").upsert(rest, { onConflict: "facility_id" }).select("id").single();
    }
    setBusy(false);
    if (res.error || !res.data) { toast.error(res.error?.message ?? "Could not save the device"); return; }
    setResult({ id: res.data.id as string, key, kind: targetKind, room: room.name });
    toast.success(rekey ? `New key for ${room.name}` : `${room.name} connected`);
    await onDone();
  }

  // the device must reach the deployed site, never localhost
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const apiBase = /localhost|127\.0\.0\.1/.test(origin) || !origin
    ? (process.env.NEXT_PUBLIC_SITE_URL || "https://smart-campus-reservation.vercel.app")
    : origin;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl [&>*]:min-w-0">
        {!result ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{rekey ? `New key - ${rekey.label}` : "Connect a room"}</DialogTitle>
              <DialogDescription>
                {rekey
                  ? "The old key stops working straight away. Paste the new one into the device."
                  : "Pick an existing room and how its device connects. You get a device ID and key to paste into the device."}
              </DialogDescription>
            </DialogHeader>

            {!rekey && (
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Room</label>
                  <Select value={facilityId} onValueChange={setFacilityId}>
                    <SelectTrigger className="w-full"><SelectValue placeholder={choices.length ? "Choose a room" : "Every room is connected"} /></SelectTrigger>
                    <SelectContent>
                      {choices.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} - {f.category_name}, {f.venue}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Device</label>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {KINDS.map(({ id, text, Icon }) => (
                      <button key={id} type="button" onClick={() => setKind(id)}
                        className={`rounded-lg border p-3 text-left transition-colors ${kind === id ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted/50"}`}>
                        <span className="flex items-center gap-2 text-sm font-medium"><Icon className="h-4 w-4 text-primary" /> {DEVICE_KIND[id].title}</span>
                        <span className="block pt-1 text-xs text-muted-foreground">{text}</span>
                        <span className="mt-2 inline-block rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">HTTPS + MQTT</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <DialogFooter>
              <Button variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button onClick={connect} disabled={busy || !targetId} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {rekey ? "Generate new key" : "Connect"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{result.room} is ready to connect</DialogTitle>
              <DialogDescription>
                Follow these steps on the {result.kind === "wokwi" ? "Wokwi project" : "ESP32"}. The room shows Online within about 10 seconds.
              </DialogDescription>
            </DialogHeader>
            <p className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              The key is shown only now. Copy it before closing; you can generate a new one later.
            </p>
            <ol className="space-y-4">
              {[
                {
                  title: result.kind === "wokwi" ? "Make a copy of the Wokwi project" : "Wire the ESP32 and open the firmware",
                  body: result.kind === "wokwi"
                    ? <>Copy the <code className="font-mono">firmware/door-wokwi</code> folder (one copy per room) and open it in VS Code.</>
                    : <>Wire the board like <code className="font-mono">diagram.json</code> and open <code className="font-mono">firmware/door-wokwi</code> in VS Code (PlatformIO).</>,
                },
                {
                  title: "Paste the device ID and key",
                  body: <>In <code className="font-mono">sketch.ino</code>, replace the <code className="font-mono">DEVICE_ID</code> and <code className="font-mono">DEVICE_KEY</code> lines with:</>,
                  copy: `const char *DEVICE_ID  = "${result.id}";\nconst char *DEVICE_KEY = "${result.key}";`,
                },
                {
                  title: "Check the server and network",
                  body: result.kind === "wokwi"
                    ? <><code className="font-mono">API_BASE</code> must be the live site below. Wi-Fi stays <code className="font-mono">Wokwi-GUEST</code>, and the MQTT settings stay as they are.</>
                    : <>Set <code className="font-mono">API_BASE</code> to the live site below and <code className="font-mono">WIFI_SSID</code> / <code className="font-mono">WIFI_PASS</code> to the real network. The MQTT settings stay as they are.</>,
                  copy: `const char *API_BASE   = "${apiBase}";`,
                },
                {
                  title: result.kind === "wokwi" ? "Build and start the simulation" : "Build and flash the board",
                  body: <>This room turns <b>Online</b> in Admin → Smart room. Then book it as a student and enter the door code on the keypad.</>,
                },
              ].map((st, i) => (
                <li key={i} className="flex min-w-0 gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{i + 1}</span>
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-sm font-medium">{st.title}</p>
                    <p className="text-xs leading-relaxed text-muted-foreground">{st.body}</p>
                    {st.copy && <CopyLine label="" value={st.copy} />}
                  </div>
                </li>
              ))}
            </ol>
            <details className="rounded-md border px-3 py-2 text-xs">
              <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                Technical details (for other firmware)
              </summary>
              <div className="space-y-3 pt-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <CopyLine label="Device ID" value={result.id} />
                  <CopyLine label="Device key" value={result.key} />
                </div>
                <CopyLine label="Status (HTTPS GET every 5 s, header x-device-key)" value={`${apiBase}/api/room/status?device_id=${result.id}`} />
                <CopyLine label="Commands (MQTT subscribe, signed)" value={`campus/rooms/${result.id}/cmd`} />
              </div>
            </details>
            <DialogFooter>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
