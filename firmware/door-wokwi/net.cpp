// Wi-Fi, the HTTPS link to the app, and the status poll.
#include "room.h"
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#ifdef REAL_BOARD
#include <WiFiManager.h>
#endif

const char *API_BASE = "https://smart-campus-reservation.vercel.app";  // no trailing slash
const unsigned long STATUS_EVERY_MS = 5000;   // keep-alive makes this cheap

#ifdef REAL_BOARD
const char *CONNECTION = "mqtt";              // stored as "Physical"
static const char *SETUP_WIFI = "CampusRoom-Setup";   // the device's own Wi-Fi setup network
static const int SETUP_TIMEOUT_S = 180;       // then retry, in case the router was just down
#else
const char *CONNECTION = "wokwi";             // stored as "Simulated"
static const char *WIFI_SSID = "Wokwi-GUEST"; // Wokwi's simulated internet access
#endif

unsigned long lastStatus = 0;
String bookingState = "free";
long minutesLeftAtPoll = -1, nextMinutesAtPoll = -1, secsLeftAtPoll = -1;
unsigned long polledAt = 0;
String bookingKey = "";
bool canExtend = false;
static int authFails = 0;

long minutesLeft() {
  if (minutesLeftAtPoll < 0) return -1;
  return minutesLeftAtPoll - (long)((millis() - polledAt) / 60000UL);
}
long minutesToNext() {
  if (nextMinutesAtPoll < 0) return -1;
  return nextMinutesAtPoll - (long)((millis() - polledAt) / 60000UL);
}
// counted down locally between polls, so the screen ticks every second
long secsLeft() {
  if (secsLeftAtPoll < 0) return -1;
  return secsLeftAtPoll - (long)((millis() - polledAt) / 1000UL);
}

// Simulated: Wokwi's network. Real board: saved Wi-Fi, or if that fails the
// device opens its own setup network, where a phone picks the Wi-Fi.
void connectWifi() {
  drawSetup("Connecting to Wi-Fi", "");
  statusBlink(1);
#ifdef REAL_BOARD
  WiFiManager wm;
  wm.setConfigPortalTimeout(SETUP_TIMEOUT_S);
  wm.setAPCallback([](WiFiManager *) {
    drawSetup("On a phone, join Wi-Fi", SETUP_WIFI);
    Serial.printf("Wi-Fi setup: join %s on a phone\n", SETUP_WIFI);
  });
  if (!wm.autoConnect(SETUP_WIFI)) ESP.restart();
#else
  WiFi.begin(WIFI_SSID, "", 6);
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
#endif
  Serial.println("WiFi connected");
}

// One HTTPS connection, kept open and reused (keep-alive): the slow part of a
// request is the TLS handshake, so doing it once keeps the room responsive.
static WiFiClientSecure apiNet;
static HTTPClient http;
static bool apiReady = false;

int request(const char *method, const String &path, const String &body, JsonDocument &out) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  if (!apiReady) {
    apiNet.setInsecure();  // demo shortcut: skips certificate checking (see README)
    http.setReuse(true);
    http.setTimeout(10000);
    apiReady = true;
  }
  if (!http.begin(apiNet, String(API_BASE) + path)) return -2;
  http.addHeader("x-device-key", deviceKey);
  http.addHeader("Content-Type", "application/json");
  int status = strcmp(method, "POST") == 0 ? http.POST(body) : http.GET();
  if (status > 0) {
    DeserializationError err = deserializeJson(out, http.getString());
    if (err) Serial.printf("JSON error: %s\n", err.c_str());
  } else {
    Serial.printf("HTTP error: %s\n", http.errorToString(status).c_str());
    apiNet.stop();         // drop a broken connection; the next request opens a fresh one
  }
  http.end();              // with setReuse(true) this keeps the connection open
  return status;
}

// Tell the server what happened in the room. detailJson must be valid JSON.
int report(const char *kind, const String &detailJson, JsonDocument &out) {
  String body = String("{\"device_id\":\"") + deviceId + "\",\"kind\":\"" + kind +
                "\",\"detail\":" + detailJson + "}";
  int status = request("POST", "/api/room/event", body, out);
  Serial.printf("event %s -> %d\n", kind, status);
  return status;
}
void report(const char *kind, const String &detailJson) {
  JsonDocument ignored;
  report(kind, detailJson, ignored);
}

void refreshStatus() {
  JsonDocument doc;
  int status = request("GET", String("/api/room/status?device_id=") + deviceId, "", doc);
  if (status == 200 && doc["ok"].as<bool>()) {
    authFails = 0;
    statusLine1 = doc["display"]["line1"].as<String>();
    statusLine2 = doc["display"]["line2"].as<String>();
    bookingState = doc["state"].as<String>();
    minutesLeftAtPoll = doc["current"].isNull() ? -1 : doc["current"]["minutes_left"].as<long>();
    secsLeftAtPoll = doc["current"].isNull() ? -1 : (doc["current"]["seconds_left"] | (minutesLeftAtPoll * 60));
    canExtend = !doc["current"].isNull() && (doc["current"]["can_extend"] | false);
    nextMinutesAtPoll = doc["next"].isNull() ? -1 : doc["next"]["minutes_until"].as<long>();
    polledAt = millis();
    String key = doc["current"].isNull() ? String("") : doc["current"]["ends_at"].as<String>();
    if (key != bookingKey) bookingKey = key;          // room.cpp resets its reminders on a new key
    // remote control, HTTP fallback: lockdown state and any commands still waiting
    bool ld = doc["lockdown"] | false;
    if (ld != lockdown) { lockdown = ld; code = ""; extendMode = false; }
    for (JsonVariant c : doc["commands"].as<JsonArray>())
      handleCommand(c["cmd"].as<String>(), c["sig"].as<String>(), "http");
    // the room's setup changed in the app: fetch it (the device restarts with it)
    if (!doc["config_version"].isNull()) checkConfigVersion(doc["config_version"].as<int>());
  } else if (status == 401 || status == 403) {
    // disconnected or replaced in the admin console. Ask a few times first, so
    // a passing server fault does not restart a device that is in use.
    statusLine1 = "Reconnecting..."; statusLine2 = "";
    if (++authFails >= 3) { draw(); delay(1000); ESP.restart(); }
  } else {
    authFails = 0;
    statusLine1 = "Server unreachable"; statusLine2 = "HTTP " + String(status);
  }
  lastStatus = millis();
  draw();
}
