/*
 * Campus Reserve - smart library room (Wokwi simulation, ESP32)
 *
 * DOOR      Keypad code -> Vercel checks it against the booking running now
 *           -> servo lock opens and the booking is checked in. Relocks once
 *           the door has been opened and shut, or after a few seconds.
 *
 * ROOM      A presence signal is filtered on the device and drives the lights
 *           and air-con. The control loop runs HERE, not on the server, so the
 *           room keeps working if the network drops; the server is told what
 *           happened (for the energy and booked-vs-used figures).
 *
 * SCHEDULE  Every 30 s the device asks the server about the booking:
 *             - air-con on 5 min BEFORE a booking starts (pre-cooling)
 *             - reminders at 10 and 5 min before the end
 *             - if a checked-in group leaves early and the room stays empty,
 *               the rest of the booking is released for others
 *
 * Presence signal chain (every T = 200 ms):
 *   x[n]  motion this sample: PIR, or the simulated occupants switch
 *   noise flip x[n] with probability eta (0..0.4, set by the NOISE slider) -
 *         false triggers when empty, dropouts when occupied, like a real sensor
 *   y[n] = a*x[n] + (1-a)*y[n-1], a = 0.10     first-order IIR low-pass,
 *         time constant tau = -T/ln(1-a) = 1.9 s
 *   hysteresis: ROOM_EMPTY -> ROOM_OCCUPIED when y > 0.35;
 *               ROOM_OCCUPIED -> ROOM_WARNING when y < 0.08 for VACANCY_MS;
 *               ROOM_WARNING: lights blink, then EMPTY unless presence returns
 *
 * Controls in the simulation:
 *   keypad        0-9 code, * clear, # submit
 *   DOOR switch   door closed / open
 *   PEOPLE switch simulated occupants in the room (they fidget, so motion is
 *                 intermittent - the filter has to cope with that)
 *   PIR sensor    click it to simulate a single movement
 *   NOISE slider  how unreliable the sensor is
 *
 * LOG_SIGNAL prints a CSV line every sample:  sig,ms,occupied,x,y,state
 * Copy it from the serial monitor to plot the filter for the report.
 */

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Keypad.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>

// ------------------------------------------------------------------ CONFIG --
const char *API_BASE   = "https://smart-campus-reservation.vercel.app";  // no trailing slash
const char *DEVICE_ID  = "f5ea6baa-1b10-46da-b125-cec0f9135f20";        // from register_room_device()
const char *DEVICE_KEY = "library-door-demo-7Qx92kLm4Tz8";

const char *WIFI_SSID = "Wokwi-GUEST";   // Wokwi's simulated internet access
const char *WIFI_PASS = "";

// -------------------------------------------------------------------- pins --
// Door
const int PIN_SERVO  = 18;
const int PIN_DOOR   = 4;    // slide switch, INPUT_PULLUP: LOW = closed
const int PIN_LED_OK = 23;
const int PIN_LED_NO = 19;
const int PIN_BUZZER = 5;
// Room
const int PIN_PIR    = 34;   // input-only pin, PIR drives it
const int PIN_NOISE  = 35;   // ADC1 (ADC2 is unavailable while Wi-Fi is on)
const int PIN_PEOPLE = 2;    // slide switch, INPUT_PULLUP: LOW = people in the room
const int PIN_LIGHTS = 17;
const int PIN_AC     = 15;

const byte ROWS = 4, COLS = 4;
char KEYS[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};
// GPIO 12 avoided on purpose: it is a boot-strapping pin on real ESP32 boards
byte ROW_PINS[ROWS] = {13, 16, 14, 27};
byte COL_PINS[COLS] = {26, 25, 33, 32};

// --------------------------------------------------- presence filter tuning --
const unsigned long SAMPLE_MS = 200;     // T
const float ALPHA     = 0.10f;           // tau = -T/ln(1-a) = 1.9 s
const float TH_ON     = 0.35f;           // EMPTY -> OCCUPIED
const float TH_OFF    = 0.08f;           // below this counts as "no one moving"
const float P_MOVE    = 0.60f;           // simulated occupant shows motion in a sample
const float NOISE_MAX = 0.40f;           // NOISE slider at full = 40% flipped samples
const bool  LOG_SIGNAL = true;

// --------------------------------------------- timings (demo vs real values) --
const unsigned long VACANCY_MS       = 60000UL;   // demo 1 min   | real 10 min
const unsigned long WARNING_MS       = 10000UL;   // lights blink before switching off
const unsigned long EARLY_RELEASE_MS = 120000UL;  // demo 2 min   | real 15 min
const long PRECOOL_MIN = 5;                       // AC on this long before a booking
const unsigned long STATUS_EVERY_MS = 30000;
const unsigned long MESSAGE_MS      = 3500;
const int LOCKED_DEG = 0, OPEN_DEG = 90;

// ------------------------------------------------------------------ objects --
Keypad keypad = Keypad(makeKeymap(KEYS), ROW_PINS, COL_PINS, ROWS, COLS);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Servo lockServo;

// -------------------------------------------------------------------- state --
// door + screen
String code = "";
String statusLine1 = "Connecting...", statusLine2 = "";
String msgLine1 = "", msgLine2 = "";
unsigned long msgUntil = 0, lastStatus = 0;
bool unlocked = false, doorWasOpened = false, doorOpenLast = false;
unsigned long unlockedAt = 0, openMs = 8000;

// room
enum RoomState { ROOM_EMPTY, ROOM_OCCUPIED, ROOM_WARNING };
RoomState room = ROOM_EMPTY;
float presence = 0;                      // y[n]
unsigned long lastSample = 0, belowSince = 0, warningSince = 0, emptySince = 0;
bool lightsOn = false, acOn = false;

// booking, as last reported by the server
String bookingState = "free";            // free | booked | in_use
long minutesLeftAtPoll = -1, nextMinutesAtPoll = -1;
unsigned long polledAt = 0;
String bookingKey = "";                  // current booking's end time; resets reminders
bool remind10 = false, remind5 = false, releaseSent = false;

// =============================================================== helpers ==
float frand() { return (float)(esp_random() % 10000) / 10000.0f; }

long minutesLeft() {
  if (minutesLeftAtPoll < 0) return -1;
  return minutesLeftAtPoll - (long)((millis() - polledAt) / 60000UL);
}
long minutesToNext() {
  if (nextMinutesAtPoll < 0) return -1;
  return nextMinutesAtPoll - (long)((millis() - polledAt) / 60000UL);
}

// ================================================================ display ==
void draw() {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);

  bool showMsg = millis() < msgUntil;
  oled.setCursor(0, 0);
  oled.println(showMsg ? msgLine1 : statusLine1);
  oled.setCursor(0, 11);
  oled.println(showMsg ? msgLine2 : statusLine2);
  oled.drawLine(0, 22, 127, 22, SSD1306_WHITE);

  if (unlocked) {
    oled.setTextSize(2);
    oled.setCursor(0, 28);
    oled.println("OPEN");
  } else {
    oled.setCursor(0, 31);
    oled.print("Code:");
    oled.setTextSize(2);
    oled.setCursor(34, 28);
    for (int i = 0; i < 6; i++) oled.print(i < (int)code.length() ? '*' : '_');
  }

  // footer: presence bar with the two thresholds, then lights / AC indicators
  oled.setTextSize(1);
  oled.setCursor(0, 55);
  oled.print("P");
  const int bx = 8, bw = 64, by = 55, bh = 8;
  oled.drawRect(bx, by, bw, bh, SSD1306_WHITE);
  oled.fillRect(bx, by, (int)(presence * bw), bh, SSD1306_WHITE);
  oled.drawLine(bx + (int)(TH_ON * bw), by - 2, bx + (int)(TH_ON * bw), by + bh + 1, SSD1306_WHITE);
  oled.drawLine(bx + (int)(TH_OFF * bw), by - 2, bx + (int)(TH_OFF * bw), by + bh + 1, SSD1306_WHITE);

  oled.setCursor(78, 55); oled.print("L");
  if (lightsOn) oled.fillRect(85, 55, 8, 8, SSD1306_WHITE); else oled.drawRect(85, 55, 8, 8, SSD1306_WHITE);
  oled.setCursor(98, 55); oled.print("A");
  if (acOn) oled.fillRect(105, 55, 8, 8, SSD1306_WHITE); else oled.drawRect(105, 55, 8, 8, SSD1306_WHITE);
  if (WiFi.status() != WL_CONNECTED) { oled.setCursor(116, 55); oled.print("!"); }
  oled.display();
}

void showMessage(const String &l1, const String &l2) {
  msgLine1 = l1; msgLine2 = l2; msgUntil = millis() + MESSAGE_MS;
  draw();
}

// Square wave on the buzzer pin, bit-banged. Deliberately not tone(): tone()
// and ESP32Servo both use the LEDC PWM timers and can fight over them.
void buzz(int freq, int ms) {
  const unsigned long halfPeriod = 500000UL / freq;
  const unsigned long until = millis() + ms;
  while (millis() < until) {
    digitalWrite(PIN_BUZZER, HIGH); delayMicroseconds(halfPeriod);
    digitalWrite(PIN_BUZZER, LOW);  delayMicroseconds(halfPeriod);
  }
}

void beep(int times, int freq) {
  for (int i = 0; i < times; i++) { buzz(freq, 120); delay(60); }
}

// ================================================================== http ==
// Returns the HTTP status (or a negative number on a network error) and
// fills `out` with the parsed JSON body.
int request(const char *method, const String &path, const String &body, JsonDocument &out) {
  if (WiFi.status() != WL_CONNECTED) return -1;
  WiFiClientSecure client;
  client.setInsecure();  // demo shortcut: skips certificate checking (see README)
  HTTPClient http;
  http.setTimeout(10000);
  if (!http.begin(client, String(API_BASE) + path)) return -2;
  http.addHeader("x-device-key", DEVICE_KEY);
  http.addHeader("Content-Type", "application/json");
  int status = strcmp(method, "POST") == 0 ? http.POST(body) : http.GET();
  if (status > 0) {
    DeserializationError err = deserializeJson(out, http.getString());
    if (err) Serial.printf("JSON error: %s\n", err.c_str());
  } else {
    Serial.printf("HTTP error: %s\n", http.errorToString(status).c_str());
  }
  http.end();
  return status;
}

// Tell the server what happened in the room. detailJson must be valid JSON.
int report(const char *kind, const String &detailJson, JsonDocument &out) {
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"kind\":\"" + kind +
                "\",\"detail\":" + detailJson + "}";
  int status = request("POST", "/api/room/event", body, out);
  Serial.printf("event %s -> %d\n", kind, status);
  return status;
}
void report(const char *kind, const String &detailJson = "null") {
  JsonDocument ignored;
  report(kind, detailJson, ignored);
}

void refreshStatus() {
  JsonDocument doc;
  int status = request("GET", String("/api/room/status?device_id=") + DEVICE_ID, "", doc);
  if (status == 200 && doc["ok"].as<bool>()) {
    statusLine1 = doc["display"]["line1"].as<String>();
    statusLine2 = doc["display"]["line2"].as<String>();
    bookingState = doc["state"].as<String>();
    minutesLeftAtPoll = doc["current"].isNull() ? -1 : doc["current"]["minutes_left"].as<long>();
    nextMinutesAtPoll = doc["next"].isNull() ? -1 : doc["next"]["minutes_until"].as<long>();
    polledAt = millis();
    String key = doc["current"].isNull() ? String("") : doc["current"]["ends_at"].as<String>();
    if (key != bookingKey) { bookingKey = key; remind10 = remind5 = releaseSent = false; }
  } else if (status == 401) {
    statusLine1 = "Device not registered"; statusLine2 = "check ID / key";
  } else {
    statusLine1 = "Server unreachable"; statusLine2 = "HTTP " + String(status);
  }
  lastStatus = millis();
  draw();
}

// ================================================================== door ==
void openLock(unsigned long ms) {
  lockServo.write(OPEN_DEG);
  unlocked = true; doorWasOpened = false;
  unlockedAt = millis(); openMs = ms;
  digitalWrite(PIN_LED_OK, HIGH);
}

void closeLock() {
  lockServo.write(LOCKED_DEG);
  unlocked = false;
  digitalWrite(PIN_LED_OK, LOW);
  draw();
}

bool doorIsOpen() { return digitalRead(PIN_DOOR) == HIGH; }

void submitCode() {
  if (code.length() != 6) { showMessage("Enter 6 digits", "then press #"); beep(1, 400); return; }
  showMessage("Checking...", "");
  JsonDocument doc;
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"code\":\"" + code + "\"}";
  int status = request("POST", "/api/room/unlock", body, doc);
  code = "";

  if (status == 200 && doc["ok"].as<bool>()) {
    showMessage(doc["display"]["line1"].as<String>(), doc["display"]["line2"].as<String>());
    beep(1, 1200);
    openLock(doc["open_ms"] | 8000UL);
    // the early-release clock starts at check-in, not when the room last emptied
    if (room == ROOM_EMPTY) emptySince = millis();
    refreshStatus();            // the room is now IN USE
  } else if (status > 0 && !doc["display"].isNull()) {
    showMessage(doc["display"]["line1"].as<String>(), doc["display"]["line2"].as<String>());
    digitalWrite(PIN_LED_NO, HIGH); beep(2, 300); digitalWrite(PIN_LED_NO, LOW);
  } else {
    showMessage("Can't reach server", "Try again");
    digitalWrite(PIN_LED_NO, HIGH); beep(3, 300); digitalWrite(PIN_LED_NO, LOW);
  }
}

void watchDoor() {
  bool open = doorIsOpen();
  if (open != doorOpenLast) {
    doorOpenLast = open;
    if (open) {
      // opened while the lock was shut = forced entry (or opened from inside)
      report("door_open", String("{\"forced\":") + (unlocked ? "false" : "true") + "}");
      if (!unlocked) showMessage("Door opened", "without a code");
    } else {
      report("door_closed");
    }
  }
  // relock after the door has been opened and shut, or if nobody went in
  if (unlocked) {
    if (open) doorWasOpened = true;
    if (doorWasOpened && !open) { delay(800); closeLock(); }
    else if (!doorWasOpened && millis() - unlockedAt > openMs) closeLock();
  }
}

// ================================================================== room ==
void setRoom(RoomState next) {
  if (next == room) return;
  RoomState prev = room;
  room = next;
  unsigned long now = millis();
  if (next == ROOM_OCCUPIED && prev == ROOM_EMPTY) {
    emptySince = 0;
    report("presence_on", String("{\"y\":") + String(presence, 3) + "}");
  } else if (next == ROOM_WARNING) {
    warningSince = now;
    showMessage("No movement...", "Lights off soon");
  } else if (next == ROOM_EMPTY) {
    emptySince = now;
    report("presence_off", String("{\"y\":") + String(presence, 3) + "}");
  }
  // ROOM_WARNING -> ROOM_OCCUPIED: someone moved during the warning; nothing to report
}

void samplePresence() {
  unsigned long now = millis();
  if (now - lastSample < SAMPLE_MS) return;
  lastSample = now;

  bool people = digitalRead(PIN_PEOPLE) == LOW;
  bool pir = digitalRead(PIN_PIR) == HIGH;
  float eta = NOISE_MAX * analogRead(PIN_NOISE) / 4095.0f;

  int motion = (pir || (people && frand() < P_MOVE)) ? 1 : 0;
  int x = (frand() < eta) ? 1 - motion : motion;          // sensor noise
  presence = ALPHA * x + (1.0f - ALPHA) * presence;        // IIR low-pass

  switch (room) {
    case ROOM_EMPTY:
      if (presence > TH_ON) setRoom(ROOM_OCCUPIED);
      break;
    case ROOM_OCCUPIED:
      if (presence < TH_OFF) {
        if (!belowSince) belowSince = now;
        if (now - belowSince > VACANCY_MS) { belowSince = 0; setRoom(ROOM_WARNING); }
      } else {
        belowSince = 0;     // between the thresholds still counts as occupied
      }
      break;
    case ROOM_WARNING:
      if (presence > TH_ON) setRoom(ROOM_OCCUPIED);
      else if (now - warningSince > WARNING_MS) setRoom(ROOM_EMPTY);
      break;
  }

  if (LOG_SIGNAL)
    Serial.printf("sig,%lu,%d,%d,%.3f,%d\n", now, (people || pir) ? 1 : 0, x, presence, (int)room);
  draw();
}

void driveOutputs() {
  bool running = bookingState != "free";
  long toNext = minutesToNext();
  bool preCool = !running && toNext >= 0 && toNext <= PRECOOL_MIN;

  // lights follow people; AC follows bookings (cooling ahead, holding during
  // the check-in grace period, and only while someone is actually there)
  bool lightsWanted = room != ROOM_EMPTY;
  bool acWanted = preCool || (running && (room != ROOM_EMPTY || bookingState == "booked"));

  bool blinkOff = (room == ROOM_WARNING) && ((millis() / 400) % 2 == 0);
  digitalWrite(PIN_LIGHTS, (lightsWanted && !blinkOff) ? HIGH : LOW);
  digitalWrite(PIN_AC, acWanted ? HIGH : LOW);

  if (lightsWanted != lightsOn) { lightsOn = lightsWanted; report(lightsOn ? "lights_on" : "lights_off"); }
  if (acWanted != acOn) {
    acOn = acWanted;
    report(acOn ? "ac_on" : "ac_off", String("{\"precool\":") + (preCool ? "true" : "false") + "}");
  }
}

void scheduleTasks() {
  long left = minutesLeft();

  // end-of-booking reminders
  if (bookingState == "in_use" && left >= 0) {
    if (!remind10 && left <= 10 && left > 5) {
      remind10 = true;
      showMessage("10 minutes left", "Please wrap up soon");
      beep(2, 900);
      report("reminder", "{\"minutes_left\":10}");
    } else if (!remind5 && left <= 5 && left > 0) {
      remind5 = remind10 = true;
      showMessage("5 minutes left", "Booking ends soon");
      beep(3, 900);
      for (int i = 0; i < 3; i++) { digitalWrite(PIN_LIGHTS, LOW); delay(250); digitalWrite(PIN_LIGHTS, HIGH); delay(250); }
      report("reminder", "{\"minutes_left\":5}");
    }
  }

  // early release: checked in, then the room has been empty a long time
  if (bookingState == "in_use" && room == ROOM_EMPTY && emptySince && !releaseSent &&
      millis() - emptySince > EARLY_RELEASE_MS) {
    releaseSent = true;
    JsonDocument res;
    report("released_early", String("{\"empty_s\":") + ((millis() - emptySince) / 1000) + "}", res);
    if (res["released"].as<bool>()) {
      showMessage("Room released", String(res["freed_mins"].as<int>()) + " min freed");
      refreshStatus();
    }
  }
}

// ================================================================= setup ==
void setup() {
  Serial.begin(115200);
  pinMode(PIN_DOOR, INPUT_PULLUP);
  pinMode(PIN_PEOPLE, INPUT_PULLUP);
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_LED_OK, OUTPUT);
  pinMode(PIN_LED_NO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LIGHTS, OUTPUT);
  pinMode(PIN_AC, OUTPUT);
  analogReadResolution(12);

  lockServo.setPeriodHertz(50);
  lockServo.attach(PIN_SERVO, 500, 2400);
  lockServo.write(LOCKED_DEG);

  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("OLED not found");
  draw();

  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.println(" connected");

  doorOpenLast = doorIsOpen();
  emptySince = millis();
  if (LOG_SIGNAL) Serial.println("sig,ms,occupied,x,y,state");
  refreshStatus();
}

// ================================================================== loop ==
void loop() {
  char k = keypad.getKey();
  if (k && !unlocked) {
    if (k >= '0' && k <= '9' && code.length() < 6) code += k;
    else if (k == '*') code = "";
    else if (k == '#') submitCode();
    if (k != '#') buzz(900, 25);   // key click
    draw();
  }

  watchDoor();
  samplePresence();
  driveOutputs();
  scheduleTasks();

  if (millis() - lastStatus > STATUS_EVERY_MS) refreshStatus();
  if (msgUntil && millis() > msgUntil) { msgUntil = 0; draw(); }
  delay(5);
}
