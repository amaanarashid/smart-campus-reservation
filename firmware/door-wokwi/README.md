# Smart room device (Wokwi, ESP32 DevKit, ESP32-CAM)

One firmware for every room. A door kit at a library room checks people in
with a keypad code, runs the lights and air-con from a motion sensor, and
lights a ring at the end of a booking. A room without a door (say an ESP32-CAM
by the air-con) runs only the lights and air-con, and students check in from
the app. Which parts a room has, and on which pins, is set in the app, not in
the code.

| Board | Build | What it usually runs |
|---|---|---|
| Wokwi simulation | `esp32` (local), `wokwi-web` (the app's download) | the full door kit in `diagram.json` |
| ESP32 DevKit | `board` | the door kit wired like `diagram.json`, or a room controller |
| ESP32-CAM (AI-Thinker) | `cam` | room controller: motion sensor, lights, IR air-con |

## How it works

**Connect a room** (Admin, then Smart room) asks first and builds second:

1. **Room.** Pick it.
2. **Board.** Wokwi simulation, ESP32 DevKit or ESP32-CAM.
3. **Parts.** Tick what is wired and pick the pins (sensible defaults, a
   "what goes on which pin" list, and the same checks as Room setup: camera
   pins on the ESP32-CAM, outputs on input-only pins and so on are refused).
4. **Firmware made for the room.**
   - Wokwi: **Download simulation** gives a zip with the firmware and a circuit
     drawn for exactly those parts. Open it in VS Code, start the simulator.
   - Real board: **Make firmware**, then **Install** from the browser over USB,
     then set its Wi-Fi from a phone (`CampusRoom-Setup`).

The device comes up already connected to the room, with those parts working
from the first start. No code to type.

**How "made for the room" works without compiling.** There is one compiled
firmware per board. It has two blank slots: 64 bytes for the device key
(`CAMPUS-KEY-SLOT:`) and 1 KB for the room's setup as JSON
(`CAMPUS-CFG-SLOT:`), both in `pair.cpp`. When you download or install, the
server makes a new key, links it to the room, writes the key and the setup
into the slots and redoes the firmware's checksum and SHA-256
(`src/lib/esp-image.ts`). That takes milliseconds, so there is no build server
and no limit on combinations.

**On the device.** The first start after an install uses the setup in the
firmware, so the screen, lights and sensors work before the network does.
Once connected, the server's copy is in charge: change parts later in **Smart
room, then the room, then Room setup**, and the device picks it up on its next
status poll (5 s), saves it and restarts. No reinstall.

**Install links.** The browser installer (ESP Web Tools) fetches files without
a login, so the admin gets a signed link valid for 15 minutes
(`/api/room/firmware/<token>/...`). The device key is derived from the link,
so it is never stored or put in a URL; only its SHA-256 is saved on the room.
Making new firmware for a room replaces the key, and older links and older
downloads stop working.

**Wokwi circuit.** `src/lib/wokwi-diagram.ts` draws one part per tick, each in
its own spot, wired to the chosen pins. The door kit gives back
`diagram.json` exactly (a test checks this). Wokwi has no air-con or IR LED,
so LEDs stand in; an IR receiver and Wokwi's IR remote are added for Learn
(that remote is not an AC remote, so Learn records it instead of finding a make).

**Plain firmware still works.** Built from PlatformIO, or a board moved to
another room without reinstalling, it shows a 6-digit code (screen or USB).
In Connect a room choose *Already have a device showing a code?*, type it (or
**Read over USB**), pick the parts, connect.

Code layout: `sketch.ino` (setup and loop), `room.h` (shared), `board.cpp`
(free pins per board), `config.cpp` (setup, pin checks, the setup slot),
`pair.cpp` (key and setup slots, connecting), `net.cpp`, `display.cpp`,
`door.cpp`, `room.cpp` (presence, lights, air-con rules, reminders, ring),
`ac.cpp` (relay or IR), `sensors.cpp`, `remote.cpp`.

### Simulated door from source (to change the firmware)

1. In VS Code install **Wokwi Simulator** and **PlatformIO IDE** (the first
   build downloads the ESP32 toolchain, a few hundred MB).
2. **File, then Open Folder**, open **`firmware/door-wokwi`** itself.
3. Build with the **checkmark** in the blue bar (env `esp32`), then open
   `diagram.json`, **F1**, **Wokwi: Start Simulator**.
4. The screen shows a code: type it in Connect a room (Real device tab works
   for it too). It stays connected between runs: the first build makes its
   key in `.device-secret` (not in git). For a second room, copy the folder
   and delete `.device-secret` from the copy.

After changing the firmware, `pio run -e wokwi-web` refreshes the download in
`public/firmware/wokwi/` (commit it and deploy).

## Real boards

**Install from the browser (Chrome or Edge on a computer):** Connect a room,
pick the room, the board and the parts, **Make firmware**, then **Install** and
pick the board's USB port (choose to erase it if it ran other firmware). An
ESP32-CAM needs its ESP32-CAM-MB USB board.

On first start the device opens its own Wi-Fi network, **`CampusRoom-Setup`**.
Join it on a phone, choose the room's Wi-Fi and enter its password. It then
connects to its room by itself.

Plain firmware from VS Code (`pio run -e board -t upload` / `pio run -e cam
-t upload`) asks for a code instead: on the screen, or for an ESP32-CAM over
USB (**Read over USB**; its red LED blinks twice while it waits, and the
serial monitor shows `pair-code:123456`).

`pio run -e board` and `pio run -e cam` refresh `public/firmware/esp32-devkit/`
and `public/firmware/esp32-cam/`, which the browser installer uses. The builds
use the 1.9 MB app partitions (`min_spiffs`), because IR support makes the
firmware about 1.3 MB.

The real-board builds compile, but have not been run on hardware yet.

### Wiring an ESP32-CAM room controller (default pins)

| Part | Pin | Notes |
|---|---|---|
| PIR motion sensor (AM312) | GPIO 13 | 3.3 V, output low when idle |
| Lights (an LED for the demo) | GPIO 12 | must be low at start-up: an LED to ground is fine |
| IR LED (940 nm) | GPIO 14 | through an S8050/2N2222 transistor and ~100 Ω, for range |
| IR receiver (VS1838B / TSOP38238) | GPIO 15 | for learning the AC remote |
| Temperature (DHT22, optional) | GPIO 2 | unplug it if installing firmware fails |
| Status LED | GPIO 33 | the board's red LED |

The camera, PSRAM and SD card use the other pins; the app refuses them.

### Air-con by IR

Pick **IR, like its remote** for the room's air-con in Room setup. Either pick
the make, or press **Learn from its remote**, point the AC's own remote at the
IR receiver and press ON within 30 s. A make IRremoteESP8266 knows (Daikin,
Panasonic, Mitsubishi, Midea, Gree, LG, Samsung, ...) is recognised from one
press and saved, and the room then sends full commands (on/off, temperature,
mode, fan). An unknown make is recorded as it is: record ON, then OFF, and
the room replays those two.

IR is one-way, so the device can't know if the AC obeyed. With a temperature
sensor it checks: if the room isn't cooling 6 minutes after "on", it sends
again; after 12 minutes staff get an "Air-con not responding" notification.

### Moving or replacing a device

| To do this | Do this |
|---|---|
| Put a new device on a connected room | Room menu, then **Replace device**, then the new device's code (or download a new simulation). Choose *Keep this room's current setup* if it is wired the same. The old device stops working; the room keeps its history. |
| Take a device off a room | Room menu, then **Disconnect**. It shows a code again and can go on any room. A real board also makes itself a new key. |

## One-time server setup

### Database (Supabase SQL editor)

Run `supabase/upgrade-auto-release.sql`, `supabase/upgrade-room-access.sql`,
`supabase/upgrade-room-end.sql`, `supabase/upgrade-room-connect.sql`,
`supabase/upgrade-room-pairing.sql`, then `supabase/upgrade-room-config.sql`.

### Vercel (Project, then Settings, then Environment Variables)

Add both variables, then **redeploy**. Environment changes only take effect
on a new deployment.

| Name | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase: Settings, then API, then `service_role` (secret, never `NEXT_PUBLIC_`) |
| `ROOM_CODE_SECRET` | any random string of 32+ characters. Changing it changes every door code. |

Make sure the deployed code is the latest (push to your repo). `API_BASE` at the
top of `sketch.ino` must be this site, with no trailing slash.

## Try it

1. As a student, book the connected room for **right now**. Discussion rooms
   are auto-approved.
2. In "My bookings" the card says *"Enter your door code by 3:10 pm or this
   booking is released"*. Press **Door code** and a 6-digit code appears.
3. In Wokwi, type the code and press `#`. Expected: *Welcome! Checked in*,
   the servo turns to 90 degrees, the green LED lights, and a beep. Refresh
   the app: the booking shows **checked in** and the warning is gone.
4. Flip the slide switch (door open), then flip it back (door closed). The
   lock returns to 0 degrees. If you never open the door, it relocks by
   itself after 8 seconds.

**Things that should fail:**

| Try | Expected |
|---|---|
| A wrong code | *Wrong code, 4 tries left*, red LED, two low beeps |
| 5 wrong codes | *Too many attempts*, the keypad is locked for 5 minutes |
| A code for a booking later today | *No booking now* (codes work from 5 minutes before the start until the end) |
| The right code after the booking was auto-released | *No booking now* |
| Fewer than 6 digits | *Enter 6 digits* |

**Auto-release:** book the room, don't enter the code, and wait 11 minutes.
The booking becomes "released - no check-in" and the room shows `FREE` again.

## Room automation: lights, air-con, reminders

The same ESP32 also runs the room. New parts and what they stand for:

| Part | Stands for |
|---|---|
| **PEOPLE** slide switch | people in the room. On means occupants who move now and then, not constantly. |
| **PIR** motion sensor | the real sensor. Click it to simulate one movement. |
| **LED ring** (16 colour LEDs) | the ambient end-of-booking light: blue = you can extend, red = you can't; empties like a clock over the last 10 minutes |
| yellow **LIGHTS** LED | the room lights |
| blue **AIR-CON** LED | the air-conditioner |

At the bottom of the OLED, **P** is the filtered presence signal, drawn as a
bar. The two tick marks are the thresholds: right = "someone's here", left =
"nobody's moving". **L** and **A** are filled when the lights or air-con are on.

**What to try:**

1. **Lights follow people.** Flip PEOPLE on. Within about a second the P bar
   passes the right-hand tick, the LIGHTS LED comes on, and the server logs
   `presence_on` and `lights_on`.
2. **Switch-off with a warning.** Flip PEOPLE off. The bar falls below the
   left tick. After **1 minute** with nobody moving, the screen says *"No
   movement..."* and the lights **blink for 10 seconds**, then turn off.
   Flip PEOPLE back on during the blinking and the lights stay on.
3. **Filter.** With PEOPLE on, people only show motion in about 6 of every 10
   samples, yet the P bar stays above the threshold and the lights don't
   flicker. That's the filter smoothing an intermittent signal.
4. **Air-con follows bookings.**
   - It comes on **5 minutes before** a booking starts (pre-cooling), even if
     nobody's there yet.
   - It stays on while the booking waits for check-in.
   - During the booking, it runs only while someone is present.
   - With no booking, it's off. The lights still work, for safety.
5. **Reminders.** With a checked-in booking, at **10 minutes left** the
   screen warns and the buzzer beeps twice. At **5 minutes**, three beeps and
   the lights blink three times. To test quickly, book a 20-minute slot.
6. **Early release.** Check in at the door, then leave PEOPLE off. After
   **2 minutes** of an empty room, the device reports it and the server ends
   the booking early. That only happens if at least 15 minutes were left.
   The student gets *"Booking ended early"*, the app shows *"ended early -
   room empty"*, and the freed time can be booked again.
7. **Forced entry.** Flip the DOOR switch while the lock is shut. The screen
   says *"Door opened without a code"* and the server logs
   `door_open {forced: true}`.

## Ambient light (LED ring)

For the last 10 minutes of a checked-in booking, the ring on the wall lights up:

| Colour | Meaning |
|---|---|
| **Blue** | The room is free next. Press **A**, the code, **#** for +30 min. |
| **Red** | No extension: someone booked straight after, the room is closing, or the booking is already at the maximum length. |

The lit LEDs count down: 16 at 10 minutes left, one fewer about every 37 s.
In the last minute the ring pulses. It is off at all other times. The server
works out "can extend" on every status poll (every 5 s) with the same rules
as the real extension, so the colour changes if someone books the next slot.

**Try it:** with a checked-in booking ending in under 10 minutes, the ring is
blue. Book the slot straight after it as another student: within a few seconds
it turns red. Extend instead: the ring goes off (more than 10 minutes left).

## Remote control over MQTT

Admins, and the managers of this room, can control it from the web app:
**Admin -> Smart room -> open the room** (or the manager's Smart room
section) -> **Remote control**.

| Control | What the room does |
|---|---|
| Unlock door (8 s) | Servo opens; screen says "Opened remotely". Does not check anyone in. |
| Lights / Air-con on, off, auto | Forced for 15-120 min, then back to automatic. Lights forced off with people inside blink for 10 s first. |
| Door message | Text on the OLED for 5 minutes, e.g. "Closed for cleaning". |
| Lock down keypad | Keypad ignored, screen shows LOCKED DOWN, until lifted. Survives a restart. |

**How it works.** The web app asks `POST /api/room/command`. The server
checks you are an admin or this room's manager, saves the command
(`room_commands`), signs it with HMAC-SHA256 (key = SHA-256 of the device key)
and publishes it over MQTT with TLS to `campus/rooms/<device id>/cmd`. The
ESP32 is subscribed, checks the signature, the expiry (60 s) and that it has
not run this command before, acts, and confirms with `POST /api/room/ack`.
The panel shows "waiting for room" until then, then "done". If MQTT is not
set up or is down, the same command arrives with the next status poll
(about 5 s) - so it always gets there.

### One-time setup (EMQX Cloud Serverless, free)

Two logins: the server can only **send** commands, devices can only **listen**.
Rooms stay apart because each device listens on its own topic and every
command is signed with that device's own key.

1. EMQX Cloud: create a **Serverless** deployment. From its overview page,
   copy the MQTT address (ends in `emqxsl.com`, TLS port 8883).
2. **Access Control, Authentication**: add two users with long random passwords:
   `campus-server` and `campus-device`.
3. **Access Control, Authorization**: add two rules:

   | Username | Action | Topic | Permission |
   |---|---|---|---|
   | `campus-server` | Publish | `campus/rooms/#` | Allow |
   | `campus-device` | Subscribe | `campus/rooms/#` | Allow |

4. **Supabase SQL editor:** run `supabase/upgrade-room-commands.sql`.
5. **Vercel, Settings, Environment Variables** (then redeploy):

   | Name | Value |
   |---|---|
   | `MQTT_URL` | `mqtts://<address from step 1>:8883` |
   | `MQTT_USERNAME` / `MQTT_PASSWORD` | `campus-server` and its password |
   | `MQTT_DEVICE_USERNAME` / `MQTT_DEVICE_PASSWORD` | `campus-device` and its password |

6. Nothing to change on the device: when it connects, the server gives it the
   broker address and the **device** login. Restart running devices once.
   When connected, the bottom right of the OLED shows **M**, and in EMQX the
   client `room-...` appears with username `campus-device`.
7. Check it: in the app press **Lights, auto**. The command should end
   "MQTT done". If the broker refuses or nobody is listening, the app now says
   why (the server publishes with MQTT 5), and the command still arrives over
   HTTP within 5 s.

The door gets the broker login only after an admin has connected it, and keeps
it in memory only. Use a credential that only this demo uses.

### One broker login per device (EMQX, optional)

With the EMQX API set up, every device gets its own broker login instead of
the shared one: username `room-<device id>`, allowed to subscribe to its own
topic only (everything else denied). The password is derived from the device
key and `ROOM_CODE_SECRET`, so nothing is stored; a replaced device's old
login stops working with its key, and **Disconnect** deletes the login. If the
broker refuses the server's own publish ("not authorized"), the server gives
its login publish rights on `campus/rooms/#` through the same API and retries.

1. EMQX deployment overview page, **Deployment API Key**, **+ New API Key**.
   Copy the **App ID** and **App Secret** (shown once) and the API endpoint.
2. Vercel, Environment Variables (then redeploy): `EMQX_API_URL` (the endpoint,
   e.g. `https://<id>.ala.<region>.emqxsl.com:8443/api/v5`), `EMQX_APP_ID`,
   `EMQX_APP_SECRET`.
3. Restart each device once: it gets its own login when it connects. In EMQX,
   Clients shows `room-<device id>` as the username.

Without these, or if an API call fails (logged in Vercel as "Per-device MQTT
login failed"), devices use the shared login as before.

**Try it:** open the room in Admin -> Smart room, press **Lights: off** with
PEOPLE on. Within a second: the lights blink for 10 s and go off, the panel
shows "done - people warned first", and the 3D twin goes dark. Press **auto**
and they come back. Try a door message and lockdown, then type on the
keypad: "Keypad disabled".

## End of booking: reminder, extend, time's up, overstay

Book the **shortest slot the room allows**, starting so it ends soon, and
check in at the door. (The seed's in-progress booking also works.)

1. **Phone reminder.** At 10 minutes left, the student's bell shows *"Booking
   ending soon"* (sent by pg_cron, so it works even with Wokwi off).
2. **Countdown.** In the last 10 minutes the OLED shows `ENDS IN 9:59`,
   counting every second, and `A = extend +30 min`. Beeps at 10 and 5 min.
3. **Extend from the keypad.** Press `A`, type the booking's code, press `#`.
   Expected: *Extended +30 min / Now until ...*, two high beeps, and the
   countdown disappears. The app's booking shows *extended +30 min*.
   The code is required so a passer-by cannot extend someone else's booking.
4. **Extend from the app.** The running booking has a **+30 min** button
   (it pulses in the last 10 minutes).
5. **Refusals.** Book the next slot as another student, then try again:
   *Can't extend / Room booked next*. If only 15-29 minutes are free, you get
   what is free. It also refuses past closing time or the room's maximum
   booking length.
6. **Time's up.** At zero: *Time's up!*, four beeps, the lights blink three
   times if someone is inside, and the air-con switches off with the booking
   (unless the next booking is about to start).
7. **Overstay.** Leave PEOPLE on after the end. About **2 minutes** later
   (demo; real value 15 min) the OLED says *Booking has ended / Please leave
   now*, the red LED flashes, and the facility manager and the student get a
   notification, once per booking. No penalty is applied.
   Flip PEOPLE off before then and nothing is reported.

Everything above is logged and shows in **Admin, then Smart room**: live
lights / air-con / presence / door, the room log, and the energy chart
(conventional room vs smart room, last 7 days). The facility manager of the
room sees the same panel on their dashboard, under **Smart room**.

**No history yet?** Run `supabase/seed-room-energy.sql` to fill the last 7
days with realistic bookings and readings for this room (no-shows, early
leavers, breaks, an extension, an overstay). Today stays live from Wokwi.
`seed-test-data-remove.sql` removes it.

**Demo vs real timings.** For the demo, 1 minute of no movement before the
lights go off and 2 minutes empty before early release keep it watchable.
Realistic values are about 10 and 15 minutes. They're constants at the top of
`sketch.ino`, so say which ones you'd use in deployment.

**Capturing the signal for the report.** Set `LOG_SIGNAL = true` at the top of
`room.cpp` and rebuild (`esp32` env); the serial monitor then prints a CSV line
every 200 ms (off by default so the monitor stays readable):

```
sig,ms,occupied,x,y,state
```

| Column | Meaning |
|---|---|
| `occupied` | the truth: PEOPLE switch or PIR |
| `x` | the raw motion reading (intermittent) |
| `y` | the filtered signal |
| `state` | 0 empty, 1 occupied, 2 warning |

Copy a few minutes of it to plot how the filter turns intermittent motion
into a steady occupied / empty decision.

**Changing the firmware:** after editing `sketch.ino`, rebuild with the
checkmark before starting the simulator again.

## Checking the server without Wokwi

```bash
curl -H "x-device-key: YOUR_KEY" "https://YOUR-APP.vercel.app/api/room/status?device_id=YOUR_ID"
```

This should return JSON with `"ok": true` and the room's state. A `500`
saying "Server not configured" means an environment variable is missing, or
the app wasn't redeployed after adding it.

## Design notes for the report

- **Codes are derived, never stored.** code = HMAC-SHA256(secret, booking id),
  reduced to 6 digits. There is no table of codes to leak.
- **The server decides, the device obeys.** The ESP32 never knows which codes
  are valid. It only forwards what was typed. Five failures in five minutes
  locks the keypad.
- **Opening the door is the check-in.** Students with a smart-door room
  can't check in from the app, only at the door. That closes the "check in
  from bed" loophole, so no-show data means something.
- **Relock logic:** the lock closes after the door has been opened *and*
  closed, or after 8 seconds if nobody goes in.
- **Pairing, not pasted keys.** The door makes its own random key and the
  server stores only its SHA-256. The door shows a code, and an admin links it
  to a room (the same idea as pairing a smart TV, RFC 8628). A code alone is
  useless: only an admin can claim it, and it only links the door showing it.
  Codes lapse 10 minutes after the door stops asking, and at most 200 doors can
  wait at once.
- **Demo shortcuts to name in the report:** `setInsecure()` skips TLS
  certificate checking. A simulated door's key is in `.device-secret` on the
  laptop, and a real board's is in plain flash (no flash encryption). All doors
  share one broker login, but commands are signed per device, so that login
  alone cannot control a room. Lockout is per door, so someone could deliberately lock a room's keypad for
  5 minutes. Fixes for these are future work.
- **Safety:** a real deployment must always open from the inside and unlock
  on power loss (fail-safe). The servo here only models the lock.
- **Control on the device, record on the server.** Lights and air-con are
  switched by the ESP32 itself from its own sensor, so the room keeps working
  if Wi-Fi drops. The server is told afterwards, and only the server changes
  bookings, such as an early release.
- **Signal chain:** samples every 200 ms (motion is intermittent), a
  first-order low-pass filter (y[n] = 0.1 x[n] + 0.9 y[n-1], time constant
  1.9 s), two thresholds with a gap between them (0.35 on / 0.08 off) so
  the state can't flicker, a vacancy timer, and a blinking warning before
  switch-off.
- **Known sensor limit:** a basic motion sensor (PIR) only sees *movement*,
  so someone sitting perfectly still can look like an empty room. That's why
  there's a long vacancy timer and a warning blink. An mmWave presence
  sensor, which detects stationary people, is the production choice.
