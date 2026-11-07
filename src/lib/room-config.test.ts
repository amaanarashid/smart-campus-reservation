import { describe, expect, it } from "vitest";
import {
  BOARDS, DOOR_KIT, KITS, applyIrLearned, capabilities, defaultConfig, checkConfig, kitConfig, kitsFor, parseConfig, parseReport,
  partProblems, pinUses, type Board, type RoomConfig,
} from "./room-config";

describe("kits", () => {
  it("every kit is valid on every board it lists", () => {
    for (const k of KITS)
      for (const [board, cfg] of Object.entries(k.configs)) {
        const r = checkConfig(board as Board, cfg!);
        expect(r.errors, `${k.id} on ${board}`).toEqual([]);
      }
  });
  it("matches the Wokwi circuit pins", () => {
    expect(DOOR_KIT.lock).toEqual({ servo: 18, door: 4 });
    expect(DOOR_KIT.keypad).toEqual({ rows: [13, 16, 14, 27], cols: [26, 25, 33, 32] });
    expect(DOOR_KIT.ring).toEqual({ pin: 12, pixels: 16 });
  });
  it("offers only kits that fit the board", () => {
    expect(kitsFor("esp32-cam").map((k) => k.id)).toEqual(["controller"]);
    expect(kitsFor("wokwi-door").map((k) => k.id)).toEqual(["door"]);
    expect(kitsFor("esp32-devkit").map((k) => k.id)).toEqual(["door", "controller"]);
  });
  it("hands out copies, not the template", () => {
    const a = kitConfig("door", "wokwi-door")!;
    a.lock!.servo = 99;
    expect(DOOR_KIT.lock!.servo).toBe(18);
  });
});

describe("pin checks", () => {
  it("refuses pins the ESP32-CAM camera uses", () => {
    const r = checkConfig("esp32-cam", { lights: { pin: 21 } });
    expect(r.errors.join(" ")).toMatch(/GPIO 21 is not free on the ESP32-CAM/);
  });
  it("refuses a pin used twice", () => {
    const r = checkConfig("esp32-cam", { lights: { pin: 13 }, presence: { pir: 13 } });
    expect(r.errors.join(" ")).toMatch(/GPIO 13 is used twice/);
  });
  it("refuses outputs on input-only pins, allows sensors there", () => {
    expect(checkConfig("esp32-devkit", { lights: { pin: 34 } }).errors.join(" ")).toMatch(/can only read/);
    expect(checkConfig("esp32-devkit", { presence: { pir: 34 } }).errors).toEqual([]);
    expect(checkConfig("esp32-devkit", { lock: { servo: 18, door: 35 } }).errors.join(" ")).toMatch(/no pull-up/);
  });
  it("warns about start-up pins, except a plain output on 12", () => {
    expect(checkConfig("esp32-cam", { lights: { pin: 12 } }).warnings).toEqual([expect.stringMatching(/motion sensor/)]);
    expect(checkConfig("esp32-cam", { presence: { pir: 12 } }).warnings.join(" ")).toMatch(/GPIO 12 must be low/);
    expect(checkConfig("esp32-cam", { temperature: { type: "dht22", pin: 2 } }).warnings.join(" ")).toMatch(/installing firmware/);
  });
  it("needs a lock for a keypad and 4x4 pins", () => {
    const r = checkConfig("esp32-devkit", { keypad: { rows: [13, 16, 14], cols: [26, 25, 33, 32] } });
    expect(r.errors.join(" ")).toMatch(/4 row pins/);
    expect(r.errors.join(" ")).toMatch(/add the door lock/);
  });
  it("checks the air-con settings", () => {
    const bad: RoomConfig = { ac: { type: "ir", tx: 14, temp: 40, mode: "cool", fan: "auto", protocol: "daikin;" } };
    const r = checkConfig("esp32-cam", bad);
    expect(r.errors.join(" ")).toMatch(/16 to 30/);
    expect(r.errors.join(" ")).toMatch(/Unknown air-con make/);
    const unset = checkConfig("esp32-cam", { ac: { type: "ir", tx: 14, rx: 15, temp: 24, mode: "cool", fan: "auto" } });
    expect(unset.warnings.join(" ")).toMatch(/Learn/);
  });
  it("lists every pin with its use", () => {
    expect(pinUses(DOOR_KIT)).toHaveLength(2 + 8 + 2 + 2 + 1 + 2 + 1 + 1 + 1);
    expect(new Set(pinUses(DOOR_KIT).map((u) => u.pin)).size).toBe(20);
  });
  it("board tables never offer flash or serial pins", () => {
    for (const b of Object.values(BOARDS))
      for (const p of [1, 3, 6, 7, 8, 9, 10, 11]) expect(b.pins).not.toContain(p);
  });
});

describe("capabilities", () => {
  it("treats a device with no stored config as the door kit", () => {
    expect(capabilities(null)).toMatchObject({ door: true, checkIn: true, message: true, ac: "relay", acReady: true });
  });
  it("a room controller has no door, so check-in moves to the app", () => {
    const c = capabilities(kitConfig("controller", "esp32-cam"));
    expect(c).toMatchObject({ door: false, checkIn: false, message: false, lights: true, ac: "ir", irLearn: true, acReady: false });
  });
  it("IR air-con is ready once the make is known", () => {
    const cfg = kitConfig("controller", "esp32-cam")!;
    if (cfg.ac?.type === "ir") cfg.ac.protocol = "DAIKIN";
    expect(capabilities(cfg).acReady).toBe(true);
  });
});

describe("reading configs and reports from outside", () => {
  it("round-trips a kit and drops unknown keys", () => {
    const cfg = kitConfig("controller", "esp32-cam")!;
    expect(parseConfig(JSON.parse(JSON.stringify({ ...cfg, camera: { x: 1 } })))).toEqual(cfg);
    expect(parseConfig(JSON.parse(JSON.stringify(DOOR_KIT)))).toEqual(DOOR_KIT);
  });
  it("turns bad pin values into errors, not crashes", () => {
    const c = parseConfig({ lights: { pin: "17" } })!;
    expect(checkConfig("esp32-devkit", c).errors.join(" ")).toMatch(/needs a pin number/);
    expect(parseConfig(null)).toBeNull();
    expect(parseConfig([1])).toBeNull();
  });
  it("keeps only known report fields", () => {
    const r = parseReport({ board: "esp32-cam", firmware: "2.0.0", i2c: [60, 999, "x"], parts: { lights: "ok", ac: "weird", foo: "ok" },
      ir: { protocol: "DAIKIN", model: 1, raw_on: true }, config_version: 3 }, "wokwi-door");
    expect(r).toEqual({ board: "esp32-cam", firmware: "2.0.0", i2c: [60], parts: { lights: "ok" }, config_version: 3,
      ir: { protocol: "DAIKIN", model: 1, raw_on: true } });
    expect(parseReport("nope", "esp32-devkit")).toEqual({ board: "esp32-devkit" });
  });
  it("names parts that are configured but not working", () => {
    const cfg: RoomConfig = { lights: { pin: 12 }, temperature: { type: "dht22", pin: 2 } };
    expect(partProblems(cfg, { board: "esp32-cam", parts: { lights: "ok", temperature: "missing", display: "missing" } }))
      .toEqual(["Temperature sensor: not found. Check the wiring."]);
  });
});

describe("default setups", () => {
  it("a door kit where the board can take it, the room controller on an ESP32-CAM", () => {
    expect(defaultConfig("wokwi-door")).toEqual(DOOR_KIT);
    expect(defaultConfig("esp32-devkit")).toEqual(DOOR_KIT);
    expect(defaultConfig("esp32-cam")).toEqual(kitConfig("controller", "esp32-cam"));
  });
});

describe("learning the air-con remote", () => {
  const cam = () => kitConfig("controller", "esp32-cam");
  it("saves a recognised make and model", () => {
    const next = applyIrLearned(cam(), { protocol: "DAIKIN", model: 1, temp: 22 });
    expect(next?.ac).toMatchObject({ type: "ir", protocol: "DAIKIN", model: 1, temp: 24 });
  });
  it("uses a recorded signal only once both on and off are recorded", () => {
    expect(applyIrLearned(cam(), { protocol: "RAW", raw_on: true, raw_off: false })).toBeNull();
    expect(applyIrLearned(cam(), { protocol: "RAW", raw_on: true, raw_off: true })?.ac).toMatchObject({ protocol: "RAW" });
  });
  it("ignores rooms without IR, junk, and no-change", () => {
    expect(applyIrLearned(DOOR_KIT, { protocol: "DAIKIN" })).toBeNull();
    expect(applyIrLearned(cam(), { protocol: "x; drop" })).toBeNull();
    expect(applyIrLearned(cam(), null)).toBeNull();
    const once = applyIrLearned(cam(), { protocol: "GREE" })!;
    expect(applyIrLearned(once, { protocol: "GREE" })).toBeNull();
  });
});
