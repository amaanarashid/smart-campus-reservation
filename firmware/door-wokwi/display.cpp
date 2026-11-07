// The door screen (SSD1306 128x64 OLED), and the status LED for boards without one.
#include "room.h"
#include <WiFi.h>
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <PubSubClient.h>

static Adafruit_SSD1306 oled(128, 64, &Wire, -1);
static bool screen = false;              // a screen was found and started
String statusLine1 = "Connecting...", statusLine2 = "";
static String msgLine1 = "", msgLine2 = "";
unsigned long msgUntil = 0;
String remoteLine1 = "", remoteLine2 = "";
unsigned long remoteMsgUntil = 0;
static const unsigned long MESSAGE_MS = 3500;
static const long COUNTDOWN_S = 600;
extern PubSubClient mqtt;

void displayBegin(int sda, int scl) {
  if (sda < 0 || scl < 0) return;
  Wire.begin(sda, scl);
  screen = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C);
  if (!screen) Serial.println("Screen not found");
}

bool displayFound() { return screen; }

void draw() {
  if (!screen || !cfg.display) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);

  bool showMsg = millis() < msgUntil;
  long s = secsLeft();
  bool countdown = !showMsg && bookingState == "in_use" && s >= 0 && s <= COUNTDOWN_S;
  bool remoteMsg = !showMsg && !countdown && millis() < remoteMsgUntil;
  oled.setCursor(0, 0);
  if (lockdown && !showMsg) {
    oled.println("LOCKED DOWN");
    oled.setCursor(0, 11);
    oled.println("Contact staff");
  } else if (remoteMsg) {
    oled.println(remoteLine1);
    oled.setCursor(0, 11);
    oled.println(remoteLine2);
  } else if (countdown) {
    char buf[22];
    snprintf(buf, sizeof(buf), "ENDS IN %ld:%02ld", s / 60, s % 60);
    oled.println(buf);
  } else {
    oled.println(showMsg ? msgLine1 : statusLine1);
  }
  if (!(lockdown && !showMsg) && !remoteMsg) {
    oled.setCursor(0, 11);
    oled.println(countdown && cfg.keypad ? String("A = extend +30 min") : (showMsg ? msgLine2 : statusLine2));
  }
  oled.drawLine(0, 22, 127, 22, SSD1306_WHITE);

  if (cfg.lock && unlocked) {
    oled.setTextSize(2);
    oled.setCursor(0, 28);
    oled.println("OPEN");
  } else if (cfg.keypad) {
    oled.setCursor(0, 31);
    oled.print(extendMode ? "Ext: " : "Code:");
    oled.setTextSize(2);
    oled.setCursor(34, 28);
    for (int i = 0; i < 6; i++) oled.print(i < (int)code.length() ? '*' : '_');
  } else {
    float t = roomTemperature();
    if (!isnan(t)) {
      oled.setTextSize(2);
      oled.setCursor(0, 28);
      oled.printf("%.1f C", t);
    }
  }

  // footer: presence bar with the two thresholds, then lights / AC indicators
  oled.setTextSize(1);
  if (cfg.presence) {
    oled.setCursor(0, 55);
    oled.print("P");
    const int bx = 8, bw = 64, by = 55, bh = 8;
    oled.drawRect(bx, by, bw, bh, SSD1306_WHITE);
    oled.fillRect(bx, by, (int)(presence * bw), bh, SSD1306_WHITE);
    oled.drawLine(bx + (int)(TH_ON * bw), by - 2, bx + (int)(TH_ON * bw), by + bh + 1, SSD1306_WHITE);
    oled.drawLine(bx + (int)(TH_OFF * bw), by - 2, bx + (int)(TH_OFF * bw), by + bh + 1, SSD1306_WHITE);
  }
  if (cfg.lights) {
    oled.setCursor(78, 55); oled.print("L");
    if (lightsOn) oled.fillRect(85, 55, 8, 8, SSD1306_WHITE); else oled.drawRect(85, 55, 8, 8, SSD1306_WHITE);
  }
  if (cfg.ac != AC_NONE) {
    oled.setCursor(98, 55); oled.print("A");
    if (acOn) oled.fillRect(105, 55, 8, 8, SSD1306_WHITE); else oled.drawRect(105, 55, 8, 8, SSD1306_WHITE);
  }
  oled.setCursor(118, 55);
  if (WiFi.status() != WL_CONNECTED) oled.print("!");
  else if (mqtt.connected()) oled.print("M");   // remote control link up
  oled.display();
}

void showMessage(const String &l1, const String &l2) {
  msgLine1 = l1; msgLine2 = l2; msgUntil = millis() + MESSAGE_MS;
  if (!screen) Serial.println("screen: " + l1 + (l2.length() ? " / " + l2 : ""));
  draw();
}

// Before the room's setup has arrived (connecting, pairing code), or in place
// of a screen: the same text goes to the serial monitor.
void drawSetup(const String &line1, const String &line2, const String &big) {
  static String last = "";
  String now = line1 + "|" + line2 + "|" + big;
  if (now != last) {
    last = now;
    Serial.println(line1 + (line2.length() ? " / " + line2 : "") + (big.length() ? " / " + big : ""));
  }
  if (!screen) return;
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(1);
  oled.setCursor(0, 0);
  oled.println(line1);
  oled.setCursor(0, 11);
  oled.println(line2);
  if (big.length()) {
    oled.drawLine(0, 22, 127, 22, SSD1306_WHITE);
    oled.setTextSize(2);
    oled.setCursor((128 - (int)big.length() * 12) / 2, 34);
    oled.println(big);
  }
  oled.display();
}

// A board without a screen says what it is doing with its LED:
// 1 short blink = joining Wi-Fi, 2 blinks = waiting for an admin to connect it.
void statusBlink(int pattern) {
  int pin = cfg.statusLed ? cfg.pinStatus : BOARD_STATUS_LED;
  bool activeLow = cfg.statusLed ? cfg.statusActiveLow : BOARD_STATUS_ACTIVE_LOW;
  if (pin < 0 || screen) return;
  pinMode(pin, OUTPUT);
  for (int i = 0; i < pattern; i++) {
    digitalWrite(pin, activeLow ? LOW : HIGH); delay(80);
    digitalWrite(pin, activeLow ? HIGH : LOW); delay(150);
  }
}
