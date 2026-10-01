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
