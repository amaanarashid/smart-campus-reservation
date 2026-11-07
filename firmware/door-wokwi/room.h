// Campus Reserve room device: shared declarations.
// One firmware for every room. The server tells the device which parts the
// room has (config) and the device starts only those. See sketch.ino.
#pragma once
#include <Arduino.h>
#include <ArduinoJson.h>

#define FW_VERSION "2.0.0"

// ------------------------------------------------------------------ board --
// Picked at build time (platformio.ini). The server learns it from the device.
#if defined(BOARD_CAM)
  #define BOARD_NAME "esp32-cam"
  #define REAL_BOARD 1
#elif defined(BOARD_DEVKIT)
  #define BOARD_NAME "esp32-devkit"
  #define REAL_BOARD 1
#else
  #define BOARD_WOKWI 1
  #define BOARD_NAME "wokwi-door"
#endif

bool boardPinFree(int pin);       // board.cpp
bool boardPinInputOnly(int pin);
// shown before the room's setup arrives (pairing code); -1 = none
extern const int BOARD_SDA, BOARD_SCL, BOARD_STATUS_LED;
extern const bool BOARD_STATUS_ACTIVE_LOW;

// ----------------------------------------------------------------- config --
// The same keys as src/lib/room-config.ts. -1 = pin not used.
enum AcType { AC_NONE, AC_RELAY, AC_IR };
enum PartState { PART_OFF, PART_OK, PART_MISSING, PART_BAD_PINS };

struct RoomConfig {
  int version = 0;
  bool lock = false;     int pinServo = -1, pinDoor = -1;
  bool keypad = false;   uint8_t rows[4], cols[4];
  bool display = false;  int pinSda = -1, pinScl = -1;
  bool leds = false;     int pinLedOk = -1, pinLedNo = -1;
  bool buzzer = false;   int pinBuzzer = -1;
  bool presence = false; int pinPir = -1, pinPeople = -1;
  bool lights = false;   int pinLights = -1;
  AcType ac = AC_NONE;   int pinAcRelay = -1, pinIrTx = -1, pinIrRx = -1;
  String acProtocol = ""; int acModel = -1, acTemp = 24; String acMode = "cool", acFan = "auto";
  bool temperature = false; int pinTemp = -1;
  bool ring = false;     int pinRing = -1, ringPixels = 16;
  bool statusLed = false; int pinStatus = -1; bool statusActiveLow = false;
};
extern RoomConfig cfg;

// part names, as in the app, for the report
enum Part { P_LOCK, P_KEYPAD, P_DISPLAY, P_LEDS, P_BUZZER, P_PRESENCE, P_LIGHTS, P_AC, P_TEMP, P_RING, P_STATUS, P_COUNT };
extern const char *PART_NAMES[P_COUNT];
extern PartState partState[P_COUNT];

bool parseConfig(JsonVariantConst j, RoomConfig &out);   // config.cpp
void checkPins(RoomConfig &c);                           // marks bad parts PART_BAD_PINS and switches them off
bool loadSavedConfig(RoomConfig &out);
void saveConfig(JsonVariantConst j, int version);
bool useBakedConfig(RoomConfig &out);                    // the setup written into the firmware for a room
String bakedConfigJson();                                // pair.cpp

// -------------------------------------------------------------- identity --
extern String deviceKey, deviceId, keyHash;
extern String mqttHost, mqttUser, mqttPass;
extern int mqttPort;
extern const char *CONNECTION;
String loadKey();                 // pair.cpp
void pairDevice();                // blocks until an admin connects this device; fills cfg
void sendReport();
void checkConfigVersion(int serverVersion);

// ------------------------------------------------------------------- net --
extern const char *API_BASE;
void connectWifi();               // net.cpp
int request(const char *method, const String &path, const String &body, JsonDocument &out);
int report(const char *kind, const String &detailJson, JsonDocument &out);
void report(const char *kind, const String &detailJson = "null");
void refreshStatus();
extern unsigned long lastStatus;
extern const unsigned long STATUS_EVERY_MS;

// --------------------------------------------------------- booking state --
extern String bookingState;       // free | booked | in_use
extern long minutesLeftAtPoll, nextMinutesAtPoll, secsLeftAtPoll;
extern unsigned long polledAt;
extern String bookingKey;
extern bool canExtend;
long minutesLeft();
long minutesToNext();
long secsLeft();

// --------------------------------------------------------------- display --
extern String statusLine1, statusLine2;
void displayBegin(int sda, int scl);   // display.cpp
bool displayFound();
void draw();
void showMessage(const String &l1, const String &l2);
void drawSetup(const String &line1, const String &line2, const String &big = "");
extern unsigned long msgUntil;
extern String remoteLine1, remoteLine2;
extern unsigned long remoteMsgUntil;
void statusBlink(int pattern);    // for boards without a screen: 1 = Wi-Fi, 2 = waiting for an admin

// ------------------------------------------------------------------ door --
extern bool unlocked, lockdown, extendMode;
extern String code;
void doorBegin();                 // door.cpp
void doorLoop();
void openLock(unsigned long ms);
void closeLock();
void buzz(int freq, int ms);
void beep(int times, int freq);
void ledNo(bool on);

// ------------------------------------------------------------------ room --
enum RoomState { ROOM_EMPTY, ROOM_OCCUPIED, ROOM_WARNING };
extern RoomState room;
extern float presence;
extern bool lightsOn, acOn;
extern unsigned long emptySince;
extern const float TH_ON, TH_OFF;
extern const unsigned long WARNING_MS;
extern int lightsOverride, acOverride;
extern unsigned long lightsOverrideUntil, acOverrideUntil, lightsOffWarnUntil;
void roomBegin();                 // room.cpp
void roomLoop();
void blinkLights(int times, int ms);

// -------------------------------------------------------------- air-con --
void acBegin();                   // ac.cpp
void acLoop();
void acSet(bool on);              // drives the relay or sends the IR command
bool acLearnStart(const String &commandId, const String &slot, int secs, const char *via);
String acIrReport();              // JSON object for the device report
float roomTemperature();          // NAN if there is no sensor or no reading yet
void sensorsBegin();              // sensors.cpp
void sensorsLoop();
String i2cScanJson();

// ---------------------------------------------------------------- remote --
void remoteBegin();               // remote.cpp
void remoteLoop();
void handleCommand(const String &cmd, const String &sig, const char *via);
void ack(const String &id, bool ok, const char *via, const String &detailJson);
String toHex(const uint8_t *b, size_t n);
String sha256Hex(const String &s);
