/*
 * Campus Reserve - smart room door (Wokwi simulation, ESP32)
 *
 * Keypad code entry -> Vercel checks the code against the booking running now
 * -> servo "lock" opens, the booking is checked in, and the auto-release job
 * therefore leaves it alone. The lock closes again once the door has been
 * opened and shut, or after a few seconds if nobody goes in.
 *
 * The OLED shows the room's state (FREE / BOOKED - enter code / IN USE),
 * refreshed from the server every 30 seconds.
 *
 * Keypad:  0-9 enter code   * clear   # submit
 * Door:    slide switch     one side = closed, other side = open
 *
 * Fill in the three CONFIG values below, then press the green play button.
 * See README.md in this folder for the one-time setup.
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
const char *API_BASE   = "https://YOUR-APP.vercel.app";          // no trailing slash
const char *DEVICE_ID  = "00000000-0000-0000-0000-000000000000";  // from register_room_device()
const char *DEVICE_KEY = "CHANGE-ME-same-key-you-registered";

const char *WIFI_SSID = "Wokwi-GUEST";   // Wokwi's simulated internet access
const char *WIFI_PASS = "";

// -------------------------------------------------------------------- pins --
const int PIN_SERVO  = 18;
const int PIN_DOOR   = 4;    // slide switch, INPUT_PULLUP: LOW = closed
const int PIN_LED_OK = 23;
const int PIN_LED_NO = 19;
const int PIN_BUZZER = 5;

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

// ------------------------------------------------------------------ timing --
const unsigned long STATUS_EVERY_MS = 30000;
const unsigned long MESSAGE_MS      = 3500;   // how long a result stays on screen
const int LOCKED_DEG = 0, OPEN_DEG = 90;

// ------------------------------------------------------------------ objects --
Keypad keypad = Keypad(makeKeymap(KEYS), ROW_PINS, COL_PINS, ROWS, COLS);
Adafruit_SSD1306 oled(128, 64, &Wire, -1);
Servo lockServo;

// -------------------------------------------------------------------- state --
String code = "";
String statusLine1 = "Connecting...", statusLine2 = "";
String msgLine1 = "", msgLine2 = "";
unsigned long msgUntil = 0, lastStatus = 0;

bool unlocked = false, doorWasOpened = false;
unsigned long unlockedAt = 0, openMs = 8000;

// ================================================================ display ==
void draw() {
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);

  bool showMsg = millis() < msgUntil;
  oled.setCursor(0, 0);
  oled.println(showMsg ? msgLine1 : statusLine1);
  oled.setCursor(0, 12);
  oled.println(showMsg ? msgLine2 : statusLine2);
  oled.drawLine(0, 26, 127, 26, SSD1306_WHITE);

  oled.setCursor(0, 34);
  if (unlocked) {
    oled.setTextSize(2);
    oled.println("OPEN");
  } else {
    oled.print("Code: ");
    oled.setTextSize(2);
    oled.setCursor(36, 32);
    for (int i = 0; i < 6; i++) oled.print(i < (int)code.length() ? '*' : '_');
  }
  oled.setTextSize(1);
  oled.setCursor(0, 56);
  oled.print(WiFi.status() == WL_CONNECTED ? "* clear   # enter" : "OFFLINE");
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

void refreshStatus() {
  JsonDocument doc;
  int status = request("GET", String("/api/room/status?device_id=") + DEVICE_ID, "", doc);
  if (status == 200 && doc["ok"].as<bool>()) {
    statusLine1 = doc["display"]["line1"].as<String>();
    statusLine2 = doc["display"]["line2"].as<String>();
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
    refreshStatus();            // the room is now IN USE
  } else if (status > 0 && !doc["display"].isNull()) {
    showMessage(doc["display"]["line1"].as<String>(), doc["display"]["line2"].as<String>());
    digitalWrite(PIN_LED_NO, HIGH); beep(2, 300); digitalWrite(PIN_LED_NO, LOW);
  } else {
    showMessage("Can't reach server", "Try again");
    digitalWrite(PIN_LED_NO, HIGH); beep(3, 300); digitalWrite(PIN_LED_NO, LOW);
  }
}

// ================================================================= setup ==
void setup() {
  Serial.begin(115200);
  pinMode(PIN_DOOR, INPUT_PULLUP);
  pinMode(PIN_LED_OK, OUTPUT);
  pinMode(PIN_LED_NO, OUTPUT);
  pinMode(PIN_BUZZER, OUTPUT);

  lockServo.setPeriodHertz(50);
  lockServo.attach(PIN_SERVO, 500, 2400);
  lockServo.write(LOCKED_DEG);

  if (!oled.begin(SSD1306_SWITCHCAPVCC, 0x3C)) Serial.println("OLED not found");
  draw();

  WiFi.begin(WIFI_SSID, WIFI_PASS, 6);
  Serial.print("WiFi");
  while (WiFi.status() != WL_CONNECTED) { delay(250); Serial.print("."); }
  Serial.println(" connected");
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

  // relock: after the door has been opened and shut again, or if nobody
  // opened it within open_ms
  if (unlocked) {
    if (doorIsOpen()) doorWasOpened = true;
    if (doorWasOpened && !doorIsOpen()) { delay(800); closeLock(); }
    else if (!doorWasOpened && millis() - unlockedAt > openMs) closeLock();
  }

  if (millis() - lastStatus > STATUS_EVERY_MS) refreshStatus();
  if (msgUntil && millis() > msgUntil) { msgUntil = 0; draw(); }
  delay(10);
}
