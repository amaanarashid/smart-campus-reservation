// Remote control. Admins / the room's managers press a control in the app;
// commands arrive over MQTT (TLS), signed with HMAC-SHA256 using
// SHA-256(device key) as the key. The device rejects bad signatures, expired
// and repeated commands, acts, and confirms over HTTP. If MQTT is down the
// same commands come with the status poll instead.
//   unlock      open the door for a few seconds
//   lights / ac force on or off for N minutes, or back to auto
//               (lights are never cut on people without a 10 s blink)
//   message     text on the door screen
//   lockdown    keypad disabled until lifted
//   ir_learn    listen for the AC's own remote (see ac.cpp)
// A command for a part the room does not have is refused in the reply.
#include "room.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <PubSubClient.h>
#include <time.h>
#include "mbedtls/md.h"

static WiFiClientSecure mqttNet;
PubSubClient mqtt(mqttNet);
String keyHash = "";                     // SHA-256(device key), hex = the command signing key
static String cmdTopic = "";
static String seenIds[8];                // last commands run (MQTT and HTTP may both deliver one)
static int seenNext = 0;
static unsigned long lastMqttTry = 0;
static String pendingCmd = "", pendingSig = "";   // received in the MQTT callback, run in loop()

String toHex(const uint8_t *b, size_t n) {
  static const char *h = "0123456789abcdef";
  String out; out.reserve(n * 2);
  for (size_t i = 0; i < n; i++) { out += h[b[i] >> 4]; out += h[b[i] & 15]; }
  return out;
}

String sha256Hex(const String &s) {
  uint8_t out[32];
  mbedtls_md(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256), (const uint8_t *)s.c_str(), s.length(), out);
  return toHex(out, 32);
}

static String hmacHex(const String &key, const String &msg) {
  uint8_t out[32];
  mbedtls_md_hmac(mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),
                  (const uint8_t *)key.c_str(), key.length(), (const uint8_t *)msg.c_str(), msg.length(), out);
  return toHex(out, 32);
}

static bool sameHex(const String &a, const String &b) {     // constant-time compare
  if (a.length() != b.length()) return false;
  uint8_t d = 0;
  for (size_t i = 0; i < a.length(); i++) d |= (uint8_t)(a[i] ^ tolower(b[i]));
  return d == 0;
}

void ack(const String &id, bool ok, const char *via, const String &detailJson) {
  JsonDocument ignored;
  String body = String("{\"device_id\":\"") + deviceId + "\",\"command_id\":\"" + id +
                "\",\"ok\":" + (ok ? "true" : "false") + ",\"via\":\"" + via + "\",\"detail\":" + detailJson + "}";
  int st = request("POST", "/api/room/ack", body, ignored);
  Serial.printf("ack %s -> %d\n", id.c_str(), st);
}

static String missing(const char *what) { return String("{\"error\":\"this room has no ") + what + "\"}"; }

// Verify, then run one command. `cmd` is the exact signed string.
void handleCommand(const String &cmd, const String &sig, const char *via) {
  if (cmd.length() == 0) return;
  if (!sameHex(hmacHex(keyHash, cmd), sig)) { Serial.println("command: bad signature - ignored"); return; }
  JsonDocument c;
  if (deserializeJson(c, cmd)) { Serial.println("command: bad JSON - ignored"); return; }
  String id = c["id"].as<String>();
  String kind = c["kind"].as<String>();
  long exp = c["exp"] | 0L;
  time_t now = time(nullptr);
  if (now > 1700000000 && now > exp) { Serial.println("command: expired - ignored"); return; }
  for (int i = 0; i < 8; i++) if (seenIds[i] == id) return;   // already run (came by both routes)
  seenIds[seenNext] = id; seenNext = (seenNext + 1) % 8;

  JsonObject a = c["args"].as<JsonObject>();
  bool ok = true;
  String detail = "null";
  if (kind == "unlock") {
    if (!cfg.lock) { ok = false; detail = missing("door lock"); }
    else {
      openLock((unsigned long)(a["secs"] | 8) * 1000UL);
      showMessage("Opened remotely", "by staff");
      beep(1, 1200);
    }
  } else if (kind == "lights" || kind == "ac") {
    bool isAc = kind == "ac";
    if (isAc ? cfg.ac == AC_NONE : !cfg.lights) { ok = false; detail = missing(isAc ? "air-con control" : "lights control"); }
    else {
      String st = a["state"] | "auto";
      unsigned long until = millis() + (unsigned long)(a["mins"] | 30) * 60000UL;
      int v = st == "on" ? 1 : st == "off" ? 0 : -1;
      if (!isAc) {
        lightsOverride = v; lightsOverrideUntil = until;
        if (v == 0 && room != ROOM_EMPTY) {          // people inside: warn before the dark
          lightsOffWarnUntil = millis() + WARNING_MS;
          detail = "{\"warned_occupants\":true}";
        }
      } else {
        acOverride = v; acOverrideUntil = until;
      }
      showMessage(String(isAc ? "Air-con " : "Lights ") + (v < 0 ? "automatic" : v ? "forced ON" : "forced OFF"),
                  v < 0 ? "" : String("for ") + (int)(a["mins"] | 30) + " min (staff)");
    }
  } else if (kind == "message") {
    if (!cfg.display) { ok = false; detail = missing("screen"); }
    else {
      String t = a["text"] | "";
      remoteLine1 = t.substring(0, 21);
      remoteLine2 = t.length() > 21 ? t.substring(21, 42) : "";
      remoteMsgUntil = millis() + (unsigned long)(a["secs"] | 300) * 1000UL;
      beep(1, 900);
    }
  } else if (kind == "lockdown") {
    if (!cfg.keypad) { ok = false; detail = missing("keypad"); }
    else {
      lockdown = a["on"] | false;
      code = ""; extendMode = false;
      if (lockdown && unlocked) closeLock();
      showMessage(lockdown ? "LOCKDOWN ON" : "Lockdown lifted", lockdown ? "Keypad disabled" : "Keypad active");
      beep(lockdown ? 3 : 1, lockdown ? 400 : 1200);
    }
  } else if (kind == "ir_learn") {
    // confirmed later, once something is heard (or after the time runs out)
    if (acLearnStart(id, a["slot"] | "on", a["secs"] | 30, via)) return;
    ok = false; detail = missing("IR receiver");
  } else {
    ok = false;
    detail = "{\"error\":\"unknown command\"}";
  }
  draw();
  ack(id, ok, via, detail);
}

static void onMqtt(char *topic, byte *payload, unsigned int len) {
  JsonDocument m;
  if (deserializeJson(m, payload, len)) return;
  pendingCmd = m["cmd"].as<String>();
  pendingSig = m["sig"].as<String>();
}

void remoteBegin() {
  keyHash = sha256Hex(deviceKey);
  cmdTopic = String("campus/rooms/") + deviceId + "/cmd";
  mqttNet.setInsecure();                 // demo shortcut, as for HTTPS (see README)
  if (mqttHost.length()) mqtt.setServer(mqttHost.c_str(), mqttPort);
  mqtt.setBufferSize(1024);
  mqtt.setCallback(onMqtt);
}

// Keep the MQTT link up without blocking the room: one attempt every 5 s.
static void ensureMqtt() {
  if (mqttHost.length() == 0 || WiFi.status() != WL_CONNECTED || mqtt.connected()) return;
  if (millis() - lastMqttTry < 5000) return;
  lastMqttTry = millis();
  String clientId = String("room-") + deviceId.substring(0, 8) + "-" + String(esp_random() & 0xffff, HEX);
  if (mqtt.connect(clientId.c_str(), mqttUser.c_str(), mqttPass.c_str())) {
    mqtt.subscribe(cmdTopic.c_str(), 1);
    Serial.println("MQTT connected as " + mqttUser + ", listening on " + cmdTopic);
  } else {
    // which login the server handed out (never the password), and what the refusal means
    int st = mqtt.state();
    const char *why = st == 4 ? "wrong username or password" : st == 5 ? "the broker refused this login"
                    : st < 0 ? "could not reach the broker" : "refused by the broker";
    Serial.printf("MQTT connect failed, state %d (%s): user \"%s\" at %s:%d\n",
                  st, why, mqttUser.c_str(), mqttHost.c_str(), mqttPort);
  }
}

void remoteLoop() {
  ensureMqtt();
  mqtt.loop();
  if (pendingCmd.length()) {             // received over MQTT; run it outside the callback
    String c = pendingCmd, sg = pendingSig;
    pendingCmd = ""; pendingSig = "";
    handleCommand(c, sg, "mqtt");
  }
}
