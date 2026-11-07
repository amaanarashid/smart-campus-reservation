// The room's setup, as sent by the server: which parts, which pins.
// Same keys and the same pin rules as src/lib/room-config.ts.
#include "room.h"
#include <Preferences.h>

RoomConfig cfg;
const char *PART_NAMES[P_COUNT] = {"lock", "keypad", "display", "leds", "buzzer", "presence",
                                   "lights", "ac", "temperature", "ring", "status_led"};
PartState partState[P_COUNT];

static int pinOf(JsonVariantConst v) { return v.is<int>() ? v.as<int>() : -2; }   // -2 = missing/bad

bool parseConfig(JsonVariantConst j, RoomConfig &c) {
  c = RoomConfig();
  if (!j.is<JsonObjectConst>()) return false;
  for (int i = 0; i < P_COUNT; i++) partState[i] = PART_OFF;

  if (j["lock"].is<JsonObjectConst>()) { c.lock = true; c.pinServo = pinOf(j["lock"]["servo"]); c.pinDoor = pinOf(j["lock"]["door"]); }
  if (j["keypad"].is<JsonObjectConst>()) {
    c.keypad = j["keypad"]["rows"].size() == 4 && j["keypad"]["cols"].size() == 4;
    for (int i = 0; i < 4 && c.keypad; i++) {
      int r = pinOf(j["keypad"]["rows"][i]), k = pinOf(j["keypad"]["cols"][i]);
      if (r < 0 || k < 0) c.keypad = false;
      else { c.rows[i] = r; c.cols[i] = k; }
    }
    if (!c.keypad) partState[P_KEYPAD] = PART_BAD_PINS;
  }
  if (j["display"].is<JsonObjectConst>()) { c.display = true; c.pinSda = pinOf(j["display"]["sda"]); c.pinScl = pinOf(j["display"]["scl"]); }
  if (j["leds"].is<JsonObjectConst>()) { c.leds = true; c.pinLedOk = pinOf(j["leds"]["ok"]); c.pinLedNo = pinOf(j["leds"]["no"]); }
  if (j["buzzer"].is<JsonObjectConst>()) { c.buzzer = true; c.pinBuzzer = pinOf(j["buzzer"]["pin"]); }
  if (j["presence"].is<JsonObjectConst>()) {
    c.presence = true; c.pinPir = pinOf(j["presence"]["pir"]);
    c.pinPeople = j["presence"]["people"].isNull() ? -1 : pinOf(j["presence"]["people"]);
  }
  if (j["lights"].is<JsonObjectConst>()) { c.lights = true; c.pinLights = pinOf(j["lights"]["pin"]); }
  JsonVariantConst ac = j["ac"];
  if (ac.is<JsonObjectConst>()) {
    String type = ac["type"] | "";
    if (type == "relay") { c.ac = AC_RELAY; c.pinAcRelay = pinOf(ac["pin"]); }
    else if (type == "ir") {
      c.ac = AC_IR; c.pinIrTx = pinOf(ac["tx"]);
      c.pinIrRx = ac["rx"].isNull() ? -1 : pinOf(ac["rx"]);
      c.acProtocol = ac["protocol"] | "";
      c.acModel = ac["model"] | -1;
      c.acTemp = constrain((int)(ac["temp"] | 24), 16, 30);
      c.acMode = ac["mode"] | "cool";
      c.acFan = ac["fan"] | "auto";
    }
  }
  if (j["temperature"].is<JsonObjectConst>()) { c.temperature = true; c.pinTemp = pinOf(j["temperature"]["pin"]); }
  if (j["ring"].is<JsonObjectConst>()) {
    c.ring = true; c.pinRing = pinOf(j["ring"]["pin"]);
    c.ringPixels = constrain((int)(j["ring"]["pixels"] | 16), 1, 64);
  }
  if (j["status_led"].is<JsonObjectConst>()) {
    c.statusLed = true; c.pinStatus = pinOf(j["status_led"]["pin"]);
    c.statusActiveLow = j["status_led"]["active_low"] | false;
  }
  return true;
}

// ---------------------------------------------------------------- pin check --
// role: 'i' input, 'p' input with pull-up, 'o' output, 'b' both
struct Use { Part part; int pin; char role; };

static void collect(const RoomConfig &c, Use *u, int &n) {
  auto add = [&](Part p, int pin, char role) { u[n++] = {p, pin, role}; };
  if (c.lock) { add(P_LOCK, c.pinServo, 'o'); add(P_LOCK, c.pinDoor, 'p'); }
  if (c.keypad) for (int i = 0; i < 4; i++) { add(P_KEYPAD, c.rows[i], 'p'); add(P_KEYPAD, c.cols[i], 'o'); }
  if (c.display) { add(P_DISPLAY, c.pinSda, 'b'); add(P_DISPLAY, c.pinScl, 'b'); }
  if (c.leds) { add(P_LEDS, c.pinLedOk, 'o'); add(P_LEDS, c.pinLedNo, 'o'); }
  if (c.buzzer) add(P_BUZZER, c.pinBuzzer, 'o');
  if (c.presence) { add(P_PRESENCE, c.pinPir, 'i'); if (c.pinPeople != -1) add(P_PRESENCE, c.pinPeople, 'p'); }
  if (c.lights) add(P_LIGHTS, c.pinLights, 'o');
  if (c.ac == AC_RELAY) add(P_AC, c.pinAcRelay, 'o');
  if (c.ac == AC_IR) { add(P_AC, c.pinIrTx, 'o'); if (c.pinIrRx != -1) add(P_AC, c.pinIrRx, 'i'); }
  if (c.temperature) add(P_TEMP, c.pinTemp, 'b');
  if (c.ring) add(P_RING, c.pinRing, 'o');
  if (c.statusLed) add(P_STATUS, c.pinStatus, 'o');
}

static void switchOff(RoomConfig &c, Part p) {
  switch (p) {
    case P_LOCK: c.lock = false; c.keypad = false; break;   // a keypad without its lock is no use
    case P_KEYPAD: c.keypad = false; break;
    case P_DISPLAY: c.display = false; break;
    case P_LEDS: c.leds = false; break;
    case P_BUZZER: c.buzzer = false; break;
    case P_PRESENCE: c.presence = false; break;
    case P_LIGHTS: c.lights = false; break;
    case P_AC: c.ac = AC_NONE; break;
    case P_TEMP: c.temperature = false; break;
    case P_RING: c.ring = false; break;
    case P_STATUS: c.statusLed = false; break;
    default: break;
  }
}

// A part with a pin this board cannot give it is not started, and the server
// is told (bad_pins). The rest of the room still works.
void checkPins(RoomConfig &c) {
  Use u[40]; int n = 0;
  collect(c, u, n);
  bool bad[P_COUNT] = {false};
  int owner[40];
  for (int i = 0; i < 40; i++) owner[i] = -1;
  for (int i = 0; i < n; i++) {
    int pin = u[i].pin;
    if (pin < 0 || pin >= 40 || !boardPinFree(pin)) { bad[u[i].part] = true; continue; }
    if (boardPinInputOnly(pin) && u[i].role != 'i') { bad[u[i].part] = true; continue; }
    if (owner[pin] >= 0 && owner[pin] != u[i].part) { bad[u[i].part] = true; continue; }
    if (owner[pin] == u[i].part) { bad[u[i].part] = true; continue; }   // same part twice
    owner[pin] = u[i].part;
  }
  bool on[P_COUNT] = {c.lock, c.keypad, c.display, c.leds, c.buzzer, c.presence, c.lights,
                      c.ac != AC_NONE, c.temperature, c.ring, c.statusLed};
  for (int p = 0; p < P_COUNT; p++) {
    if (bad[p]) { partState[p] = PART_BAD_PINS; switchOff(c, (Part)p); }
    else if (on[p] && partState[p] == PART_OFF) partState[p] = PART_OK;
  }
  if (!c.lock && partState[P_KEYPAD] == PART_OK) { partState[P_KEYPAD] = PART_BAD_PINS; c.keypad = false; }
}

// ------------------------------------------------------------- flash copy --
// Kept so the room starts with its own setup before the network is up.
static Preferences store;

void saveConfig(JsonVariantConst j, int version) {
  String s;
  serializeJson(j, s);
  store.begin("roomcfg", false);
  store.putString("json", s);
  store.putInt("v", version);
  store.end();
}

bool loadSavedConfig(RoomConfig &out) {
  store.begin("roomcfg", true);
  String s = store.getString("json", "");
  int v = store.getInt("v", 0);
  store.end();
  if (s.length() == 0) return false;
  JsonDocument d;
  if (deserializeJson(d, s) || !parseConfig(d.as<JsonVariantConst>(), out)) return false;
  out.version = v;
  return true;
}

// --------------------------------------------------------- setup in the firmware --
// Firmware made for a room carries its setup (pair.cpp). The first start after
// it is installed uses that setup, even if an older one is saved in flash, so
// the parts work before the network does. Once connected, the server's copy wins.
static uint32_t hashText(const String &s) {
  uint32_t h = 2166136261u;                 // FNV-1a
  for (size_t i = 0; i < s.length(); i++) { h ^= (uint8_t)s[i]; h *= 16777619u; }
  return h;
}

bool useBakedConfig(RoomConfig &out) {
  String baked = bakedConfigJson();
  if (baked.length() == 0) return false;
  uint32_t h = hashText(baked);
  store.begin("roomcfg", true);
  uint32_t seen = store.getUInt("baked", 0);
  store.end();
  if (seen == h) return false;              // already taken over on an earlier start
  JsonDocument d;
  if (deserializeJson(d, baked) || !parseConfig(d.as<JsonVariantConst>(), out)) return false;
  out.version = 0;                          // any version from the server replaces it
  saveConfig(d.as<JsonVariantConst>(), 0);
  store.begin("roomcfg", false);
  store.putUInt("baked", h);
  store.end();
  Serial.println("Using the setup this firmware was made with");
  return true;
}
