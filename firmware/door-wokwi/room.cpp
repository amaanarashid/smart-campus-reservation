// The room: presence filter, lights and air-con, end-of-booking reminders,
// overstay, early release and the LED ring. Each part runs only if the room has it.
//
// Presence signal chain (every T = 200 ms):
//   x[n]  motion this sample: PIR, or the simulated occupants switch
//         (occupants only move in ~60% of samples, so x[n] is intermittent)
//   y[n] = a*x[n] + (1-a)*y[n-1], a = 0.10     first-order IIR low-pass,
//         time constant tau = -T/ln(1-a) = 1.9 s
//   hysteresis: EMPTY -> OCCUPIED when y > 0.35;
//               OCCUPIED -> WARNING when y < 0.08 for VACANCY_MS;
//               WARNING: lights blink, then EMPTY unless presence returns
// Without a motion sensor the room counts as occupied while a booking is in use.
#include "room.h"
#include <Adafruit_NeoPixel.h>

// --------------------------------------------------- presence filter tuning --
static const unsigned long SAMPLE_MS = 200;     // T
static const float ALPHA = 0.10f;               // tau = -T/ln(1-a) = 1.9 s
const float TH_ON  = 0.35f;                     // EMPTY -> OCCUPIED
const float TH_OFF = 0.08f;                     // below this counts as "no one moving"
static const float P_MOVE = 0.60f;              // simulated occupant shows motion in a sample
// CSV for the report (sig,ms,occupied,x,y,state, five lines a second). Off so the
// serial monitor stays readable; set true to capture the filter for a plot.
static const bool LOG_SIGNAL = false;

// --------------------------------------------- timings (demo vs real values) --
static const unsigned long VACANCY_MS       = 60000UL;   // demo 1 min   | real 10 min
const unsigned long WARNING_MS              = 10000UL;   // lights blink before switching off
static const unsigned long EARLY_RELEASE_MS = 120000UL;  // demo 2 min   | real 15 min
// overstay must outlast "people just left" (vacancy + warning)
static const unsigned long OVERSTAY_MS      = VACANCY_MS + WARNING_MS + 60000UL;
static const long COUNTDOWN_S = 600;                     // last 10 min
static const long PRECOOL_MIN = 5;                       // AC on this long before a booking

RoomState room = ROOM_EMPTY;
float presence = 0;                      // y[n]
static unsigned long lastSample = 0, belowSince = 0, warningSince = 0;
unsigned long emptySince = 0;
bool lightsOn = false, acOn = false;
int lightsOverride = -1, acOverride = -1; // -1 automatic, 0 forced off, 1 forced on
unsigned long lightsOverrideUntil = 0, acOverrideUntil = 0, lightsOffWarnUntil = 0;

static String remindedKey = "";
static bool remind10 = false, remind5 = false, releaseSent = false;
static String endedKey = "";
static unsigned long endedAt = 0;
static bool overstaySent = false;

static Adafruit_NeoPixel *ring = nullptr;
static unsigned long lastRing = 0;
static uint32_t ringShown = 0xFFFFFFFF;

static float frand() { return (float)(esp_random() % 10000) / 10000.0f; }
static bool someoneIn() { return cfg.presence ? room != ROOM_EMPTY : bookingState == "in_use"; }

void roomBegin() {
  if (cfg.presence) {
    pinMode(cfg.pinPir, INPUT);
    if (cfg.pinPeople >= 0) pinMode(cfg.pinPeople, INPUT_PULLUP);
  }
  if (cfg.lights) { pinMode(cfg.pinLights, OUTPUT); digitalWrite(cfg.pinLights, LOW); }
  if (cfg.ring) {
    ring = new Adafruit_NeoPixel(cfg.ringPixels, cfg.pinRing, NEO_GRB + NEO_KHZ800);
    ring->begin();
    ring->setBrightness(80);
    ring->clear();
    ring->show();
  }
  emptySince = millis();
  if (LOG_SIGNAL && cfg.presence) Serial.println("sig,ms,occupied,x,y,state");
}

void blinkLights(int times, int ms) {
  if (!cfg.lights) return;
  for (int i = 0; i < times; i++) {
    digitalWrite(cfg.pinLights, LOW); delay(ms); digitalWrite(cfg.pinLights, HIGH); delay(ms);
  }
}

static void setRoom(RoomState next) {
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
}

static void samplePresence() {
  unsigned long now = millis();
  if (now - lastSample < SAMPLE_MS) return;
  lastSample = now;

  bool people = cfg.pinPeople >= 0 && digitalRead(cfg.pinPeople) == LOW;
  bool pir = digitalRead(cfg.pinPir) == HIGH;
  int x = (pir || (people && frand() < P_MOVE)) ? 1 : 0;  // motion this sample
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

static void driveOutputs() {
  bool running = bookingState != "free";
  long toNext = minutesToNext();
  bool preCool = !running && toNext >= 0 && toNext <= PRECOOL_MIN;

  // lights follow people; AC follows bookings (cooling ahead, holding during
  // the check-in grace period, and only while someone is actually there)
  bool lightsWanted = someoneIn();
  bool acWanted = preCool || (running && (someoneIn() || bookingState == "booked"));

  // remote overrides win until they expire, then the room goes back to automatic
  unsigned long nowMs = millis();
  if (lightsOverride >= 0 && nowMs >= lightsOverrideUntil) { lightsOverride = -1; showMessage("Lights back to", "automatic"); }
  if (acOverride >= 0 && nowMs >= acOverrideUntil) { acOverride = -1; showMessage("Air-con back to", "automatic"); }
  bool offWarning = lightsOverride == 0 && nowMs < lightsOffWarnUntil;   // forced off, people inside: blink first
  if (lightsOverride >= 0) lightsWanted = offWarning || lightsOverride == 1;
  if (acOverride >= 0) acWanted = acOverride == 1;

  if (cfg.lights) {
    bool blinkOff = (room == ROOM_WARNING && (nowMs / 400) % 2 == 0) || (offWarning && (nowMs / 250) % 2 == 0);
    digitalWrite(cfg.pinLights, (lightsWanted && !blinkOff) ? HIGH : LOW);
    if (lightsWanted != lightsOn) { lightsOn = lightsWanted; report(lightsOn ? "lights_on" : "lights_off"); }
  }
  if (cfg.ac != AC_NONE && acWanted != acOn) {
    acOn = acWanted;
    acSet(acOn);
    report(acOn ? "ac_on" : "ac_off", String("{\"precool\":") + (preCool ? "true" : "false") + "}");
  }
}

// The booking's time is up. Re-check first: it may have been extended from
// the app in the last few seconds.
static void endOfBooking() {
  endedKey = bookingKey;                 // handle each booking's end once
  refreshStatus();
  if (bookingState == "in_use" && secsLeft() > 0) return;   // extended - carry on

  bool occupied = cfg.presence && room != ROOM_EMPTY;
  endedAt = occupied ? millis() : 0;     // only watch for overstay if someone is there
  overstaySent = false;
  showMessage("Time's up!", occupied ? "Please leave the room" : "Thank you");
  beep(4, 1200);
  if (occupied) blinkLights(3, 300);
  report("booking_ended", String("{\"occupied\":") + (occupied ? "true" : "false") + "}");
  // the air-con follows the booking, so driveOutputs() switches it off now
  // unless the next booking is about to start (pre-cooling)
}

// Ambient light for the last 10 minutes of a booking in use. Blue = can
// extend, red = cannot. Lit LEDs = share of the 10 minutes left, so the ring
// empties like a clock; in the final minute it pulses. Off at all other times.
static void updateRing() {
  unsigned long now = millis();
  if (now - lastRing < 50) return;       // 20 frames a second is plenty
  lastRing = now;
  int pixels = cfg.ringPixels;

  long s = secsLeft();
  bool show = bookingState == "in_use" && s >= 0 && s <= COUNTDOWN_S;
  uint8_t r = 0, g = 0, b = 0;
  int lit = 0;
  if (show) {
    lit = (int)((s * pixels + COUNTDOWN_S - 1) / COUNTDOWN_S);   // ceil
    if (lit < 1) lit = 1;
    float level = 1.0f;
    if (s <= 60) level = 0.35f + 0.65f * (0.5f + 0.5f * sinf(now / 180.0f));   // pulse
    if (canExtend) { r = 0;   g = (uint8_t)(70 * level); b = (uint8_t)(255 * level); }
    else           { r = (uint8_t)(255 * level); g = 0;  b = 0; }
  }
  uint32_t frame = ((uint32_t)lit << 24) | ((uint32_t)r << 16) | ((uint32_t)g << 8) | b;
  if (frame == ringShown) return;
  ringShown = frame;
  for (int i = 0; i < pixels; i++)
    ring->setPixelColor(i, i < lit ? ring->Color(r, g, b) : 0);
  ring->show();
}

static void scheduleTasks() {
  long left = minutesLeft();
  if (bookingKey != remindedKey) { remindedKey = bookingKey; remind10 = remind5 = releaseSent = false; }
  const char *how = cfg.keypad ? "A = extend +30 min" : "Extend in the app";

  // end-of-booking reminders
  if (bookingState == "in_use" && left >= 0) {
    if (!remind10 && left <= 10 && left > 5) {
      remind10 = true;
      showMessage("10 minutes left", how);
      beep(2, 900);
      report("reminder", "{\"minutes_left\":10}");
    } else if (!remind5 && left <= 5 && left > 0) {
      remind5 = remind10 = true;
      showMessage("5 minutes left", how);
      beep(3, 900);
      if (lightsOn) blinkLights(3, 250);
      report("reminder", "{\"minutes_left\":5}");
    }
  }

  // end of booking: the countdown reached zero
  if (bookingState == "in_use" && secsLeftAtPoll >= 0 && secsLeft() <= 0 && endedKey != bookingKey) endOfBooking();

  if (!cfg.presence) return;   // overstay and early release need to know if anyone is there

  // overstay: the booking ended but the room is still occupied
  if (endedAt) {
    if (room == ROOM_EMPTY || bookingState == "in_use") {
      endedAt = 0;              // they left, or the next group has checked in
    } else if (!overstaySent && millis() - endedAt > OVERSTAY_MS) {
      overstaySent = true;
      unsigned long over = (millis() - endedAt) / 1000;
      report("overstay", String("{\"seconds_over\":") + over + "}");
      showMessage("Booking has ended", "Please leave now");
      ledNo(true); beep(3, 600); ledNo(false);
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

void roomLoop() {
  if (cfg.presence) samplePresence();
  driveOutputs();
  scheduleTasks();
  if (ring) updateRing();
}
