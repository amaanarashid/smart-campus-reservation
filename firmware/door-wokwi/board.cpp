// Pins each board has free. The same tables as BOARDS in src/lib/room-config.ts.
#include "room.h"

#if defined(BOARD_CAM)
// AI-Thinker ESP32-CAM: camera, PSRAM and SD take the rest. 33 = the red LED.
static const int FREE[] = {2, 4, 12, 13, 14, 15, 33};
const int BOARD_SDA = -1, BOARD_SCL = -1, BOARD_STATUS_LED = 33;
const bool BOARD_STATUS_ACTIVE_LOW = true;
#else
// ESP32 DevKit and the Wokwi ESP32: no flash pins (6-11) or serial (1, 3).
static const int FREE[] = {0, 2, 4, 5, 12, 13, 14, 15, 16, 17, 18, 19, 21, 22, 23, 25, 26, 27, 32, 33, 34, 35, 36, 39};
const int BOARD_SDA = 21, BOARD_SCL = 22, BOARD_STATUS_LED = -1;
const bool BOARD_STATUS_ACTIVE_LOW = false;
#endif

bool boardPinFree(int pin) {
  for (int p : FREE) if (p == pin) return true;
  return false;
}
bool boardPinInputOnly(int pin) { return pin >= 34 && pin <= 39; }
