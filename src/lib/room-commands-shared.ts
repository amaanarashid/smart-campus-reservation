/**
 * Remote-control commands: the parts both the browser and the server use
 * (kinds, limits, validation, labels). No node:crypto here, so client
 * components can import it. Signing lives in room-commands.ts.
 */

export const COMMAND_KINDS = ["unlock", "lights", "ac", "message", "lockdown"] as const;
export type CommandKind = (typeof COMMAND_KINDS)[number];
export type OverrideState = "on" | "off" | "auto";

/** A command not delivered within this many seconds is dropped. */
export const COMMAND_TTL_S = 60;
/** Lights / air-con overrides last this long by default, then go back to automatic. */
export const DEFAULT_OVERRIDE_MINS = 30;
export const MAX_OVERRIDE_MINS = 120;
export const MAX_MESSAGE_CHARS = 42;      // two OLED lines of 21
export const DEFAULT_MESSAGE_SECS = 300;

export const COMMAND_LABEL: Record<CommandKind, string> = {
  unlock: "Unlock door",
  lights: "Lights",
  ac: "Air-con",
  message: "Door message",
  lockdown: "Lockdown",
};

export type CommandArgs =
  | { kind: "unlock"; args: { secs: number } }
  | { kind: "lights" | "ac"; args: { state: OverrideState; mins: number } }
  | { kind: "message"; args: { text: string; secs: number } }
  | { kind: "lockdown"; args: { on: boolean } };

const clampInt = (v: unknown, lo: number, hi: number, dflt: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

/** Check and normalise what the app asked for. */
export function validateCommand(kind: unknown, raw: unknown):
  { ok: true; value: CommandArgs } | { ok: false; error: string } {
  const a = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  switch (kind) {
    case "unlock":
      return { ok: true, value: { kind, args: { secs: clampInt(a.secs, 3, 30, 8) } } };
    case "lights":
    case "ac": {
      const state = a.state;
      if (state !== "on" && state !== "off" && state !== "auto") return { ok: false, error: "State must be on, off or auto." };
      return { ok: true, value: { kind, args: { state, mins: clampInt(a.mins, 1, MAX_OVERRIDE_MINS, DEFAULT_OVERRIDE_MINS) } } };
    }
    case "message": {
      // plain printable ASCII only: the OLED font has nothing else
      const text = String(a.text ?? "").replace(/[^\x20-\x7E]/g, "").trim().slice(0, MAX_MESSAGE_CHARS);
      if (!text) return { ok: false, error: "Type a message (letters, numbers, punctuation)." };
      return { ok: true, value: { kind, args: { text, secs: clampInt(a.secs, 10, 3600, DEFAULT_MESSAGE_SECS) } } };
    }
    case "lockdown":
      if (typeof a.on !== "boolean") return { ok: false, error: "Lockdown needs on: true or false." };
      return { ok: true, value: { kind, args: { on: a.on } } };
    default:
      return { ok: false, error: "Unknown command." };
  }
}

export const commandTopic = (deviceId: string) => `campus/rooms/${deviceId}/cmd`;

/** One line for the room log / toasts, e.g. "Lights on for 30 min". */
export function describeCommand(kind: string, args: Record<string, unknown> | null): string {
  const a = args ?? {};
  switch (kind) {
    case "unlock": return `Door unlocked remotely for ${a.secs ?? 8} s`;
    case "lights":
    case "ac": {
      const what = kind === "ac" ? "Air-con" : "Lights";
      return a.state === "auto" ? `${what} back to automatic` : `${what} forced ${a.state} for ${a.mins} min`;
    }
    case "message": return `Door screen: "${a.text}"`;
    case "lockdown": return a.on ? "Keypad locked down" : "Lockdown lifted";
    default: return kind;
  }
}
