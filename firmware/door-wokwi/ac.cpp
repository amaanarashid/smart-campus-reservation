// Air-con: a relay (on/off), or an IR LED that copies the AC's own remote.
//
// IR knows most makes through IRremoteESP8266 (power, temperature, mode, fan).
// LEARN: an admin presses Learn in the app and points the AC's remote at the
// IR receiver. A known make is recognised from one press (and the app saves
// it); an unknown one is recorded as it is ("RAW", on and off separately) and
// replayed, which only gives the exact states that were recorded.
//
// IR is one-way: the device never hears back from the AC. With a temperature
// sensor it checks: if the room is not cooling some minutes after "on", it
// sends again once, and then tells the server the AC may not have responded.
#include "room.h"
#include <Preferences.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include <IRrecv.h>
#include <IRac.h>
#include <IRutils.h>

static IRac *irac = nullptr;
static IRsend *irsend = nullptr;
static IRrecv *irrecv = nullptr;
static Preferences irStore;
static bool rawOn = false, rawOff = false;          // learned signals kept in flash

static const unsigned long AC_CHECK_MS = 6UL * 60000UL;   // demo 6 min | real 10 min
static unsigned long acOnAt = 0;
static float tempAtOn = NAN;
static bool resent = false, noResponseSent = false;

static bool learning = false;
static String learnId = "", learnSlot = "on", learnVia = "mqtt";
static unsigned long learnUntil = 0;

static const uint16_t RAW_MAX = 1000;               // entries; AC frames are a few hundred

static bool rawStored(const char *slot) {
  irStore.begin("ir", false);       // read-write: creates it on a first start (no NOT_FOUND error)
  size_t n = irStore.getBytesLength(slot);
  irStore.end();
  return n > 0;
}

void acBegin() {
  if (cfg.ac == AC_RELAY) { pinMode(cfg.pinAcRelay, OUTPUT); digitalWrite(cfg.pinAcRelay, LOW); }
  if (cfg.ac != AC_IR) return;
  irac = new IRac(cfg.pinIrTx);
  irsend = new IRsend(cfg.pinIrTx);
  irsend->begin();
  if (cfg.pinIrRx >= 0) {
    irrecv = new IRrecv(cfg.pinIrRx, 1024, 50, true);   // 50 ms gap: AC frames are long
    irrecv->setUnknownThreshold(12);
  }
  rawOn = rawStored("on");
  rawOff = rawStored("off");
}

static bool sendRaw(const char *slot) {
  irStore.begin("ir", false);       // read-write: creates it on a first start (no NOT_FOUND error)
  size_t bytes = irStore.getBytesLength(slot);
  if (bytes == 0 || bytes > RAW_MAX * 2) { irStore.end(); return false; }
  uint16_t *buf = new uint16_t[bytes / 2];
  irStore.getBytes(slot, buf, bytes);
  irStore.end();
  irsend->sendRaw(buf, bytes / 2, 38);
  delete[] buf;
  return true;
}

static bool sendIr(bool on) {
  if (cfg.acProtocol == "RAW") return sendRaw(on ? "on" : "off");
  decode_type_t proto = strToDecodeType(cfg.acProtocol.c_str());
  if (proto == decode_type_t::UNKNOWN || !IRac::isProtocolSupported(proto)) {
    Serial.println("Air-con make not set: use Learn in the app");
    return false;
  }
  irac->next.protocol = proto;
  irac->next.model = cfg.acModel;
  irac->next.power = on;
  irac->next.mode = IRac::strToOpmode(cfg.acMode.c_str(), stdAc::opmode_t::kCool);
  irac->next.celsius = true;
  irac->next.degrees = cfg.acTemp;
  irac->next.fanspeed = IRac::strToFanspeed(cfg.acFan.c_str(), stdAc::fanspeed_t::kAuto);
  return irac->sendAc();
}

void acSet(bool on) {
  if (cfg.ac == AC_RELAY) digitalWrite(cfg.pinAcRelay, on ? HIGH : LOW);
  else if (cfg.ac == AC_IR && !learning) {
    bool sent = sendIr(on);
    Serial.printf("IR air-con %s: %s\n", on ? "on" : "off", sent ? "sent" : "not sent");
  }
  if (on) { acOnAt = millis(); tempAtOn = roomTemperature(); resent = false; noResponseSent = false; }
  else acOnAt = 0;
}

// ------------------------------------------------------------------ learn --
bool acLearnStart(const String &commandId, const String &slot, int secs, const char *via) {
  if (cfg.ac != AC_IR || !irrecv) return false;
  learning = true;
  learnId = commandId;
  learnSlot = slot == "off" ? "off" : "on";
  learnVia = via;
  learnUntil = millis() + (unsigned long)constrain(secs, 10, 60) * 1000UL;
  irrecv->enableIRIn();
  showMessage("Point the AC remote here", learnSlot == "off" ? "and press OFF" : "and press ON");
  beep(1, 1200);
  Serial.printf("IR learn: press %s on the AC remote\n", learnSlot.c_str());
  return true;
}

static void learnDone(bool ok, const String &detail) {
  learning = false;
  irrecv->disableIRIn();
  if (ok) report("ir_learned", detail);
  ack(learnId, ok, learnVia.c_str(), detail);
  showMessage(ok ? "Remote learned" : "Nothing heard", ok ? "" : "Try again from the app");
  beep(ok ? 2 : 1, ok ? 1400 : 400);
}

static void learnLoop() {
  if (millis() > learnUntil) { learnDone(false, "{\"error\":\"no signal\"}"); return; }
  decode_results res;
  if (!irrecv->decode(&res)) return;
  if (res.overflow || res.rawlen < 20) { irrecv->resume(); return; }   // noise or a cut-off frame

  JsonDocument d;
  decode_type_t t = res.decode_type;
  if (t != decode_type_t::UNKNOWN && IRac::isProtocolSupported(t)) {
    stdAc::state_t st;
    bool got = IRAcUtils::decodeToState(&res, &st);
    cfg.acProtocol = typeToString(t);
    cfg.acModel = got ? st.model : -1;
    d["protocol"] = cfg.acProtocol;
    d["model"] = cfg.acModel;
    if (got) {
      d["power"] = st.power;
      d["temp"] = (int)st.degrees;
      d["mode"] = IRac::opmodeToString(st.mode);
    }
  } else {
    uint16_t len = getCorrectedRawLength(&res);
    if (len == 0 || len > RAW_MAX) { irrecv->resume(); return; }
    uint16_t *raw = resultToRawArray(&res);
    irStore.begin("ir", false);
    irStore.putBytes(learnSlot.c_str(), raw, len * 2);
    irStore.end();
    delete[] raw;
    if (learnSlot == "on") rawOn = true; else rawOff = true;
    d["protocol"] = "RAW";
    d["slot"] = learnSlot;
    d["length"] = len;
    d["heard"] = typeToString(t);
    d["raw_on"] = rawOn;
    d["raw_off"] = rawOff;
    if (rawOn && rawOff) cfg.acProtocol = "RAW";
  }
  String detail;
  serializeJson(d, detail);
  Serial.println("IR learned: " + detail);
  learnDone(true, detail);
}

// ------------------------------------------------------------------- loop --
void acLoop() {
  if (learning) { learnLoop(); return; }
  if (!acOn || acOnAt == 0 || isnan(tempAtOn)) return;
  float t = roomTemperature();
  if (isnan(t)) return;
  bool notCooling = t > tempAtOn - 0.5f && t > cfg.acTemp + 1.0f;
  unsigned long on = millis() - acOnAt;
  if (!notCooling) return;
  if (!resent && on > AC_CHECK_MS) {
    resent = true;
    Serial.println("Room not cooling: sending air-con on again");
    if (cfg.ac == AC_IR) sendIr(true);
  } else if (!noResponseSent && on > 2 * AC_CHECK_MS) {
    noResponseSent = true;
    report("ac_no_response", String("{\"temp_start\":") + String(tempAtOn, 1) + ",\"temp_now\":" +
           String(t, 1) + ",\"mins\":" + (on / 60000UL) + "}");
    showMessage("Air-con not cooling", "Staff notified");
  }
}

String acIrReport() {
  if (cfg.ac != AC_IR) return "{}";
  JsonDocument d;
  if (cfg.acProtocol.length()) d["protocol"] = cfg.acProtocol;
  if (cfg.acModel >= 0) d["model"] = cfg.acModel;
  if (rawOn) d["raw_on"] = true;
  if (rawOff) d["raw_off"] = true;
  String out;
  serializeJson(d, out);
  return out;
}
