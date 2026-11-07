// Connecting a device to a room, and fetching the room's setup.
//
// An unconnected device makes its own key, sends it in a header to
// /api/room/pair and shows the 6-digit code it gets back (on the screen, or
// over USB for boards without one). An admin types the code in Admin -> Smart
// room -> Connect a room; the next poll returns the device id, the MQTT login
// and the room's setup (which parts, which pins).
#include "room.h"
#include <WiFi.h>
#include <Preferences.h>
#include <esp_system.h>

const unsigned long PAIR_POLL_MS = 4000;  // how often an unconnected device asks
String deviceKey = "", deviceId = "";
String mqttHost = "", mqttUser = "", mqttPass = "";
int mqttPort = 8883;
static Preferences prefs;

// A downloaded Wokwi simulation has its key written into this slot by the app
// (Admin -> Smart room -> Connect a room -> Simulated door), so it starts
// already connected. Unchanged ("....") everywhere else. The marker lets the
// app find the slot in the firmware file; see src/lib/esp-image.ts.
extern "C" __attribute__((used)) const char DEVICE_KEY_SLOT[81] =
    "CAMPUS-KEY-SLOT:"
    "................................................................";

// The room's setup, written in by the app when the firmware is downloaded or
// installed for a room (Connect a room). JSON, then zero bytes; "...." when
// the firmware was not made for a room. See bakedConfigJson().
extern "C" __attribute__((used)) const char DEVICE_CFG_SLOT[1041] =
    "CAMPUS-CFG-SLOT:"
    "................................................................................................................................"
    "................................................................................................................................"
    "................................................................................................................................"
    "................................................................................................................................"
    "................................................................................................................................"
    "................................................................................................................................"
    "................................................................................................................................"
    "................................................................................................................................";

String bakedConfigJson() {
  volatile const char *p = DEVICE_CFG_SLOT + 16;
  if (p[0] == '.' || p[0] == 0) return "";
  String out;
  out.reserve(512);
  for (int i = 0; i < 1024 && p[i]; i++) out += (char)p[i];
  return out;
}

static String slotKey() {
  volatile const char *p = DEVICE_KEY_SLOT + 16;   // volatile: read the flash, not a folded constant
  char buf[65];
  for (int i = 0; i < 64; i++) buf[i] = p[i];
  buf[64] = 0;
  if (buf[0] == '.' || buf[0] == 0) return "";
  return String(buf);
}

static String newKey() {
  uint8_t bytes[24];
  esp_fill_random(bytes, sizeof(bytes));   // true random once Wi-Fi is running
  String key = toHex(bytes, sizeof(bytes));
  prefs.putString("key", key);
  return key;
}

// Local Wokwi builds get a stable key from device_secret.py; a downloaded
// simulation has one in its slot; a real board keeps a random one in flash.
static bool fixedKey = false;
String loadKey() {
  prefs.begin("campus", false);
#ifdef BUILD_SECRET
  fixedKey = true;
  return String(BUILD_SECRET);
#else
  String s = slotKey();
  if (s.length() >= 32) { fixedKey = true; return s; }
  String key = prefs.getString("key", "");
  return key.length() >= 32 ? key : newKey();
#endif
}

// What this device is and what it found. Sent when it asks to pair.
static String reportJson() {
  JsonDocument r;
  r["board"] = BOARD_NAME;
  r["firmware"] = FW_VERSION;
  if (deviceId.length()) {                        // parts are known once the setup has arrived
    r["config_version"] = cfg.version;
    JsonObject parts = r["parts"].to<JsonObject>();
    for (int i = 0; i < P_COUNT; i++) {
      const char *s = partState[i] == PART_OK ? "ok" : partState[i] == PART_MISSING ? "missing"
                    : partState[i] == PART_BAD_PINS ? "bad_pins" : nullptr;
      if (s) parts[PART_NAMES[i]] = s;
    }
    JsonDocument i2c;
    deserializeJson(i2c, i2cScanJson());
    r["i2c"] = i2c.as<JsonArray>();
    JsonDocument ir;
    deserializeJson(ir, acIrReport());
    if (ir.size()) r["ir"] = ir.as<JsonObject>();
  }
  String out;
  serializeJson(r, out);
  return out;
}

static int pairRequest(JsonDocument &doc) {
  String body = String("{\"connection\":\"") + CONNECTION + "\",\"board\":\"" + BOARD_NAME +
                "\",\"report\":" + reportJson() + "}";
  return request("POST", "/api/room/pair", body, doc);
}

// The setup from the server: keep it, and restart if it differs from the one
// the hardware was started with (parts are only started once, at boot).
static void takeConfig(JsonDocument &doc, bool restartIfChanged) {
  int version = doc["config_version"] | 0;
  if (doc["config"].isNull()) return;
  if (version == cfg.version && cfg.version != 0) return;
  saveConfig(doc["config"].as<JsonVariantConst>(), version);
  if (restartIfChanged) {
    Serial.printf("Room setup changed (v%d -> v%d), restarting\n", cfg.version, version);
    drawSetup("Room setup changed", "Restarting...");
    delay(500);
    ESP.restart();
  }
  RoomConfig fresh;
  parseConfig(doc["config"].as<JsonVariantConst>(), fresh);
  fresh.version = version;
  bool screenMoved = fresh.display != cfg.display || fresh.pinSda != cfg.pinSda || fresh.pinScl != cfg.pinScl;
  cfg = fresh;
  // the screen was started with the old pins (or the board's default)
  if (screenMoved && cfg.display && (cfg.pinSda != BOARD_SDA || cfg.pinScl != BOARD_SCL)) {
    delay(200);
    ESP.restart();
  }
}

// Waits here until an admin has connected this device to a room. The door
// stays locked, and the key is never printed.
void pairDevice() {
  String shown = "";
  while (true) {
    JsonDocument doc;
    int status = pairRequest(doc);
    if (status == 200 && doc["ok"].as<bool>()) {
      if (doc["paired"].as<bool>()) {
        deviceId = doc["device_id"].as<String>();
        mqttHost = doc["mqtt"]["host"] | "";
        mqttPort = doc["mqtt"]["port"] | 8883;
        mqttUser = doc["mqtt"]["user"] | "";
        mqttPass = doc["mqtt"]["pass"] | "";
        if (!fixedKey) prefs.putBool("paired", true);
        takeConfig(doc, false);
        if (shown.length()) {              // it was waiting: tell whoever is there
          drawSetup("Connected!", doc["room"].as<String>());
          delay(1500);
        }
        Serial.println("Connected as " + doc["room"].as<String>());
        return;
      }
      // It was connected before and has been disconnected or replaced. Its old
      // key is finished with, so start again with a new one.
      if (!fixedKey && prefs.getBool("paired", false)) {
        prefs.putBool("paired", false);
        deviceKey = newKey();
        continue;
      }
      String pairCode = doc["code"] | "";
      if (pairCode.length() == 6) {
        if (pairCode != shown) {
          shown = pairCode;
          drawSetup("Connect this room", "Admin > Smart room", pairCode.substring(0, 3) + " " + pairCode.substring(3));
        }
        // every poll, so the app can read it over USB at any moment
        Serial.println("pair-code:" + pairCode);
        statusBlink(2);
      } else {
        shown = "";
        drawSetup("Too many devices waiting", "Trying again...");
      }
    } else {
      shown = "";
      drawSetup("Server unreachable", status > 0 ? "HTTP " + String(status) + ", retrying" : "Retrying...");
    }
    delay(PAIR_POLL_MS);
  }
}

// After the parts have started: tell the server what works.
void sendReport() {
  JsonDocument doc;
  int status = pairRequest(doc);
  Serial.printf("report -> %d\n", status);
}

// The status poll says which setup version the room is on.
void checkConfigVersion(int serverVersion) {
  if (serverVersion == cfg.version || serverVersion <= 0) return;
  JsonDocument doc;
  if (pairRequest(doc) == 200 && doc["paired"].as<bool>()) takeConfig(doc, true);
}
