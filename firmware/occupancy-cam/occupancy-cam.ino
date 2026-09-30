/*
 * Campus Reserve - room occupancy sensor
 * Board: AI-Thinker ESP32-CAM (OV2640)
 *
 * The camera is used as a motion sensor, not a camera. Every frame is reduced
 * on-device to a single number and then discarded. No image is buffered to
 * flash, written to SD, or transmitted. The only thing that leaves this board
 * is a motion-energy figure and an occupied/vacant flag.
 *
 * Signal chain
 *   1. capture   grayscale QQVGA 160x120 every T ms
 *   2. decimate  4x box average -> 40x30, anti-aliasing plus noise reduction
 *   3. metric    m[n] = (1/N) * sum |f[n] - f[n-1]|      frame differencing
 *   4. filter    y[n] = a*m[n] + (1-a)*y[n-1]            first-order IIR low-pass
 *                  time constant  tau = -T / ln(1-a)
 *                  cutoff         fc  ~ a / (2*pi*T)     for small a
 *   5. threshold Schmitt trigger: vacant->occupied at T_HIGH,
 *                                 occupied->vacant at T_LOW,  T_LOW < T_HIGH
 *   6. dwell     candidate state must persist DWELL_S before it is published
 *   7. publish   POST on state change, plus a heartbeat every HEARTBEAT_S
 *
 * Flashing an ESP32-CAM: it has no USB. Wire a USB-to-TTL adapter -
 *   5V->5V, GND->GND, U0T->RX, U0R->TX, and jumper GPIO0 to GND to enter
 *   bootloader. Remove the jumper and press RESET to run.
 *   Board: "AI Thinker ESP32-CAM".  Partition: "Huge APP".
 *
 * Set SERIAL_PLOT to 1 to stream raw and filtered values to the Serial
 * Plotter. That is how the calibration figures for the report are captured.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include "esp_camera.h"

// ----------------------------------------------------------------- config --
static const char *WIFI_SSID = "YOUR_WIFI";
static const char *WIFI_PASS = "YOUR_PASSWORD";

// Your dev machine's LAN address while testing, or the deployed URL.
static const char *ENDPOINT   = "http://192.168.1.10:3000/api/sensor";
static const char *DEVICE_ID  = "00000000-0000-0000-0000-000000000000";
static const char *DEVICE_KEY = "CHANGE-ME-DEVICE-KEY";

#define SERIAL_PLOT 1        // 1 = stream m[n] and y[n] for calibration

// Tunable on the server; these are the power-on defaults.
static uint32_t SAMPLE_MS   = 250;    // T
static float    ALPHA       = 0.20f;  // a
static float    T_HIGH      = 3.0f;
static float    T_LOW       = 1.2f;
static uint32_t DWELL_S     = 30;
static const uint32_t HEARTBEAT_S = 60;

// ------------------------------------------------- AI-Thinker camera pins --
#define PWDN_GPIO_NUM 32
#define RESET_GPIO_NUM -1
#define XCLK_GPIO_NUM 0
#define SIOD_GPIO_NUM 26
#define SIOC_GPIO_NUM 27
#define Y9_GPIO_NUM 35
#define Y8_GPIO_NUM 34
#define Y7_GPIO_NUM 39
#define Y6_GPIO_NUM 36
#define Y5_GPIO_NUM 21
#define Y4_GPIO_NUM 19
#define Y3_GPIO_NUM 18
#define Y2_GPIO_NUM 5
#define VSYNC_GPIO_NUM 25
#define HREF_GPIO_NUM 23
#define PCLK_GPIO_NUM 22

// --------------------------------------------------------------- geometry --
static const int W = 160, H = 120;     // QQVGA
static const int D = 4;                // decimation factor
static const int DW = W / D, DH = H / D;   // 40 x 30
static const int DN = DW * DH;             // 1200 cells

static uint8_t prev[DN];
static bool    havePrev = false;

static float    ema        = 0.0f;
static bool     occupied   = false;   // published state
static bool     candidate  = false;   // state waiting out the dwell timer
static uint32_t candidateSince = 0;
static uint32_t lastPost   = 0;
static float    lastRaw    = 0.0f;

// ------------------------------------------------------------------ setup --
static bool startCamera() {
  camera_config_t c = {};
  c.ledc_channel = LEDC_CHANNEL_0;
  c.ledc_timer   = LEDC_TIMER_0;
  c.pin_d0 = Y2_GPIO_NUM;   c.pin_d1 = Y3_GPIO_NUM;
  c.pin_d2 = Y4_GPIO_NUM;   c.pin_d3 = Y5_GPIO_NUM;
  c.pin_d4 = Y6_GPIO_NUM;   c.pin_d5 = Y7_GPIO_NUM;
  c.pin_d6 = Y8_GPIO_NUM;   c.pin_d7 = Y9_GPIO_NUM;
  c.pin_xclk = XCLK_GPIO_NUM;   c.pin_pclk  = PCLK_GPIO_NUM;
  c.pin_vsync = VSYNC_GPIO_NUM; c.pin_href  = HREF_GPIO_NUM;
  c.pin_sccb_sda = SIOD_GPIO_NUM; c.pin_sccb_scl = SIOC_GPIO_NUM;
  c.pin_pwdn = PWDN_GPIO_NUM;   c.pin_reset = RESET_GPIO_NUM;
  c.xclk_freq_hz = 20000000;
  c.pixel_format = PIXFORMAT_GRAYSCALE;   // one byte per pixel, no JPEG decode
  c.frame_size   = FRAMESIZE_QQVGA;
  c.fb_count     = 1;
  c.fb_location  = CAMERA_FB_IN_DRAM;
  c.grab_mode    = CAMERA_GRAB_LATEST;

  esp_err_t err = esp_camera_init(&c);
  if (err != ESP_OK) {
    Serial.printf("camera init failed: 0x%x\n", err);
    return false;
  }
  sensor_t *s = esp_camera_sensor_get();
  if (s) {
    // Fix exposure and gain. Auto-exposure hunting shows up as a slow drift in
    // the difference metric and would be indistinguishable from real motion.
    s->set_gain_ctrl(s, 0);
    s->set_exposure_ctrl(s, 0);
    s->set_aec2(s, 0);
    s->set_agc_gain(s, 4);
    s->set_aec_value(s, 300);
    s->set_whitebal(s, 0);
  }
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println("Campus Reserve occupancy sensor");

  if (!startCamera()) {
    Serial.println("halted: camera unavailable");
    while (true) delay(1000);
  }

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("wifi");
  for (int i = 0; i < 40 && WiFi.status() != WL_CONNECTED; i++) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() == WL_CONNECTED) Serial.println(WiFi.localIP());
  else Serial.println("wifi failed - will keep retrying");

#if SERIAL_PLOT
  Serial.println("raw,ema,t_high,t_low,occupied");
#endif
}

// ----------------------------------------------------------- signal chain --

/** Box-average the frame down by D in each axis, into `out` (DW x DH). */
static void decimate(const uint8_t *src, uint8_t *out) {
  for (int y = 0; y < DH; y++) {
    for (int x = 0; x < DW; x++) {
      uint16_t sum = 0;
      for (int dy = 0; dy < D; dy++) {
        const uint8_t *row = src + (y * D + dy) * W + x * D;
        for (int dx = 0; dx < D; dx++) sum += row[dx];
      }
      out[y * DW + x] = (uint8_t)(sum / (D * D));
    }
  }
}

/** m[n]: mean absolute difference between consecutive decimated frames. */
static float frameDifference(const uint8_t *a, const uint8_t *b) {
  uint32_t acc = 0;
  for (int i = 0; i < DN; i++) acc += (uint32_t)abs((int)a[i] - (int)b[i]);
  return (float)acc / (float)DN;
}

// -------------------------------------------------------------- transport --
static void publish(bool isChange) {
  if (WiFi.status() != WL_CONNECTED) return;

  StaticJsonDocument<256> doc;
  doc["device_id"]  = DEVICE_ID;
  doc["metric_raw"] = lastRaw;
  doc["metric_ema"] = ema;
  doc["occupied"]   = occupied;
  doc["is_change"]  = isChange;
  doc["uptime_s"]   = (uint32_t)(millis() / 1000);

  String payload;
  serializeJson(doc, payload);

  HTTPClient http;
  http.setTimeout(4000);
  http.begin(ENDPOINT);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", DEVICE_KEY);

  int code = http.POST(payload);
  if (code == 200) {
    // Adopt server-side tuning so thresholds can be changed without a reflash.
    StaticJsonDocument<384> res;
    if (!deserializeJson(res, http.getString())) {
      JsonObject cfg = res["config"];
      if (!cfg.isNull()) {
        SAMPLE_MS = cfg["sample_ms"] | SAMPLE_MS;
        ALPHA     = cfg["alpha"]     | ALPHA;
        T_HIGH    = cfg["t_high"]    | T_HIGH;
        T_LOW     = cfg["t_low"]     | T_LOW;
        DWELL_S   = cfg["dwell_s"]   | DWELL_S;
      }
    }
  } else {
    Serial.printf("post failed: %d\n", code);
  }
  http.end();
}

// ------------------------------------------------------------------- loop --
void loop() {
  static uint8_t cur[DN];
  const uint32_t t0 = millis();

  camera_fb_t *fb = esp_camera_fb_get();
  if (!fb) {
    delay(SAMPLE_MS);
    return;
  }
  if (fb->len >= (size_t)(W * H)) decimate(fb->buf, cur);
  esp_camera_fb_return(fb);          // frame released immediately, never stored

  if (!havePrev) {
    memcpy(prev, cur, DN);
    havePrev = true;
    delay(SAMPLE_MS);
    return;
  }

  lastRaw = frameDifference(cur, prev);
  memcpy(prev, cur, DN);

  // first-order IIR low-pass
  ema = ALPHA * lastRaw + (1.0f - ALPHA) * ema;

  // Schmitt trigger: two thresholds, so a value hovering near one of them
  // cannot make the state oscillate.
  bool want = occupied;
  if (!occupied && ema > T_HIGH) want = true;
  else if (occupied && ema < T_LOW) want = false;

  // dwell timer
  const uint32_t now = millis();
  if (want != candidate) {
    candidate = want;
    candidateSince = now;
  }
  bool changed = false;
  if (candidate != occupied && (now - candidateSince) >= DWELL_S * 1000UL) {
    occupied = candidate;
    changed = true;
    Serial.printf("state -> %s  (ema %.2f)\n", occupied ? "OCCUPIED" : "VACANT", ema);
  }

#if SERIAL_PLOT
  Serial.printf("%.3f,%.3f,%.3f,%.3f,%d\n", lastRaw, ema, T_HIGH, T_LOW, occupied ? 1 : 0);
#endif

  if (changed || (now - lastPost) >= HEARTBEAT_S * 1000UL) {
    publish(changed);
    lastPost = now;
  }

  const uint32_t spent = millis() - t0;
  if (spent < SAMPLE_MS) delay(SAMPLE_MS - spent);
}
