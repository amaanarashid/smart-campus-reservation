# Smart room door (Wokwi)

An ESP32 at a library room's door: enter your booking's code on the keypad
and the lock opens and checks you in. If nobody checks in, the booking is
released automatically.

Parts: ESP32, 4x4 keypad, 128x64 OLED, servo (the lock), slide switch (the
door), green and red LEDs, and a buzzer. Everything is in `diagram.json`.

## One-time setup

Do these in order.

### 1. Database (Supabase SQL editor)

Run `supabase/upgrade-auto-release.sql`, then `supabase/upgrade-room-access.sql`.

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
| **NOISE** slider | how unreliable the sensor is: left = clean, right = 40% of readings wrong |
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
3. **Noise.** Move NOISE about halfway and flip PEOPLE off. The raw readings
   now jump about, but the bar stays low and the lights don't come on. That's
   the filter doing its job. Push NOISE all the way right: occasional false
   switch-ons start to appear. That trade-off is what the report analyses.
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
| `x` | the noisy reading |
| `y` | the filtered signal |
| `state` | 0 empty, 1 occupied, 2 warning |

Copy a few minutes of it, at different NOISE settings, to plot how well the
filter separates real presence from noise.

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
- **Signal chain:** samples every 200 ms, deliberate noise injection, a
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
