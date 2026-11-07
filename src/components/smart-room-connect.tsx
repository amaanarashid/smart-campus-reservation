"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { cleanCode, formatCode } from "@/lib/room-pairing";
import {
  BOARDS, checkConfig, isBoard, kitConfig, kitsFor, parseConfig, type Board, type RoomConfig,
} from "@/lib/room-config";
import { readPairCode, usbSupported } from "@/lib/usb-pair-code";
import type { Facility } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ArrowLeft, ArrowRight, Camera, CheckCircle2, CircuitBoard, Download, KeyRound, Laptop, Loader2, TriangleAlert, Usb, Wand2 } from "lucide-react";
import FirmwareInstallButton from "@/components/firmware-install-button";
import PartsEditor from "@/components/parts-editor";

/**
 * What the device is. It says so itself when it pairs. Stored as "wokwi"
 * (simulated) or "mqtt" (physical, kept for compatibility). Both talk to the
 * app the same way: HTTPS for status and events, MQTT over TLS for signed
 * remote commands. The board (DevKit, ESP32-CAM, Wokwi) is stored separately.
 */
export type Connection = "wokwi" | "mqtt";
export const DEVICE_KIND: Record<Connection, { short: string; title: string }> = {
  wokwi: { short: "Simulated", title: "Simulated (Wokwi)" },
  mqtt: { short: "Physical", title: "Physical (ESP32)" },
};
export interface SmartDevice {
  id: string; facility_id: string; label: string; active: boolean;
  last_seen_at: string | null; connection?: Connection | null;
  board?: string | null; config?: unknown; config_version?: number | null;
}

/** How long to wait for the device to report in before saying so. */
const ONLINE_WAIT_MS = 60_000;
const BOARD_CHOICES: { board: Board; title: string; blurb: string; Icon: typeof Laptop }[] = [
  { board: "wokwi-door", title: "Wokwi simulation", blurb: "Runs in VS Code. A zip with the circuit drawn for the parts you pick.", Icon: Laptop },
  { board: "esp32-devkit", title: "ESP32 DevKit", blurb: "A real board. Installed from this browser over USB.", Icon: CircuitBoard },
  { board: "esp32-cam", title: "ESP32-CAM", blurb: "A real board with few free pins: a room controller (lights, IR air-con).", Icon: Camera },
];

type Step = "start" | "parts" | "get" | "code" | "codeParts";
const fits = (c: RoomConfig) => JSON.stringify(c).length <= 1024;

/**
 * Connect a room, or put a different device on a connected room (`replacing`).
 *
 * Main path: pick the board and the parts, then get firmware made for this
 * room: a Wokwi zip (firmware + a circuit with just those parts) or a browser
 * install for a real board. The firmware already holds the room's key and
 * setup, so the device comes up connected with no code to type.
 *
 * Other path ("I have a code"): a device running the plain firmware shows a
 * 6-digit code (screen or USB); type it, pick its parts, connect.
 */
export default function SmartRoomConnect({ open, onOpenChange, facilities, devices, replacing, onDone }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilities: Facility[];
  devices: SmartDevice[];
  replacing?: SmartDevice | null;
  onDone: () => Promise<void> | void;
}) {
  const [step, setStep] = useState<Step>("start");
  const [facilityId, setFacilityId] = useState("");
  const [board, setBoard] = useState<Board>("wokwi-door");
  const [setup, setSetup] = useState<RoomConfig>({});
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<null | "next" | "connect" | "usb" | "make">(null);
  const [link, setLink] = useState<{ manifest: string; expires: string } | null>(null);
  const [waiting, setWaiting] = useState<{ facilityId: string; room: string; since: number; sim: boolean } | null>(null);
  const [state, setState] = useState<"waiting" | "online" | "late">("waiting");

  const connected = new Set(devices.filter((d) => d.active).map((d) => d.facility_id));
  const choices = facilities.filter((f) => !connected.has(f.id));
  const targetId = replacing?.facility_id ?? facilityId;
  const room = facilities.find((f) => f.id === targetId);
  const check = checkConfig(board, setup);
  const ready = check.errors.length === 0 && fits(setup) && Object.keys(setup).length > 0;

  // after connecting, watch until the device reports in
  const waitingFor = waiting?.facilityId;
  useEffect(() => {
    if (!waitingFor || !waiting) return;
    const since = waiting.since;
    const timer = setInterval(async () => {
      const { data } = await supabase.from("room_devices_visible")
        .select("last_seen_at").eq("facility_id", waitingFor).maybeSingle();
      if (data?.last_seen_at && new Date(data.last_seen_at).getTime() > since - 5000) {
        clearInterval(timer);
        setState("online");
        await onDone();
      } else if (Date.now() - since > ONLINE_WAIT_MS) {
        setState("late");
      }
    }, 2000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only for a new wait
  }, [waitingFor]);

  function close(v: boolean) {
    if (!v) {
      setWaiting(null); setState("waiting"); setFacilityId(""); setCode(""); setStep("start"); setLink(null); setSetup({});
    }
    onOpenChange(v);
  }

  /** Start from the room's current setup if it is the same board, else the board's first kit. */
  function startParts(b: Board) {
    setBoard(b);
    const keep = replacing && replacing.board === b ? parseConfig(replacing.config) : null;
    setSetup(keep ?? kitConfig(kitsFor(b)[0]?.id ?? "door", b) ?? {});
    setLink(null);
    setStep("parts");
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const { data: { session } } = await supabase.auth.getSession();
    return { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) };
  }

  async function downloadSim() {
    if (!room) return;
    setBusy("make");
    const since = Date.now();
    try {
      const res = await fetch("/api/room/wokwi", {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ facility_id: room.id, config: setup }),
      });
      if (!res.ok) { toast.error((await res.json().catch(() => ({}))).error ?? "Could not make the simulation"); return; }
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? "campus-room.zip";
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      setWaiting({ facilityId: room.id, room: room.name, since, sim: true });
      await onDone();
    } finally {
      setBusy(null);
    }
  }

  async function makeInstallLink() {
    if (!room) return;
    setBusy("make");
    try {
      const res = await fetch("/api/room/firmware", {
        method: "POST", headers: await authHeaders(), body: JSON.stringify({ facility_id: room.id, board, config: setup }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { toast.error(j.error ?? "Could not make the firmware"); return; }
      setLink({ manifest: j.manifest, expires: j.expires_at });
      await onDone();
    } finally {
      setBusy(null);
    }
  }

  async function readUsb() {
    setBusy("usb");
    try {
      const c = await readPairCode();
      setCode(c);
      toast.success(`Code ${formatCode(c)} read from the device`);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "NotFoundError"))   // NotFoundError = no port picked
        toast.error(e instanceof Error ? e.message : "Could not read the code");
    } finally {
      setBusy(null);
    }
  }

  // "I have a code": which board is showing it?
  async function peekCode() {
    if (!room) { toast.error("Pick a room first"); return; }
    setBusy("next");
    const { data, error } = await supabase.rpc("peek_room_pairing", { p_code: code });
    setBusy(null);
    if (error && /peek_room_pairing/.test(error.message)) { await claim(null); return; }   // before upgrade-room-config.sql
    if (error || !data) { toast.error(error?.message ?? "That code was not found"); return; }
    const b: Board = isBoard(data.board) ? data.board : "wokwi-door";
    setBoard(b);
    const keep = replacing && replacing.board === b ? parseConfig(replacing.config) : null;
    setSetup(keep ?? kitConfig(kitsFor(b)[0]?.id ?? "door", b) ?? {});
    setStep("codeParts");
  }

  async function claim(config: RoomConfig | null) {
    if (!room) return;
    setBusy("connect");
    const since = Date.now();
    let { data, error } = await supabase.rpc("claim_room_pairing", { p_code: code, p_facility: room.id, p_config: config });
    if (error && /claim_room_pairing/.test(error.message) && config === null)
      ({ data, error } = await supabase.rpc("claim_room_pairing", { p_code: code, p_facility: room.id }));
    setBusy(null);
    if (error || !data) {
      toast.error(/claim_room_pairing/.test(error?.message ?? "") ? "Run supabase/upgrade-room-config.sql first" : error?.message ?? "Could not connect the room");
      return;
    }
    setWaiting({ facilityId: room.id, room: room.name, since, sim: false });
    await onDone();
  }

  const replacesDevice = !!replacing || (!!room && connected.has(room.id));
  const roomPicker = !replacing && (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">Room</label>
      <Select value={facilityId} onValueChange={setFacilityId}>
        <SelectTrigger className="w-full" aria-label="Room"><SelectValue placeholder={choices.length ? "Choose a room" : "Every room is connected"} /></SelectTrigger>
        <SelectContent>
          {choices.map((f) => <SelectItem key={f.id} value={f.id}>{f.name} - {f.category_name}, {f.venue}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
  const title = replacing ? `Replace device - ${replacing.label}` : "Connect a room";
  const back = (to: Step) => (
    <Button type="button" variant="outline" className="gap-1.5" onClick={() => setStep(to)}><ArrowLeft className="h-4 w-4" /> Back</Button>
  );

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl [&>*]:min-w-0">
        {waiting ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{state === "online" ? `${waiting.room} is online` : `Connecting ${waiting.room}`}</DialogTitle>
              <DialogDescription>
                {state === "online" ? "The device is connected and running the room's setup."
                  : waiting.sim ? "Unzip the download, open the folder in VS Code and start the Wokwi simulator. This page notices when it comes online."
                    : "The code is accepted. The device picks this up by itself within a few seconds."}
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col items-center gap-2 py-4 text-center" aria-live="polite">
              {state === "online" && <CheckCircle2 className="h-10 w-10 text-green-600 dark:text-green-500" />}
              {state === "waiting" && <Loader2 className="h-10 w-10 animate-spin text-primary" />}
              {state === "late" && (
                <>
                  <TriangleAlert className="h-10 w-10 text-muted-foreground" />
                  <p className="text-sm text-muted-foreground">The device has not reported in yet. Check it is running and has internet. The room stays connected, so you can close this.</p>
                </>
              )}
            </div>
            <DialogFooter><Button onClick={() => close(false)}>{state === "online" ? "Done" : "Close"}</Button></DialogFooter>
          </>
        ) : step === "parts" ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">What is wired to the {BOARDS[board].label}?</DialogTitle>
              <DialogDescription>
                {room?.name}: tick the parts and pick their pins. The firmware is made with exactly this setup. You can change it later in Room setup.
              </DialogDescription>
            </DialogHeader>
            <PartsEditor board={board} value={setup} onChange={setSetup} showWiring={board !== "wokwi-door"} />
            {!fits(setup) && <p className="text-xs text-destructive">This setup is too large to put in the firmware.</p>}
            <DialogFooter>
              {back("start")}
              <Button disabled={!ready} className="gap-1.5" onClick={() => setStep("get")}>Next <ArrowRight className="h-4 w-4" /></Button>
            </DialogFooter>
          </>
        ) : step === "get" ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{board === "wokwi-door" ? "Download the simulation" : `Install on the ${BOARDS[board].label}`}</DialogTitle>
              <DialogDescription>
                Firmware made for {room?.name}, with its key and the {Object.keys(setup).length} part{Object.keys(setup).length === 1 ? "" : "s"} you picked.
                {replacesDevice && " The room's current device stops working once you do this."}
              </DialogDescription>
            </DialogHeader>
            {board === "wokwi-door" ? (
              <div className="space-y-2 rounded-md border bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">
                <p>You get a zip with the firmware and a circuit drawn for these parts. In VS Code with the <b className="text-foreground">Wokwi Simulator</b> extension: open the folder, press F1, run <b className="text-foreground">Wokwi: Start Simulator</b>. Nothing to build, no code to type.</p>
                <p>The zip holds the device&apos;s key, so keep it to yourself. Downloading again replaces the key.</p>
              </div>
            ) : !link ? (
              <p className="text-sm text-muted-foreground">
                This connects the room to a new device key and makes an install link for this browser, valid for 15 minutes.
              </p>
            ) : (
              <ol className="list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                <li>Plug the board into this computer with USB{board === "esp32-cam" ? " (through its ESP32-CAM-MB board)" : ""}.</li>
                <li className="space-y-1.5">
                  <span>Install, and pick the board&apos;s port. Choose to erase the board when asked if it ran other firmware before.</span>
                  <FirmwareInstallButton manifest={link.manifest} onStart={() => {
                    close(false);
                    toast("Pick the board's USB port", { description: `After installing, set its Wi-Fi. ${room?.name ?? "The room"} shows Online in Smart room once it is up.`, duration: 12_000 });
                  }} />
                </li>
                <li>On a phone, join the <code className="font-mono">CampusRoom-Setup</code> Wi-Fi and choose the room&apos;s network. It connects to {room?.name} by itself.</li>
              </ol>
            )}
            <DialogFooter>
              {back("parts")}
              {board === "wokwi-door" ? (
                <Button disabled={!!busy} className="gap-2" onClick={downloadSim}>
                  {busy === "make" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download simulation
                </Button>
              ) : !link && (
                <Button disabled={!!busy} className="gap-2" onClick={makeInstallLink}>
                  {busy === "make" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />} Make firmware for {room?.name}
                </Button>
              )}
            </DialogFooter>
          </>
        ) : step === "code" ? (
          <form className="contents" onSubmit={(e) => { e.preventDefault(); if (targetId && code.length === 6) peekCode(); }}>
            <DialogHeader>
              <DialogTitle className="font-display">{title}: device with a code</DialogTitle>
              <DialogDescription>A device running the plain firmware shows a 6-digit code on its screen, or sends it over USB.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {roomPicker}
              <div className="space-y-1.5">
                <label htmlFor="pair-code" className="text-xs font-medium">Code from the device</label>
                <div className="flex gap-2">
                  <Input id="pair-code" value={formatCode(code)} onChange={(e) => setCode(cleanCode(e.target.value))}
                    inputMode="numeric" autoComplete="off" placeholder="000 000" className="h-12 flex-1 text-center font-mono text-2xl tracking-widest" />
                  {usbSupported() && (
                    <Button type="button" variant="outline" className="h-12 gap-1.5" disabled={!!busy} onClick={readUsb} title="For a board without a screen, plugged into this computer">
                      {busy === "usb" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Usb className="h-4 w-4" />} Read over USB
                    </Button>
                  )}
                </div>
              </div>
              <p className="text-xs text-muted-foreground">A device already connected to a room shows no code. Disconnect it from that room first.</p>
            </div>
            <DialogFooter>
              {back("start")}
              <Button type="submit" disabled={!!busy || !targetId || code.length !== 6} className="gap-2">
                {busy === "next" || busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} Next
              </Button>
            </DialogFooter>
          </form>
        ) : step === "codeParts" ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">What is wired to this {BOARDS[board].label}?</DialogTitle>
              <DialogDescription>{room?.name}: tick the parts and pick their pins. You can change them later in Room setup.</DialogDescription>
            </DialogHeader>
            <PartsEditor board={board} value={setup} onChange={setSetup} showWiring={board !== "wokwi-door"} />
            <DialogFooter>
              {back("code")}
              <Button disabled={!!busy || check.errors.length > 0} className="gap-2" onClick={() => claim(setup)}>
                {busy === "connect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />} {replacing ? "Replace" : "Connect"}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display">{title}</DialogTitle>
              <DialogDescription>Pick the board, then the parts wired to it. You get firmware made for this room: it comes up connected, with no code to type.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {roomPicker}
              <div className="grid gap-2 sm:grid-cols-3" aria-label="Board">
                {BOARD_CHOICES.map(({ board: b, title: t, blurb, Icon }) => (
                  <button key={b} type="button" disabled={!targetId} onClick={() => startParts(b)}
                    className="flex flex-col gap-1.5 rounded-lg border p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 disabled:pointer-events-none disabled:opacity-50">
                    <Icon className="h-5 w-5 text-primary" />
                    <span className="text-sm font-medium">{t}</span>
                    <span className="text-xs text-muted-foreground">{blurb}</span>
                  </button>
                ))}
              </div>
              {!targetId && <p className="text-xs text-muted-foreground">Choose the room first.</p>}
              <button type="button" onClick={() => setStep("code")} className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                Already have a device showing a code?
              </button>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => close(false)}>Cancel</Button></DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
