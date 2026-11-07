/**
 * What is wired to a room's device, and on which pins.
 *
 * The server stores one config per device (room_devices.config). The device
 * gets it when it connects and runs only the parts the config lists, so the
 * same firmware works for a full door kit, an ESP32-CAM that only runs the
 * lights and air-con, or anything in between. A missing part = the room does
 * not have it, and the app hides what depends on it.
 *
 * The firmware (firmware/door-wokwi/config.cpp) reads the same JSON keys and
 * checks the pins against the same board tables. Keep both in step.
 *
 * Pure: no I/O, used by the browser, the API and the tests.
 */

// ------------------------------------------------------------------ boards --
export const BOARDS = {
  "wokwi-door": {
    label: "Simulated door (Wokwi)", short: "Simulated",
    pins: [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
  },
  "esp32-devkit": {
    label: "ESP32 DevKit", short: "ESP32",
    pins: [0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39],
  },
  // AI-Thinker ESP32-CAM: the camera, PSRAM and SD card take most pins. These
  // stay free as long as the SD card is not used (the camera keeps its own).
  "esp32-cam": {
    label: "ESP32-CAM", short: "ESP32-CAM",
    pins: [2, 4, 12, 13, 14, 15, 33],
  },
} as const;
export type Board = keyof typeof BOARDS;
export const isBoard = (b: unknown): b is Board => typeof b === "string" && b in BOARDS;

/** ESP32 pins that can only read (no output, no internal pull-up). */
const INPUT_ONLY = new Set([34, 35, 36, 39]);
/** Pins the chip reads at power-on. Usable, but what is wired there matters. */
const STRAPPING: Record<number, string> = {
  0: "GPIO 0 must be high when the board starts, or it waits for new firmware.",
  2: "GPIO 2 must be low (or not connected) while installing firmware. Unplug what is on it if installing fails.",
  5: "GPIO 5 is read at start-up. Usually fine.",
  12: "GPIO 12 must be low when the board starts. An LED to ground is fine; a module that pulls it high stops the board starting.",
  15: "GPIO 15 is read at start-up. Usually fine.",
};

// ------------------------------------------------------------------ config --
export const AC_MODES = ["cool", "auto", "dry", "fan"] as const;
export const AC_FANS = ["auto", "low", "medium", "high"] as const;
/**
 * Air-con makes the IR module can drive with full control (power, temperature,
 * mode, fan), as named by IRremoteESP8266. Pointing the AC's own remote at the
 * IR receiver (Learn) finds the right one. "RAW" = a learned signal replayed
 * as it was, for a protocol the library does not know: on and off only.
 */
export const IR_PROTOCOLS = [
  "DAIKIN", "DAIKIN2", "PANASONIC_AC", "MITSUBISHI_AC", "MIDEA", "COOLIX", "GREE",
  "LG", "SAMSUNG_AC", "SHARP_AC", "TOSHIBA_AC", "HAIER_AC", "FUJITSU_AC",
  "HITACHI_AC", "KELVINATOR", "WHIRLPOOL_AC", "TCL112AC", "ELECTRA_AC", "CARRIER_AC64", "MIRAGE",
] as const;

export type AcConfig =
  | { type: "relay"; pin: number }
  | {
      type: "ir"; tx: number; rx?: number;
      /** unset until chosen or learned; then a name above, another IRremoteESP8266 name, or "RAW" */
      protocol?: string; model?: number;
      temp: number; mode: (typeof AC_MODES)[number]; fan: (typeof AC_FANS)[number];
    };

export interface RoomConfig {
  lock?: { servo: number; door: number };           // servo lock + door switch (closed = LOW)
  keypad?: { rows: number[]; cols: number[] };      // 4 x 4
  display?: { sda: number; scl: number };           // SSD1306 128x64 OLED at 0x3C
  leds?: { ok: number; no: number };
  buzzer?: { pin: number };
  presence?: { pir: number; people?: number };      // people = Wokwi's "occupants" switch
  lights?: { pin: number };
  ac?: AcConfig;
  temperature?: { type: "dht22"; pin: number };
  ring?: { pin: number; pixels: number };           // NeoPixel ring, end-of-booking light
  status_led?: { pin: number; active_low?: boolean };
}
export type Part = keyof RoomConfig;

export const PART_LABEL: Record<Part, string> = {
  lock: "Door lock + door switch",
  keypad: "Keypad (check-in at the door)",
  display: "Screen",
  leds: "Green / red lights",
  buzzer: "Buzzer",
  presence: "Motion sensor",
  lights: "Room lights",
  ac: "Air-con",
  temperature: "Temperature sensor",
  ring: "LED ring (end-of-booking light)",
  status_led: "Status light",
};

/** What the room can do, for the app. A device without a stored config is an older door kit. */
export function capabilities(cfg: RoomConfig | null | undefined) {
  const c = cfg ?? DOOR_KIT;
  return {
    door: !!c.lock,
    checkIn: !!(c.lock && c.keypad),          // check-in happens at the door, not in the app
    message: !!c.display,
    lights: !!c.lights,
    ac: c.ac?.type ?? null,
    acReady: c.ac?.type === "relay" || (c.ac?.type === "ir" && !!c.ac.protocol),
    irLearn: c.ac?.type === "ir" && c.ac.rx !== undefined,
    presence: !!c.presence,
    temperature: !!c.temperature,
    ring: !!c.ring,
  };
}
export type Capabilities = ReturnType<typeof capabilities>;

// -------------------------------------------------------------------- kits --
/** The Wokwi circuit (diagram.json); a DevKit wired the same way uses it too. */
export const DOOR_KIT: RoomConfig = {
  lock: { servo: 18, door: 4 },
  keypad: { rows: [13, 16, 14, 27], cols: [26, 25, 33, 32] },
  display: { sda: 21, scl: 22 },
  leds: { ok: 23, no: 19 },
  buzzer: { pin: 5 },
  presence: { pir: 34, people: 2 },
  lights: { pin: 17 },
  ac: { type: "relay", pin: 15 },
  ring: { pin: 12, pixels: 16 },
};

const IR_DEFAULTS = { temp: 24, mode: "cool", fan: "auto" } as const;

export const KITS = [
  {
    id: "door", label: "Door kit",
    blurb: "Keypad check-in, lock, screen, lights, air-con relay and the end-of-booking ring.",
    configs: { "wokwi-door": DOOR_KIT, "esp32-devkit": DOOR_KIT } as Partial<Record<Board, RoomConfig>>,
  },
  {
    id: "controller", label: "Room controller",
    blurb: "No door: motion sensor, lights and an IR air-con. Students check in from the app.",
    configs: {
      "esp32-cam": {
        presence: { pir: 13 },
        lights: { pin: 12 },
        ac: { type: "ir", tx: 14, rx: 15, ...IR_DEFAULTS },
        status_led: { pin: 33, active_low: true },
      },
      "esp32-devkit": {
        presence: { pir: 34 },
        lights: { pin: 17 },
        ac: { type: "ir", tx: 26, rx: 35, ...IR_DEFAULTS },
        temperature: { type: "dht22", pin: 27 },
        status_led: { pin: 2 },
      },
    } as Partial<Record<Board, RoomConfig>>,
  },
] as const;
export type KitId = (typeof KITS)[number]["id"];

export const kitsFor = (board: Board) => KITS.filter((k) => k.configs[board]);
/** A fresh copy, so editing it never changes the template. */
export const kitConfig = (kit: KitId, board: Board): RoomConfig | null => {
  const c = KITS.find((k) => k.id === kit)?.configs[board];
  return c ? structuredClone(c) : null;
};

/**
 * The setup a device runs when none was saved for it: an older door connected
 * before setups existed, or one registered from SQL. Door kit where the board
 * can take it, otherwise the room controller.
 */
export const defaultConfig = (board: Board): RoomConfig =>
  kitConfig("door", board) ?? kitConfig("controller", board) ?? {};

/** Pins a part would use if switched on with no other information. */
export function defaultPart(board: Board, part: Part): RoomConfig[Part] {
  for (const k of KITS) {
    const c = k.configs[board]?.[part];
    if (c) return structuredClone(c);
  }
  // nothing in a kit: pick the first free pins later in the editor
  switch (part) {
    case "temperature": return { type: "dht22", pin: board === "esp32-cam" ? 2 : 27 };
    case "status_led": return { pin: board === "esp32-cam" ? 33 : 2, active_low: board === "esp32-cam" };
    case "ac": return board === "esp32-cam" ? { type: "ir", tx: 14, rx: 15, ...IR_DEFAULTS } : { type: "relay", pin: 15 };
    default: return undefined;
  }
}

// -------------------------------------------------------------- validation --
type Role = "in" | "in_pullup" | "out" | "io";
interface PinUse { part: Part; what: string; pin: number; role: Role }

/** Every pin a config uses, with what it is for. */
export function pinUses(c: RoomConfig): PinUse[] {
  const u: PinUse[] = [];
  const add = (part: Part, what: string, pin: unknown, role: Role) => u.push({ part, what, pin: Number(pin), role });
  if (c.lock) { add("lock", "servo", c.lock.servo, "out"); add("lock", "door switch", c.lock.door, "in_pullup"); }
  if (c.keypad) {
    (c.keypad.rows ?? []).forEach((p, i) => add("keypad", `row ${i + 1}`, p, "in_pullup"));
    (c.keypad.cols ?? []).forEach((p, i) => add("keypad", `column ${i + 1}`, p, "out"));
  }
  if (c.display) { add("display", "SDA", c.display.sda, "io"); add("display", "SCL", c.display.scl, "io"); }
  if (c.leds) { add("leds", "green", c.leds.ok, "out"); add("leds", "red", c.leds.no, "out"); }
  if (c.buzzer) add("buzzer", "buzzer", c.buzzer.pin, "out");
  if (c.presence) {
    add("presence", "PIR", c.presence.pir, "in");
    if (c.presence.people !== undefined) add("presence", "occupants switch", c.presence.people, "in_pullup");
  }
  if (c.lights) add("lights", "lights", c.lights.pin, "out");
  if (c.ac?.type === "relay") add("ac", "relay", c.ac.pin, "out");
  if (c.ac?.type === "ir") {
    add("ac", "IR LED", c.ac.tx, "out");
    if (c.ac.rx !== undefined) add("ac", "IR receiver", c.ac.rx, "in");
  }
  if (c.temperature) add("temperature", "sensor", c.temperature.pin, "io");
  if (c.ring) add("ring", "data", c.ring.pin, "out");
  if (c.status_led) add("status_led", "LED", c.status_led.pin, "out");
  return u;
}

export interface ConfigCheck { errors: string[]; warnings: string[] }

/** Errors block saving; warnings are shown next to the pins. */
export function checkConfig(board: Board, c: RoomConfig): ConfigCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  const allowed = new Set<number>(BOARDS[board].pins);
  const seen = new Map<number, string>();

  for (const p of pinUses(c)) {
    const name = `${PART_LABEL[p.part]}: ${p.what}`;
    if (!Number.isInteger(p.pin)) { errors.push(`${name} needs a pin number.`); continue; }
    if (!allowed.has(p.pin)) { errors.push(`${name}: GPIO ${p.pin} is not free on the ${BOARDS[board].label}.`); continue; }
    if (INPUT_ONLY.has(p.pin) && p.role !== "in")
      errors.push(`${name}: GPIO ${p.pin} can only read${p.role === "in_pullup" ? " and has no pull-up" : ""}. Pick another pin.`);
    const other = seen.get(p.pin);
    if (other) errors.push(`GPIO ${p.pin} is used twice: ${other} and ${name}.`);
    else seen.set(p.pin, name);
    if (STRAPPING[p.pin] && !(p.pin === 12 && p.role === "out") && !(p.pin === 2 && p.role === "out"))
      warnings.push(`${name}: ${STRAPPING[p.pin]}`);
  }

  if (c.keypad && (c.keypad.rows?.length !== 4 || c.keypad.cols?.length !== 4))
    errors.push("The keypad needs 4 row pins and 4 column pins.");
  if (c.keypad && !c.lock) errors.push("A keypad opens the lock, so add the door lock too.");
  if (c.keypad && !c.display) warnings.push("Without a screen, people at the keypad get no feedback.");
  if (c.lock && !c.keypad) warnings.push("Without a keypad, the door only opens remotely, and students check in from the app.");
  if (c.ring && !(Number.isInteger(c.ring.pixels) && c.ring.pixels >= 1 && c.ring.pixels <= 64))
    errors.push("The LED ring needs 1 to 64 LEDs.");
  if (c.ac?.type === "ir") {
    if (!(Number.isInteger(c.ac.temp) && c.ac.temp >= 16 && c.ac.temp <= 30)) errors.push("Air-con temperature must be 16 to 30 °C.");
    if (!AC_MODES.includes(c.ac.mode)) errors.push("Unknown air-con mode.");
    if (!AC_FANS.includes(c.ac.fan)) errors.push("Unknown air-con fan speed.");
    if (c.ac.protocol !== undefined && !/^[A-Z0-9_]{2,24}$/.test(c.ac.protocol)) errors.push("Unknown air-con make.");
    if (!c.ac.protocol)
      warnings.push(c.ac.rx !== undefined
        ? "Air-con make not set yet: use Learn and press ON on the AC's remote, or pick the make."
        : "Air-con make not set yet: pick the make.");
  }
  if (c.lights && !c.presence) warnings.push("Without a motion sensor, the lights only follow remote control.");
  return { errors, warnings };
}

const PARTS: Part[] = ["lock", "keypad", "display", "leds", "buzzer", "presence", "lights", "ac", "temperature", "ring", "status_led"];

/**
 * Read a config that came from outside (the database, a request body) into a
 * clean RoomConfig, dropping anything unknown. Returns null if it is not an object.
 */
export function parseConfig(raw: unknown): RoomConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, Record<string, unknown> | undefined>;
  const n = (v: unknown) => (typeof v === "number" ? v : Number.NaN);
  const out: RoomConfig = {};
  for (const part of PARTS) {
    const v = r[part];
    if (!v || typeof v !== "object") continue;
    switch (part) {
      case "lock": out.lock = { servo: n(v.servo), door: n(v.door) }; break;
      case "keypad": out.keypad = {
        rows: Array.isArray(v.rows) ? v.rows.map(n) : [], cols: Array.isArray(v.cols) ? v.cols.map(n) : [],
      }; break;
      case "display": out.display = { sda: n(v.sda), scl: n(v.scl) }; break;
      case "leds": out.leds = { ok: n(v.ok), no: n(v.no) }; break;
      case "buzzer": out.buzzer = { pin: n(v.pin) }; break;
      case "presence": out.presence = { pir: n(v.pir), ...(v.people !== undefined ? { people: n(v.people) } : {}) }; break;
      case "lights": out.lights = { pin: n(v.pin) }; break;
      case "ac":
        if (v.type === "relay") out.ac = { type: "relay", pin: n(v.pin) };
        else if (v.type === "ir") out.ac = {
          type: "ir", tx: n(v.tx), ...(v.rx !== undefined ? { rx: n(v.rx) } : {}),
          ...(typeof v.protocol === "string" && v.protocol ? { protocol: v.protocol } : {}),
          ...(typeof v.model === "number" ? { model: v.model } : {}),
          temp: v.temp === undefined ? IR_DEFAULTS.temp : n(v.temp),
          mode: (AC_MODES as readonly unknown[]).includes(v.mode) ? v.mode as (typeof AC_MODES)[number] : IR_DEFAULTS.mode,
          fan: (AC_FANS as readonly unknown[]).includes(v.fan) ? v.fan as (typeof AC_FANS)[number] : IR_DEFAULTS.fan,
        };
        break;
      case "temperature": out.temperature = { type: "dht22", pin: n(v.pin) }; break;
      case "ring": out.ring = { pin: n(v.pin), pixels: v.pixels === undefined ? 16 : n(v.pixels) }; break;
      case "status_led": out.status_led = { pin: n(v.pin), ...(v.active_low === true ? { active_low: true } : {}) }; break;
    }
  }
  return out;
}

/**
 * The device heard the air-con's remote (POST /api/room/event "ir_learned").
 * Returns the setup with the make filled in, or null if nothing changes.
 * A recorded signal ("RAW") is only usable once both on and off are recorded.
 */
export function applyIrLearned(cfg: RoomConfig | null, detail: unknown): RoomConfig | null {
  if (cfg?.ac?.type !== "ir" || !detail || typeof detail !== "object") return null;
  const d = detail as Record<string, unknown>;
  const protocol = typeof d.protocol === "string" ? d.protocol : "";
  if (!/^[A-Z0-9_]{2,24}$/.test(protocol)) return null;
  if (protocol === "RAW" && !(d.raw_on === true && d.raw_off === true)) return null;
  const ac = { ...cfg.ac, protocol };
  if (protocol !== "RAW" && Number.isInteger(d.model) && (d.model as number) >= 0) ac.model = d.model as number;
  else delete ac.model;
  if (ac.protocol === cfg.ac.protocol && ac.model === cfg.ac.model) return null;
  return { ...cfg, ac };
}

// --------------------------------------------------------- device report --
/** What a device says about itself when it connects (POST /api/room/pair). */
export interface DeviceReport {
  board: Board;
  firmware?: string;
  i2c?: number[];                                    // addresses found on the I2C bus
  parts?: Partial<Record<Part, "ok" | "missing" | "bad_pins" | "off">>;
  config_version?: number;                          // the config it is running
  ir?: { protocol?: string; model?: number; raw_on?: boolean; raw_off?: boolean };
}

const PART_STATE = new Set(["ok", "missing", "bad_pins", "off"]);

export function parseReport(raw: unknown, fallbackBoard: Board): DeviceReport {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const board = isBoard(r.board) ? r.board : fallbackBoard;
  const out: DeviceReport = { board };
  if (typeof r.firmware === "string") out.firmware = r.firmware.slice(0, 40);
  if (Array.isArray(r.i2c)) out.i2c = r.i2c.filter((a) => Number.isInteger(a) && a > 0 && a < 128).slice(0, 16) as number[];
  if (r.parts && typeof r.parts === "object") {
    const parts: DeviceReport["parts"] = {};
    for (const p of PARTS) {
      const s = (r.parts as Record<string, unknown>)[p];
      if (typeof s === "string" && PART_STATE.has(s)) parts[p] = s as "ok";
    }
    out.parts = parts;
  }
  if (Number.isInteger(r.config_version)) out.config_version = r.config_version as number;
  if (r.ir && typeof r.ir === "object") {
    const ir = r.ir as Record<string, unknown>;
    out.ir = {
      ...(typeof ir.protocol === "string" && /^[A-Z0-9_]{2,24}$/.test(ir.protocol) ? { protocol: ir.protocol } : {}),
      ...(Number.isInteger(ir.model) ? { model: ir.model as number } : {}),
      ...(ir.raw_on === true ? { raw_on: true } : {}),
      ...(ir.raw_off === true ? { raw_off: true } : {}),
    };
  }
  return out;
}

/** Parts the config asks for that the device says are not working, for a warning in the app. */
export function partProblems(cfg: RoomConfig | null | undefined, report: DeviceReport | null | undefined): string[] {
  if (!report?.parts) return [];
  const c = cfg ?? DOOR_KIT;
  const out: string[] = [];
  for (const p of PARTS) {
    if (!c[p]) continue;
    const s = report.parts[p];
    if (s === "missing") out.push(`${PART_LABEL[p]}: not found. Check the wiring.`);
    else if (s === "bad_pins") out.push(`${PART_LABEL[p]}: the device refused these pins.`);
  }
  return out;
}
