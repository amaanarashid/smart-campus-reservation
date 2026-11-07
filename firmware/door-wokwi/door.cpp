// The door: servo lock, door switch, keypad check-in and extension, the green
// and red lights and the buzzer. Each part runs only if the room has it.
#include "room.h"
#include <Keypad.h>
#include <ESP32Servo.h>

static char KEYS[4][4] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'},
};
static Keypad *keypad = nullptr;
static Servo lockServo;
static const int LOCKED_DEG = 0, OPEN_DEG = 90;

String code = "";
bool unlocked = false, lockdown = false, extendMode = false;
static bool doorWasOpened = false, doorOpenLast = false;
static unsigned long unlockedAt = 0, openMs = 8000;

void doorBegin() {
  if (cfg.leds) { pinMode(cfg.pinLedOk, OUTPUT); pinMode(cfg.pinLedNo, OUTPUT); }
  if (cfg.buzzer) pinMode(cfg.pinBuzzer, OUTPUT);
  if (cfg.lock) {
    pinMode(cfg.pinDoor, INPUT_PULLUP);
    lockServo.setPeriodHertz(50);
    lockServo.attach(cfg.pinServo, 500, 2400);
    lockServo.write(LOCKED_DEG);
    doorOpenLast = digitalRead(cfg.pinDoor) == HIGH;
  }
  if (cfg.keypad) keypad = new Keypad(makeKeymap(KEYS), cfg.rows, cfg.cols, 4, 4);
}

void ledNo(bool on) { if (cfg.leds) digitalWrite(cfg.pinLedNo, on ? HIGH : LOW); }
static void ledOk(bool on) { if (cfg.leds) digitalWrite(cfg.pinLedOk, on ? HIGH : LOW); }

// Square wave on the buzzer pin, bit-banged. Deliberately not tone(): tone()
// and ESP32Servo both use the LEDC PWM timers and can fight over them.
void buzz(int freq, int ms) {
  if (!cfg.buzzer) return;
  const unsigned long halfPeriod = 500000UL / freq;
  const unsigned long until = millis() + ms;
  while (millis() < until) {
    digitalWrite(cfg.pinBuzzer, HIGH); delayMicroseconds(halfPeriod);
    digitalWrite(cfg.pinBuzzer, LOW);  delayMicroseconds(halfPeriod);
  }
}

void beep(int times, int freq) {
  if (!cfg.buzzer) return;
  for (int i = 0; i < times; i++) { buzz(freq, 120); delay(60); }
}

void openLock(unsigned long ms) {
  if (!cfg.lock) return;
  lockServo.write(OPEN_DEG);
  unlocked = true; doorWasOpened = false;
  unlockedAt = millis(); openMs = ms;
  ledOk(true);
}

void closeLock() {
  if (!cfg.lock) return;
  lockServo.write(LOCKED_DEG);
  unlocked = false;
  ledOk(false);
  draw();
}

static bool doorIsOpen() { return digitalRead(cfg.pinDoor) == HIGH; }

static void refused(int beeps) { ledNo(true); beep(beeps, 300); ledNo(false); }

static void submitCode() {
  if (code.length() != 6) { showMessage("Enter 6 digits", "then press #"); beep(1, 400); return; }
  showMessage("Checking...", "");
  JsonDocument doc;
  String body = String("{\"device_id\":\"") + deviceId + "\",\"code\":\"" + code + "\"}";
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
    refused(2);
  } else {
    showMessage("Can't reach server", "Try again");
    refused(3);
  }
}

// A + code + #: ask the server for 30 more minutes on the booking in use.
// The code proves it is the booking's own group asking.
static void submitExtend() {
  extendMode = false;
  if (code.length() != 6) { code = ""; showMessage("Enter 6 digits", "Press A to retry"); beep(1, 400); return; }
  showMessage("Extending...", "");
  JsonDocument doc;
  String body = String("{\"device_id\":\"") + deviceId + "\",\"code\":\"" + code + "\"}";
  int status = request("POST", "/api/room/extend", body, doc);
  code = "";
  if (status == 200 && doc["ok"].as<bool>()) {
    showMessage(doc["display"]["line1"].as<String>(), doc["display"]["line2"].as<String>());
    beep(2, 1400);
    refreshStatus();            // new end time -> reminders and countdown reset
  } else if (status > 0 && !doc["display"].isNull()) {
    showMessage(doc["display"]["line1"].as<String>(), doc["display"]["line2"].as<String>());
    refused(2);
  } else {
    showMessage("Can't reach server", "Use the app");
    refused(3);
  }
}

static void readKeypad() {
  char k = keypad->getKey();
  if (k && lockdown) { showMessage("Keypad disabled", "Contact staff"); beep(1, 300); k = 0; }
  if (!k || unlocked) return;
  if (k >= '0' && k <= '9' && code.length() < 6) code += k;
  else if (k == '*') {
    if (code.length() == 0 && extendMode) { extendMode = false; showMessage("Cancelled", ""); }
    code = "";
  }
  else if (k == 'A') {
    code = "";
    if (bookingState == "in_use") { extendMode = true; showMessage("Extend +30 min", "Enter code, then #"); }
    else showMessage("Nothing to extend", "No booking in use");
  }
  else if (k == '#') { if (extendMode) submitExtend(); else submitCode(); }
  if (k != '#') buzz(900, 25);   // key click
  draw();
}

static void watchDoor() {
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

void doorLoop() {
  if (keypad) readKeypad();
  if (cfg.lock) watchDoor();
}
