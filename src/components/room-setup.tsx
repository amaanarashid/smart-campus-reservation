"use client";

import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import {
  BOARDS, checkConfig, defaultConfig, isBoard, parseConfig, partProblems, type Board, type DeviceReport, type RoomConfig,
} from "@/lib/room-config";
import PartsEditor from "@/components/parts-editor";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CircleAlert, Cpu, Ear, Loader2, RotateCcw, Save } from "lucide-react";

export interface SetupDevice {
  id: string; facility_id: string; board?: string | null; config?: unknown; config_version?: number | null;
  report?: unknown; reported_at?: string | null;
}

/**
 * Admin -> Smart room -> a room: what is wired to its device. The device
 * reports what it found; the admin switches parts on or off, sets pins, picks
 * or learns the air-con make, and saves. The device fetches the new setup on
 * its next status poll and restarts with it (src/lib/room-config.ts).
 */
export default function RoomSetup({ device, onSaved }: { device: SetupDevice; onSaved: () => void }) {
  const report = (device.report ?? null) as DeviceReport | null;
  const board: Board = isBoard(device.board) ? device.board : isBoard(report?.board) ? report!.board : "wokwi-door";
  const saved = parseConfig(device.config) ?? defaultConfig(board);
  const [draft, setDraft] = useState<RoomConfig>(saved);
  const [busy, setBusy] = useState<"save" | "learn" | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const check = checkConfig(board, draft);
  const problems = partProblems(saved, report);
  const running = report?.config_version;

  async function save() {
    setBusy("save");
    const { error } = await supabase.rpc("set_room_config", { p_device: device.id, p_config: draft });
    setBusy(null);
    if (error) {
      toast.error(/set_room_config/.test(error.message) ? "Run supabase/upgrade-room-config.sql first" : error.message);
      return;
    }
    toast.success("Saved. The device picks up the new setup within a few seconds and restarts with it.");
    onSaved();
  }

  async function learn(slot: "on" | "off") {
    setBusy("learn");
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch("/api/room/command", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
        body: JSON.stringify({ facility_id: device.facility_id, kind: "ir_learn", args: { slot, secs: 30 } }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) { toast.error(j.error ?? "Could not start learning"); return; }
      toast.success(`Listening for 30 s: point the air-con's remote at the device and press ${slot === "off" ? "OFF" : "ON"}.`, { duration: 10_000 });
    } finally {
      setBusy(null);
    }
  }

  const irReport = report?.ir;
  const learnButtons = saved.ac?.type === "ir" && saved.ac.rx !== undefined && !dirty && (
    <span className="flex flex-wrap items-center gap-1.5">
      <Button type="button" size="sm" variant="outline" className="h-7 gap-1 text-xs" disabled={!!busy} onClick={() => learn("on")}>
        {busy === "learn" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ear className="h-3.5 w-3.5" />} Learn from its remote
      </Button>
      {irReport?.raw_on && !irReport.raw_off && (
        <Button type="button" size="sm" variant="outline" className="h-7 text-xs" disabled={!!busy} onClick={() => learn("off")}>
          Unknown make: now record OFF
        </Button>
      )}
    </span>
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="font-display flex items-center gap-2"><Cpu className="h-5 w-5 text-primary" /> Room setup</CardTitle>
            <CardDescription>What is wired to this room&apos;s device. The app only shows what the room has.</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            <Badge variant="secondary">{BOARDS[board].label}</Badge>
            {report?.firmware && <Badge variant="outline">firmware {report.firmware}</Badge>}
            {device.config_version != null && (
              <Badge variant={running && running !== device.config_version ? "secondary" : "outline"}>
                {running && running !== device.config_version ? `updating to setup ${device.config_version}` : `setup ${device.config_version}`}
              </Badge>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {problems.length > 0 && (
          <ul className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
            {problems.map((p) => <li key={p} className="flex gap-2"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />{p}</li>)}
          </ul>
        )}
        {!report && (
          <p className="text-sm text-muted-foreground">
            The device has not reported yet. Devices with firmware 2.0 or later say what they found when they start.
          </p>
        )}

        <PartsEditor board={board} value={draft} onChange={setDraft} fallback={saved}
          report={dirty ? null : report} acExtra={learnButtons} showWiring={board !== "wokwi-door"} />

        <div className="flex flex-wrap items-center justify-end gap-2">
          {dirty && <span className="mr-auto text-xs text-muted-foreground">Not saved yet. Saving restarts the device.</span>}
          <Button variant="ghost" size="sm" className="gap-1.5" disabled={!dirty || !!busy} onClick={() => setDraft(saved)}>
            <RotateCcw className="h-4 w-4" /> Undo changes
          </Button>
          <Button size="sm" className="gap-1.5" disabled={!dirty || check.errors.length > 0 || !!busy} onClick={save}>
            {busy === "save" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save setup
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
