import type { RoomConfig } from "./room-config";

/**
 * A Wokwi circuit (diagram.json) for a room's setup: only the parts the room
 * has, each wired to the pins chosen in the app. Used by the "Simulated door"
 * download, so the simulation matches what was picked.
 *
 * Positions follow the hand-made circuit (firmware/door-wokwi/diagram.json):
 * every part has its own spot around the ESP32, so any mix fits without
 * overlapping. The door kit gives back that circuit (see the test).
 *
 * Wokwi has no air-con and no IR LED, so LEDs stand in for them; an IR
 * receiver and Wokwi's IR remote are added for Learn (the remote is not an AC
 * remote, so the device records its signal rather than finding a make).
 */

type Conn = [string, string, string, string[]];
interface Part { type: string; id: string; top: number; left: number; attrs: Record<string, string> }
export interface Diagram {
  version: 1; author: string; editor: "wokwi"; parts: Part[]; connections: Conn[]; dependencies: Record<string, never>;
}

/** Wokwi's name for an ESP32 DevKit-C v4 pin. */
const pin = (gpio: number) => `esp:${gpio === 36 ? "VP" : gpio === 39 ? "VN" : gpio}`;
const GND = "esp:GND.1";

export function wokwiDiagram(cfg: RoomConfig, author = "Campus Reserve"): Diagram {
  const parts: Part[] = [{ type: "board-esp32-devkit-c-v4", id: "esp", top: 0, left: 0, attrs: {} }];
  const connections: Conn[] = [
    ["esp:TX", "$serialMonitor:RX", "", []],
    ["esp:RX", "$serialMonitor:TX", "", []],
  ];
  const part = (type: string, id: string, top: number, left: number, attrs: Record<string, string> = {}) =>
    parts.push({ type, id, top, left, attrs });
  const wire = (a: string, b: string, color: string) => connections.push([a, b, color, []]);
  /** LED through a 220 ohm resistor to a pin, cathode to ground. */
  // the resistor sits below its LED; the right-hand column a little lower, so the two don't touch
  const led = (id: string, r: string, gpio: number, color: string, label: string, top: number, left: number) => {
    part("wokwi-led", id, top, left, { color, label });
    part("wokwi-resistor", r, top + (left >= 270 ? 110 : 70), left - 5, { value: "220" });
    wire(pin(gpio), `${r}:1`, color === "white" ? "gray" : color);
    wire(`${r}:2`, `${id}:A`, color === "white" ? "gray" : color);
    wire(`${id}:C`, GND, "black");
  };

  if (cfg.display) {
    part("board-ssd1306", "oled", -130, 10, { i2cAddress: "0x3c" });
    wire("oled:VCC", "esp:3V3", "red");
    wire("oled:GND", GND, "black");
    wire("oled:SDA", pin(cfg.display.sda), "blue");
    wire("oled:SCL", pin(cfg.display.scl), "purple");
  }
  if (cfg.keypad) {
    part("wokwi-membrane-keypad", "keypad", -60, -380);
    cfg.keypad.rows.forEach((p, i) => wire(`keypad:R${i + 1}`, pin(p), "gold"));
    cfg.keypad.cols.forEach((p, i) => wire(`keypad:C${i + 1}`, pin(p), "orange"));
  }
  if (cfg.lock) {
    part("wokwi-servo", "lock", 410, -10);
    part("wokwi-slide-switch", "door", 430, 200);
    wire("lock:GND", GND, "black");
    wire("lock:V+", "esp:5V", "red");
    wire("lock:PWM", pin(cfg.lock.servo), "green");
    wire("door:2", pin(cfg.lock.door), "cyan");
    wire("door:1", GND, "black");
  }
  if (cfg.leds) {
    led("ledOk", "rOk", cfg.leds.ok, "green", "OPEN", -60, 230);
    led("ledNo", "rNo", cfg.leds.no, "red", "DENIED", -60, 270);
  }
  if (cfg.buzzer) {
    part("wokwi-buzzer", "buzzer", -70, 320, { volume: "0.1" });
    wire("buzzer:2", pin(cfg.buzzer.pin), "magenta");
    wire("buzzer:1", GND, "black");
  }
  if (cfg.presence) {
    part("wokwi-pir-motion-sensor", "pir", 310, -330);
    wire("pir:VCC", "esp:3V3", "red");
    wire("pir:GND", GND, "black");
    wire("pir:OUT", pin(cfg.presence.pir), "violet");
    if (cfg.presence.people !== undefined) {
      part("wokwi-slide-switch", "people", 100, 320);
      wire("people:2", pin(cfg.presence.people), "cyan");
      wire("people:1", GND, "black");
    }
  }
  if (cfg.lights) led("lights", "rL", cfg.lights.pin, "yellow", "LIGHTS", 100, 230);
  if (cfg.ac?.type === "relay") led("ac", "rA", cfg.ac.pin, "blue", "AIR-CON", 100, 270);
  if (cfg.ac?.type === "ir") {
    led("ac", "rA", cfg.ac.tx, "white", "IR LED", 100, 270);
    if (cfg.ac.rx !== undefined) {
      part("wokwi-ir-receiver", "irrx", 250, 330);
      part("wokwi-ir-remote", "remote", 220, 420);
      wire("irrx:VCC", "esp:3V3", "red");
      wire("irrx:GND", GND, "black");
      wire("irrx:DAT", pin(cfg.ac.rx), "green");
    }
  }
  if (cfg.temperature) {
    part("wokwi-dht22", "dht", 200, -150, { temperature: "28", humidity: "60" });
    wire("dht:VCC", "esp:3V3", "red");
    wire("dht:GND", GND, "black");
    wire("dht:SDA", pin(cfg.temperature.pin), "green");
  }
  if (cfg.ring) {
    part("wokwi-led-ring", "ring", 300, -215, { pixels: String(cfg.ring.pixels) });
    wire("ring:GND", GND, "black");
    wire("ring:VCC", "esp:5V", "red");
    wire("ring:DIN", pin(cfg.ring.pin), "violet");
  }
  if (cfg.status_led) {
    part("wokwi-led", "status", 240, 230, { color: "red", label: "STATUS" });
    part("wokwi-resistor", "rS", 310, 225, { value: "220" });
    if (cfg.status_led.active_low) {   // LED from 3V3 to the pin: lit when the pin is low
      wire("esp:3V3", "rS:1", "red");
      wire("rS:2", "status:A", "red");
      wire("status:C", pin(cfg.status_led.pin), "red");
    } else {
      wire(pin(cfg.status_led.pin), "rS:1", "red");
      wire("rS:2", "status:A", "red");
      wire("status:C", GND, "black");
    }
  }

  return { version: 1, author, editor: "wokwi", parts, connections, dependencies: {} };
}
