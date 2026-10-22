# Smart room door (Wokwi)

An ESP32 at a library room's door: enter your booking's code on the keypad
and the lock opens and checks you in. If nobody checks in, the booking is
released automatically.

Parts: ESP32, 4x4 keypad, 128x64 OLED, servo (the lock), slide switch (the
door), green and red LEDs, and a buzzer. Everything is in `diagram.json`.

## One-time setup

Do these in order.

### 1. Database (Supabase SQL editor)

Run `supabase/upgrade-auto-release.sql`, then `supabase/upgrade-room-access.sql`,
then `supabase/upgrade-room-end.sql` (reminders, extensions, overstay).

Then register the door on ONE room. Use the room's exact name from the admin
console, and a long made-up key:

```sql
select public.register_room_device('Discussion Room A', 'library-door-demo-7Qx92kLm4Tz8');
```

Copy the id it returns. You need it, and the key, in step 3.

### 2. Vercel (Project, then Settings, then Environment Variables)

Add both variables, then **redeploy**. Environment changes only take effect
on a new deployment.

| Name | Value |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase: Settings, then API, then `service_role` (secret, never `NEXT_PUBLIC_`) |
| `ROOM_CODE_SECRET` | any random string of 32+ characters. Changing it changes every door code. |

Make sure the deployed code is the latest (push to your repo).

### 3. Wokwi

1. Go to wokwi.com, choose **New Project**, then **ESP32**.
2. Replace `sketch.ino` and `diagram.json` with the files in this folder.
3. Add a new file called `libraries.txt` and paste this folder's
   `libraries.txt` into it.
4. At the top of `sketch.ino`, fill in `API_BASE` (your Vercel URL, with no
   trailing slash), `DEVICE_ID` and `DEVICE_KEY`.
5. Press the green play button. The OLED shows `FREE` or `BOOKED - enter code`
   within a few seconds.

### 3 (alternative) — Wokwi inside VS Code

Use this when the browser version says its servers are busy. Your laptop
compiles the code and runs the simulation, so you don't depend on Wokwi's
servers.

**One-time install:**

1. In VS Code, open the Extensions panel (Ctrl+Shift+X). Install
   **Wokwi Simulator** and **PlatformIO IDE**. PlatformIO downloads the ESP32
   toolchain on first use, which is a few hundred MB, so allow 10 to 20
   minutes. Restart VS Code if it asks.
2. Press **F1**, run **Wokwi: Request a New License**, and accept the free
   licence in the browser that opens. It lasts 30 days, and you repeat this
   step to renew it.

**Each time:**

1. Go to **File, then Open Folder**, and open **`firmware/door-wokwi`** itself,
   not the whole project. PlatformIO and Wokwi both look for their files in
   the folder you open.
2. Fill in `API_BASE`, `DEVICE_ID` and `DEVICE_KEY` at the top of
   `sketch.ino`. This is the same file the browser version uses.
3. Click the **checkmark (Build)** in the blue bar at the bottom of VS Code.
   The first build downloads the libraries. Wait for **SUCCESS**.
4. Open `diagram.json`, press **F1**, and run **Wokwi: Start Simulator**.
   The circuit opens in a VS Code tab and runs.
5. After any change to `sketch.ino`, build again (step 3). The simulator
   always runs the last successful build.

If the build fails, copy the first red `error:` line. Library version
mismatches are the usual cause, and they're quick to fix.

**Keep the Wokwi project private, or use a demo-only key.** The key sits in
the sketch in plain text. After the demo, re-run `register_room_device` with a
new key to retire the old one.

## Try it

1. As a student, book the registered room for **right now**. Discussion rooms
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

### One-time setup (HiveMQ Cloud, free)

1. console.hivemq.cloud -> sign up -> create a **Serverless (free)** cluster.
2. **Access Management** -> add a credential, e.g. username `campus-room`,
   a long password. Permission: publish and subscribe.
3. Copy the cluster URL from **Overview**, e.g. `abc123.s1.eu.hivemq.cloud`.
4. **Supabase SQL editor:** run `supabase/upgrade-room-commands.sql`.
5. **Vercel -> Settings -> Environment Variables** (then redeploy):

   | Name | Value |
   |---|---|
   | `MQTT_URL` | `mqtts://abc123.s1.eu.hivemq.cloud:8883` |
   | `MQTT_USERNAME` | the username from step 2 |
   | `MQTT_PASSWORD` | the password from step 2 |

6. **sketch.ino:** fill `MQTT_HOST` (`abc123.s1.eu.hivemq.cloud`, no
   `mqtts://`), `MQTT_USER`, `MQTT_PASS`. Rebuild. When connected, the bottom
   right of the OLED shows **M**.
7. In the project folder run `npm install` (adds the `mqtt` package) and commit
   `package-lock.json`.

Keep the sketch private: it contains the broker password. Use a credential
that only this demo uses.

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

**Capturing the signal for the report.** The serial monitor prints a CSV line
every 200 ms:

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
- **Demo shortcuts to name in the report:** `setInsecure()` skips TLS
  certificate checking. The device key sits in plain text in the firmware.
  Lockout is per door, so someone could deliberately lock a room's keypad for
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
- **The demo key is public:** the key in this sketch appears in project
  notes. Re-run `register_room_device` with a new key before sharing the
  project.
