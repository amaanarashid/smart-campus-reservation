"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cleanCode, formatCode } from "@/lib/room-pairing";
import type { Facility } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { CheckCircle2, KeyRound, Loader2, TriangleAlert } from "lucide-react";

/**
 * What the device is. It says so itself when it pairs. Stored as "wokwi"
 * (simulated) or "mqtt" (physical, kept for compatibility). Both talk to the
 * app the same way: HTTPS for status and events, MQTT over TLS for signed
 * remote commands.
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

/** How long to wait for the door to report in before saying so. */
const ONLINE_WAIT_MS = 45_000;

/**
 * Connect a room, or put a different device on a connected room (`replacing`).
 * The door shows a 6-digit code on its screen; an admin picks the room and types
 * the code. The door then finds out for itself, within a few seconds.
 */
export default function SmartRoomConnect({ open, onOpenChange, facilities, devices, replacing, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilities: Facility[];
  devices: SmartDevice[];
  replacing?: SmartDevice | null;
  onDone: () => Promise<void> | void;
}) {
  const [facilityId, setFacilityId] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [waiting, setWaiting] = useState<{ id: string; room: string } | null>(null);
  const [state, setState] = useState<"waiting" | "online" | "late">("waiting");

  const connected = new Set(devices.filter((d) => d.active).map((d) => d.facility_id));
  const choices = facilities.filter((f) => !connected.has(f.id));
  const targetId = replacing?.facility_id ?? facilityId;

  // after connecting, watch until the door reports in
  const waitingId = waiting?.id;
  useEffect(() => {
    if (!waitingId) return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      const { data } = await supabase.from("room_devices_visible")
        .select("last_seen_at").eq("id", waitingId).maybeSingle();
      if (data?.last_seen_at) {
        clearInterval(timer);
        setState("online");
        await onDone();
      } else if (Date.now() - startedAt > ONLINE_WAIT_MS) {
        setState("late");
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only for a new device
  }, [waitingId]);

  function close(v: boolean) {
    if (!v) { setWaiting(null); setState("waiting"); setFacilityId(""); setCode(""); }
    onOpenChange(v);
  }

  async function connect() {
    const room = facilities.find((f) => f.id === targetId);
    if (!room) { toast.error("Pick a room first"); return; }
    setBusy(true);
    const { data, error } = await supabase.rpc("claim_room_pairing", { p_code: code, p_facility: room.id });
    setBusy(false);
    if (error || !data) {
      toast.error(/claim_room_pairing/.test(error?.message ?? "")
        ? "Run supabase/upgrade-room-pairing.sql first"
        : error?.message ?? "Could not connect the room");
      return;
    }
    setWaiting({ id: data as string, room: room.name });
    await onDone();
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-md [&>*]:min-w-0">
        {!waiting ? (
          <form className="contents" onSubmit={(e) => { e.preventDefault(); if (targetId && code.length === 6) connect(); }}>
            <DialogHeader>
              <DialogTitle className="font-display">{replacing ? `Replace device - ${replacing.label}` : "Connect a room"}</DialogTitle>
              <DialogDescription>
                {replacing
                  ? "Turn on the new door device and type the code on its screen. The old device stops working straight away."
                  : "Turn on the door device. It shows a 6-digit code on its screen."}
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              {!replacing && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Room</label>
                  <Select value={facilityId} onValueChange={setFacilityId}>
                    <SelectTrigger className="w-full" aria-label="Room"><SelectValue placeholder={choices.length ? "Choose a room" : "Every room is connected"} /></SelectTrigger>
                    <SelectContent>
                      {choices.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} - {f.category_name}, {f.venue}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-1.5">
                <label htmlFor="pair-code" className="text-xs font-medium">Code on the door screen</label>
                <Input id="pair-code" value={formatCode(code)} onChange={(e) => setCode(cleanCode(e.target.value))}
                  inputMode="numeric" autoComplete="off" placeholder="000 000"
                  className="h-12 text-center font-mono text-2xl tracking-widest" />
              </div>
              <details className="rounded-md border px-3 py-2 text-xs">
                <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">
                  No code on the screen?
                </summary>
                <ul className="list-disc space-y-1.5 pl-4 pt-2 leading-relaxed text-muted-foreground">
                  <li><b className="text-foreground">Simulated:</b> open <code className="font-mono">firmware/door-wokwi</code> in VS Code, build it, then start the Wokwi simulator.</li>
                  <li><b className="text-foreground">Real ESP32:</b> install the firmware once with <code className="font-mono">pio run -e board -t upload</code>. On first start, join the <code className="font-mono">CampusRoom-Setup</code> Wi-Fi on a phone and choose the network.</li>
                  <li>A device already connected to a room shows no code. Disconnect it from that room first.</li>
                </ul>
              </details>
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !targetId || code.length !== 6} className="gap-2">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
                {replacing ? "Replace" : "Connect"}
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">
                {state === "online" ? `${waiting.room} is online` : `Connecting ${waiting.room}`}
              </DialogTitle>
              <DialogDescription>
                {state === "online"
                  ? "The door is connected and ready. Book the room as a student, then enter the door code on the keypad."
                  : "The code is accepted. The door picks this up by itself within a few seconds."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-2 py-4 text-center" aria-live="polite">
              {state === "online" && <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-500" />}
              {state === "waiting" && <Loader2 className="h-10 w-10 animate-spin text-primary" />}
              {state === "late" && (
                <>
                  <TriangleAlert className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">
                    The door has not reported in yet. Check it is still on and has internet. The room stays connected, so you can close this.
                  </p>
                </>
              )}
            </div>
            <DialogFooter>
              <Button onClick={() => close(false)}>{state === "online" ? "Done" : "Close"}</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
