// Temperature (DHT22) and a scan of the I2C bus for the device report.
#include "room.h"
#include <Wire.h>
#include <DHT.h>

static DHT *dht = nullptr;
static float lastTemp = NAN, lastHum = NAN;
static unsigned long lastRead = 0, lastSent = 0;
static int failures = 0;
static const unsigned long READ_MS = 10000;          // DHT22 needs 2 s between reads
static const unsigned long SEND_MS = 5UL * 60000UL;   // a reading for the server every 5 min

void sensorsBegin() {
  if (!cfg.temperature) return;
  dht = new DHT(cfg.pinTemp, DHT22);
  dht->begin();
  delay(2100);
  lastTemp = dht->readTemperature();
  lastHum = dht->readHumidity();
  lastRead = millis();
  if (isnan(lastTemp)) partState[P_TEMP] = PART_MISSING;
}

float roomTemperature() { return lastTemp; }

void sensorsLoop() {
  if (!dht || millis() - lastRead < READ_MS) return;
  lastRead = millis();
  float t = dht->readTemperature(), h = dht->readHumidity();
  if (isnan(t)) {
    if (++failures == 3) { lastTemp = NAN; Serial.println("Temperature sensor not answering"); }
    return;
  }
  failures = 0;
  lastTemp = t; lastHum = h;
  if (lastSent == 0 || millis() - lastSent > SEND_MS) {
    lastSent = millis();
    report("temperature", String("{\"c\":") + String(t, 1) + (isnan(h) ? "" : String(",\"rh\":") + String(h, 0)) + "}");
  }
}

// Addresses that answer on the I2C bus (0x3C = the screen). Only when a screen
// is set up, because that is what starts the bus.
String i2cScanJson() {
  if (!cfg.display) return "[]";
  String out = "[";
  for (uint8_t a = 1; a < 127; a++) {
    Wire.beginTransmission(a);
    if (Wire.endTransmission() == 0) { if (out.length() > 1) out += ","; out += a; }
  }
  return out + "]";
}
