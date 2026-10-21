import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import {
  COMMAND_TTL_S, commandTopic, describeCommand, signCommand, validateCommand, verifyCommand,
} from "./room-commands";

const keyHash = createHash("sha256").update("library-door-demo-key-123").digest("hex");
const NOW = 1_800_000_000;

describe("validateCommand", () => {
  it("normalises each command and clamps numbers", () => {
    expect(validateCommand("unlock", {})).toEqual({ ok: true, value: { kind: "unlock", args: { secs: 8 } } });
    expect(validateCommand("unlock", { secs: 999 })).toMatchObject({ value: { args: { secs: 30 } } });
    expect(validateCommand("lights", { state: "off" })).toEqual({ ok: true, value: { kind: "lights", args: { state: "off", mins: 30 } } });
    expect(validateCommand("ac", { state: "on", mins: 500 })).toMatchObject({ value: { args: { mins: 120 } } });
    expect(validateCommand("lockdown", { on: true })).toEqual({ ok: true, value: { kind: "lockdown", args: { on: true } } });
  });
  it("rejects bad input", () => {
    expect(validateCommand("lights", { state: "dim" }).ok).toBe(false);
    expect(validateCommand("lockdown", { on: "yes" }).ok).toBe(false);
    expect(validateCommand("message", { text: "   " }).ok).toBe(false);
    expect(validateCommand("selfdestruct", {}).ok).toBe(false);
  });
  it("keeps door messages printable and OLED-sized", () => {
    const r = validateCommand("message", { text: "Closed for cleaning 🧹 back at 3pm, sorry for the trouble!!" });
    expect(r.ok && r.value.kind === "message" && r.value.args.text).toBe("Closed for cleaning  back at 3pm, sorry fo");
  });
});

describe("sign and verify", () => {
  const c = validateCommand("lights", { state: "off", mins: 15 });
  if (!c.ok) throw new Error("setup");

  it("a signed command verifies once, with its contents", () => {
    const s = signCommand("cmd-1", c.value, keyHash, NOW);
    expect(s.exp).toBe(NOW + COMMAND_TTL_S);
    const seen = new Set<string>();
    expect(verifyCommand(s, keyHash, NOW + 5, seen)).toEqual({ ok: true, id: "cmd-1", kind: "lights", args: { state: "off", mins: 15 } });
    // the same message again (e.g. via MQTT and the HTTP fallback) is ignored
    expect(verifyCommand(s, keyHash, NOW + 6, seen)).toEqual({ ok: false, reason: "replayed" });
  });

  it("rejects a tampered command, the wrong key, and an expired one", () => {
    const s = signCommand("cmd-2", c.value, keyHash, NOW);
    const tampered = { ...s, cmd: s.cmd.replace('"off"', '"on"') };
    expect(verifyCommand(tampered, keyHash, NOW, new Set())).toEqual({ ok: false, reason: "bad_signature" });
    const otherKey = createHash("sha256").update("another-device").digest("hex");
    expect(verifyCommand(s, otherKey, NOW, new Set())).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyCommand(s, keyHash, NOW + COMMAND_TTL_S + 1, new Set())).toEqual({ ok: false, reason: "expired" });
    expect(verifyCommand({ cmd: 5 }, keyHash, NOW, new Set())).toEqual({ ok: false, reason: "malformed" });
  });

  it("topic is per device, and commands read well in the log", () => {
    expect(commandTopic("abc")).toBe("campus/rooms/abc/cmd");
    expect(describeCommand("lights", { state: "off", mins: 15 })).toBe("Lights forced off for 15 min");
    expect(describeCommand("ac", { state: "auto" })).toBe("Air-con back to automatic");
    expect(describeCommand("lockdown", { on: false })).toBe("Lockdown lifted");
  });
});
