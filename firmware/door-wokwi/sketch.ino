/*
 * Campus Reserve - smart room device (ESP32: Wokwi, DevKit or ESP32-CAM)
 *
 * One firmware for every room. The board is picked at build time
 * (platformio.ini); everything else comes from the server:
 *
 * CONNECT   Until an admin connects it, the device shows a 6-digit code (on
 *           its screen, or over USB) to type into Admin -> Smart room. The
 *           server then sends the device id, the MQTT login and the ROOM SETUP:
 *           which parts the room has and on which pins (pair.cpp, config.cpp).
 *           A change in the app reaches the device on its next status poll; it
 *           saves the setup and restarts with it.
 *
 * PARTS     door.cpp     servo lock, door switch, keypad check-in / extend,
 *                        green + red lights, buzzer
 *           display.cpp  OLED screen (or the status LED on boards without one)
 *           room.cpp     presence filter, lights, air-con rules, reminders,
 *                        end of booking, overstay, early release, LED ring
 *           ac.cpp       air-con by relay or IR (with learning the remote)
 *           sensors.cpp  temperature (DHT22), I2C scan
 *           remote.cpp   signed MQTT commands
 *           net.cpp      Wi-Fi, HTTPS to the app, the status poll
 *
 * Control runs HERE, not on the server, so the room keeps working if the
 * network drops; the server is told what happened, and only the server
 * changes bookings.
 *
 * Controls in the Wokwi simulation:
 *   keypad        0-9 code, * clear, # submit, A extend the booking in use
 *   DOOR switch   door closed / open
 *   PEOPLE switch simulated occupants (they fidget, so motion is intermittent)
 *   PIR sensor    click it to simulate a single movement
 *   LED ring      ambient end-of-booking light (output)
 */
#include "room.h"
#include <time.h>

void setup() {
  Serial.begin(115200);
  delay(50);
  Serial.printf("\nCampus Reserve room device %s on %s\n", FW_VERSION, BOARD_NAME);

  // the setup written into this firmware for its room (first start after an
  // install), else the last setup it ran: the parts work before the network does
  bool saved = useBakedConfig(cfg) || loadSavedConfig(cfg);
  if (saved) checkPins(cfg);
  if (saved && cfg.display) displayBegin(cfg.pinSda, cfg.pinScl);
  else displayBegin(BOARD_SDA, BOARD_SCL);

  connectWifi();
  configTime(0, 0, "pool.ntp.org", "time.google.com");   // real time, to reject expired commands

  deviceKey = loadKey();
  drawSetup("Connecting...", "");
  pairDevice();                          // returns once an admin has connected this device; sets cfg

  checkPins(cfg);                        // parts with pins this board can't give are left off
  if (cfg.display && !displayFound()) partState[P_DISPLAY] = PART_MISSING;
  doorBegin();
  roomBegin();
  acBegin();
  sensorsBegin();
  remoteBegin();
  sendReport();                          // what works, for Admin -> Smart room
  refreshStatus();
}

void loop() {
  doorLoop();
  remoteLoop();
  roomLoop();
  acLoop();
  sensorsLoop();
  if (millis() - lastStatus > STATUS_EVERY_MS) refreshStatus();
  if (msgUntil && millis() > msgUntil) { msgUntil = 0; draw(); }
  delay(5);
}
