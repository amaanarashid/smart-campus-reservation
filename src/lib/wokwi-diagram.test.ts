import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { DOOR_KIT, checkConfig, kitConfig, type RoomConfig } from "./room-config";
import { wokwiDiagram } from "./wokwi-diagram";

const key = (c: unknown[]) => `${c[0]}>${c[1]}`;

describe("Wokwi circuit from a setup", () => {
  it("the door kit gives back the hand-made circuit", () => {
    const path = "firmware/door-wokwi/diagram.json";
    if (!existsSync(path)) return;
    const hand = JSON.parse(readFileSync(path, "utf8"));
    const made = wokwiDiagram(DOOR_KIT);
    const sortParts = (ps: { id: string }[]) => [...ps].sort((a, b) => a.id.localeCompare(b.id));
    expect(sortParts(made.parts)).toEqual(sortParts(hand.parts));
    expect(made.connections.map(key).sort()).toEqual(hand.connections.map(key).sort());
  });

  it("has only the parts the room has, wired to the chosen pins", () => {
    const cfg: RoomConfig = {
      presence: { pir: 35 }, lights: { pin: 25 },
      ac: { type: "ir", tx: 26, rx: 36, temp: 24, mode: "cool", fan: "auto" },
      temperature: { type: "dht22", pin: 27 },
    };
    expect(checkConfig("wokwi-door", cfg).errors).toEqual([]);
    const d = wokwiDiagram(cfg);
    expect(d.parts.map((p) => p.id).sort()).toEqual(["ac", "dht", "esp", "irrx", "lights", "pir", "rA", "rL", "remote"]);
    const wires = d.connections.map(key);
    expect(wires).toContain("pir:OUT>esp:35");
    expect(wires).toContain("esp:25>rL:1");
    expect(wires).toContain("esp:26>rA:1");
    expect(wires).toContain("irrx:DAT>esp:VP");       // GPIO 36 is "VP" on the Wokwi board
    expect(wires).toContain("dht:SDA>esp:27");
    expect(wires.some((w) => w.startsWith("keypad") || w.startsWith("oled"))).toBe(false);
  });

  it("every wire ends at a part that exists, and parts don't share a spot", () => {
    for (const cfg of [DOOR_KIT, kitConfig("controller", "esp32-devkit")!, { status_led: { pin: 2, active_low: true } } as RoomConfig]) {
      const d = wokwiDiagram(cfg);
      const ids = new Set([...d.parts.map((p) => p.id), "$serialMonitor"]);
      for (const [a, b] of d.connections) {
        expect(ids.has(a.split(":")[0])).toBe(true);
        expect(ids.has(b.split(":")[0])).toBe(true);
      }
      const spots = d.parts.map((p) => `${p.top},${p.left}`);
      expect(new Set(spots).size).toBe(spots.length);
    }
  });
});
