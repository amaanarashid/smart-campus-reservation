"use client";

import type { ReactNode } from "react";
import {
  AC_FANS, AC_MODES, BOARDS, IR_PROTOCOLS, PART_LABEL, checkConfig, defaultPart, kitConfig, kitsFor, pinUses,
  type Board, type DeviceReport, type Part, type RoomConfig,
} from "@/lib/room-config";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CircleAlert, TriangleAlert } from "lucide-react";

export const PARTS: Part[] = ["lock", "keypad", "display", "leds", "buzzer", "presence", "lights", "ac", "temperature", "ring", "status_led"];

/** The pin fields of each part, as [path in the part, label]. Keypad pins are listed in order. */
const FIELDS: Partial<Record<Part, [string, string][]>> = {
  lock: [["servo", "Servo"], ["door", "Door switch"]],
  keypad: [["rows.0", "R1"], ["rows.1", "R2"], ["rows.2", "R3"], ["rows.3", "R4"], ["cols.0", "C1"], ["cols.1", "C2"], ["cols.2", "C3"], ["cols.3", "C4"]],
  display: [["sda", "SDA"], ["scl", "SCL"]],
  leds: [["ok", "Green"], ["no", "Red"]],
  buzzer: [["pin", "Pin"]],
  presence: [["pir", "PIR"]],
  lights: [["pin", "Pin"]],
  temperature: [["pin", "DHT22"]],
  ring: [["pin", "Data"]],
  status_led: [["pin", "Pin"]],
};

const STATE_BADGE: Record<string, { text: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
  ok: { text: "working", variant: "default" },
  missing: { text: "not found", variant: "destructive" },
  bad_pins: { text: "pins refused", variant: "destructive" },
};

type PartObj = Record<string, unknown>;
const getAt = (o: PartObj, path: string): unknown =>
  path.split(".").reduce<unknown>((v, k) => (v && typeof v === "object" ? (v as PartObj)[k] : undefined), o);
function setAt(o: PartObj, path: string, value: unknown): PartObj {
  const [k, ...rest] = path.split(".");
  if (!rest.length) return { ...o, [k]: value };
  const child = o[k];
  const next = setAt((Array.isArray(child) ? { ...child } : { ...(child as PartObj) }) as PartObj, rest.join("."), value);
  return { ...o, [k]: Array.isArray(child) ? Object.assign([...child], next) : next };
}

/**
 * Which parts a room's device has and on which pins: a tick per part, a pin
 * picker per wire, the air-con type and make, and the checks from
 * room-config.ts underneath. Used by Connect a room (before the firmware is
 * made) and by Room setup (after). `report` adds what the device found.
 */
export default function PartsEditor({ board, value, onChange, fallback, report, acExtra, showWiring }: {
  board: Board;
  value: RoomConfig;
  onChange: (c: RoomConfig) => void;
  /** pins to use when a part is switched back on (e.g. the saved setup) */
  fallback?: RoomConfig;
  report?: DeviceReport | null;
  /** extra controls at the end of the air-con row (Room setup: Learn) */
  acExtra?: ReactNode;
  /** a "what goes where" list, for wiring a real board */
  showWiring?: boolean;
}) {
  const pins = BOARDS[board].pins;
  const check = checkConfig(board, value);
  const setPart = (part: Part, v: RoomConfig[Part] | undefined) => {
    const n = { ...value } as Record<Part, unknown>;
    if (v === undefined) delete n[part]; else n[part] = v;
    onChange(n as RoomConfig);
  };
  const setField = (part: Part, path: string, v: unknown) =>
    onChange({ ...value, [part]: setAt((value[part] ?? {}) as PartObj, path, v) });

  const pinSelect = (part: Part, path: string, label: string) => {
    const v = getAt((value[part] ?? {}) as PartObj, path);
    return (
      <label key={path} className="flex items-center gap-1 text-xs text-muted-foreground">
        {label}
        <select className="h-7 rounded-md border bg-background px-1 text-xs text-foreground" value={typeof v === "number" ? v : ""}
          onChange={(e) => setField(part, path, Number(e.target.value))} aria-label={`${PART_LABEL[part]} ${label} pin`}>
          {typeof v !== "number" || !(pins as readonly number[]).includes(v) ? <option value="">-</option> : null}
          {pins.map((p) => <option key={p} value={p}>GPIO {p}</option>)}
        </select>
      </label>
    );
  };
  const ac = value.ac;
  const irDefaults = { type: "ir" as const, tx: board === "esp32-cam" ? 14 : 26, rx: board === "esp32-cam" ? 15 : 35, temp: 24, mode: "cool" as const, fan: "auto" as const };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        Start from
        {kitsFor(board).map((k) => (
          <Button key={k.id} type="button" size="sm" variant="outline" className="h-7" title={k.blurb}
            onClick={() => onChange(kitConfig(k.id, board) ?? {})}>{k.label}</Button>
        ))}
        <Button type="button" size="sm" variant="ghost" className="h-7" onClick={() => onChange({})}>Nothing</Button>
      </div>

      <ul className="divide-y rounded-lg border">
        {PARTS.map((part) => {
          const on = value[part] !== undefined;
          const st = report?.parts?.[part];
          const badge = on && st ? STATE_BADGE[st] : null;
          return (
            <li key={part} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
              <label className="flex min-w-44 flex-1 items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="h-4 w-4 accent-[var(--primary)]" checked={on}
                  onChange={(e) => setPart(part, e.target.checked ? (fallback?.[part] ?? defaultPart(board, part) ?? undefined) : undefined)} />
                {PART_LABEL[part]}
                {badge && <Badge variant={badge.variant} className="h-5 px-1.5 text-[10px]">{badge.text}</Badge>}
              </label>
              {on && part !== "ac" && (
                <div className="flex flex-wrap items-center gap-2">
                  {FIELDS[part]?.map(([path, label]) => pinSelect(part, path, label))}
                  {part === "presence" && (value.presence?.people !== undefined
                    ? pinSelect("presence", "people", "Occupants switch")
                    : board === "wokwi-door" && (
                      <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setField("presence", "people", 2)}>+ occupants switch</Button>
                    ))}
                  {part === "ring" && (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">LEDs
                      <input type="number" min={1} max={64} className="h-7 w-14 rounded-md border bg-background px-1 text-xs text-foreground"
                        value={value.ring?.pixels ?? 16} onChange={(e) => setField("ring", "pixels", Number(e.target.value))} />
                    </label>
                  )}
                  {part === "status_led" && (
                    <label className="flex items-center gap-1 text-xs text-muted-foreground">
                      <input type="checkbox" checked={!!value.status_led?.active_low}
                        onChange={(e) => setField("status_led", "active_low", e.target.checked || undefined)} /> on when low
                    </label>
                  )}
                </div>
              )}
              {on && part === "ac" && ac && (
                <div className="flex w-full flex-wrap items-center gap-2 pl-6">
                  <select className="h-7 rounded-md border bg-background px-1 text-xs" value={ac.type} aria-label="Air-con control"
                    onChange={(e) => setPart("ac", e.target.value === "relay" ? { type: "relay", pin: board === "esp32-cam" ? 12 : 15 } : irDefaults)}>
                    <option value="relay">Relay (on / off)</option>
                    <option value="ir">IR, like its remote</option>
                  </select>
                  {ac.type === "relay" && pinSelect("ac", "pin", "Relay")}
                  {ac.type === "ir" && (
                    <>
                      {pinSelect("ac", "tx", "IR LED")}
                      {ac.rx !== undefined ? pinSelect("ac", "rx", "IR receiver") : (
                        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setField("ac", "rx", irDefaults.rx)}>+ IR receiver</Button>
                      )}
                      <select className="h-7 rounded-md border bg-background px-1 text-xs" value={ac.protocol ?? ""} aria-label="Air-con make"
                        onChange={(e) => setField("ac", "protocol", e.target.value || undefined)}>
                        <option value="">Make: not set</option>
                        {ac.protocol && !(IR_PROTOCOLS as readonly string[]).includes(ac.protocol) && (
                          <option value={ac.protocol}>{ac.protocol === "RAW" ? "Recorded from its remote" : ac.protocol}</option>
                        )}
                        {IR_PROTOCOLS.map((p) => <option key={p} value={p}>{p}</option>)}
                      </select>
                      <label className="flex items-center gap-1 text-xs text-muted-foreground">
                        <input type="number" min={16} max={30} className="h-7 w-14 rounded-md border bg-background px-1 text-xs text-foreground"
                          value={ac.temp} onChange={(e) => setField("ac", "temp", Number(e.target.value))} /> °C
                      </label>
                      <select className="h-7 rounded-md border bg-background px-1 text-xs" value={ac.mode} aria-label="Air-con mode"
                        onChange={(e) => setField("ac", "mode", e.target.value)}>
                        {AC_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                      <select className="h-7 rounded-md border bg-background px-1 text-xs" value={ac.fan} aria-label="Air-con fan"
                        onChange={(e) => setField("ac", "fan", e.target.value)}>
                        {AC_FANS.map((f) => <option key={f} value={f}>fan {f}</option>)}
                      </select>
                    </>
                  )}
                  {acExtra}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {(check.errors.length > 0 || check.warnings.length > 0) && (
        <ul className="space-y-1 text-xs">
          {check.errors.map((e) => <li key={e} className="flex gap-1.5 text-destructive"><CircleAlert className="h-3.5 w-3.5 shrink-0" />{e}</li>)}
          {check.warnings.map((w) => <li key={w} className="flex gap-1.5 text-muted-foreground"><TriangleAlert className="h-3.5 w-3.5 shrink-0" />{w}</li>)}
        </ul>
      )}

      {showWiring && pinUses(value).length > 0 && (
        <details className="rounded-md border px-3 py-2 text-xs">
          <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">What goes on which pin</summary>
          <table className="mt-2 w-full">
            <tbody>
              {[...pinUses(value)].sort((a, b) => a.pin - b.pin).map((u) => (
                <tr key={`${u.part}-${u.what}`} className="border-t first:border-0">
                  <td className="py-1 pr-3 font-mono tabular-nums">GPIO {u.pin}</td>
                  <td className="py-1 text-muted-foreground">{PART_LABEL[u.part]}: {u.what}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pt-2 text-muted-foreground">Power: 3.3 V for sensors, 5 V for the servo and LED ring, and every ground to GND.</p>
        </details>
      )}
    </div>
  );
}
