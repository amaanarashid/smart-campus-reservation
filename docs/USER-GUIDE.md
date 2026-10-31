# Campus Reserve user guide

There are three kinds of account. Everyone signs up as a student; an administrator can make someone a facility manager or an administrator, and set whether they are an undergraduate, postgraduate or staff member. Each browser tab keeps its own sign-in, so you can have a student tab and an admin tab open side by side.

The header has a notification bell, a light/dark/auto theme switch and Sign out. Pages refresh themselves while you look at them, so there is no need to reload.

Forgot your password? Click **Forgot password?** on the sign-in page, enter your email, and open the link on the same device. It takes you to a page where you choose a new one.

## Students

### Booking a room or court

1. On your dashboard, pick a **location** (for example Library or Sports Complex). Each card shows how many rooms there are free right now.
2. Pick a **room or court**. The card shows its hours, booking length, whether it books instantly or needs approval, and any known problems. A greyed card with a lock is limited to other member types (for example "Staff only").
3. Choose the date, start time, length and group size, and add a purpose and any equipment you need. The form only offers lengths and dates the room allows.
4. Press **Check availability & book**. Rooms marked instant are booked at once; the others go to the facility manager for approval and show as Pending.

Under the location you can see **Popular times**, which shows how busy its rooms usually are at each hour, based on past bookings. Quieter hours are easier to get.

### When your time is taken

If the slot you asked for is busy, the app shows up to four **suggestions**: the same room at a nearby time, another room of the same kind, or the next day with space. Each card says why it was suggested. Booking one helps the app learn what you prefer, so the suggestions get better the more you use it.

### Rules you might run into

The system enforces each facility's rules, so you will get a clear message if a booking breaks one:

- opening hours, shortest and longest booking, how far ahead you can book, and group size
- **who can book**: some facilities are for staff or postgraduates only
- **fair use**: some facilities limit how many upcoming bookings you can hold, or how many hours you can book in one week (Monday to Sunday)

### My bookings

Upcoming and running bookings come first; older ones are under "Past and cancelled".

- **Cancel**: allowed until the cancellation notice for that facility (for example 24 hours before).
- **Check in**: from 15 minutes before the start until the end. Some rooms release your booking if nobody checks in within a few minutes of the start, so check in when you arrive.
- **Door code**: for smart rooms, press Door code to get a 6-digit code. Type it on the keypad at the door and press #. That also checks you in.
- **Extend +30 min**: while a checked-in booking is running, if the room is free afterwards.
- **Report a problem**: tell the manager about something wrong with the room (air-con, lights, projector, cleanliness...). Other students then see a "Known issue" note on that room.

### The chatbot

Click the chat bubble and ask in English or Bahasa Melayu:

- "Is badminton court 2 free tomorrow evening?" / "Gelanggang badminton 2 kosong esok petang?"
- "Can I book Discussion Room A at 3pm?"
- "What is the cancellation policy for meeting rooms?"
- "When is my next booking?" / "Bila tempahan saya seterusnya?"

It answers from live data. It can tell you a room is taken, but never who booked it. If your time is busy it suggests alternatives, and you can rate each answer with the thumbs.

## Facility managers

You see only the facilities you have been assigned.

- **Your facilities**: a card per room with today's timeline (approved and pending bookings, and a line for now). Click a card to filter everything below to that room.
- **Approval queue**: approve or reject pending requests. Each card shows the student, time, group size against capacity, purpose and equipment.
- **No-show risk badge**: bookings in the next 24 hours show **Low**, **Medium** or **High no-show risk**. Hover over it (or tab to it) to see the chance and up to three reasons, for example "Missed 2 of last 4 bookings" or "Booked 3 weeks ahead". It is a guess from past bookings and is for information only. It never blocks, rejects, cancels or penalises anyone, and students never see it. For a High booking the student gets one "Still coming?" reminder about an hour before the start. Approve or reject on the usual grounds, not on the badge.
- **Today & upcoming**: once a session starts, mark **Attended** or **No-show**.
- **Room problems**: reports from students. Move them to In progress, Resolved or Dismissed, and add a note the student will see.
- **Smart room**: live state of a connected room (door, presence, lights, air-con), its event log, and **remote control** (unlock, lights or air-con on/off/auto for a while, a message on the door screen, lockdown).
- **Equipment** and **Lost & found** registers for your facilities.

## Administrators

The admin console has tabs along the top.

- **Overview**: headline numbers, what is in use right now at each venue, and recent activity.
- **Analytics**: bookings over time, peak hours, most-booked facilities, approval and no-show rates. The **No-show prediction** card shows which mode is active (baseline until there are 200+ finished bookings with 20+ no-shows, then the logistic model), its version and training size, test AUC and Brier score against simple baselines, a calibration chart, the reminder threshold, and the no-show rate before and after reminders started. **Retrain** trains on the latest data and keeps the new model only if it beats the "student's own rate" baseline.
- **Facilities**: one card per location with a drawing of the building and its facilities underneath.
  - **New facility** opens a three-step wizard: pick or create the location, pick a common facility (or type your own), then set its rules and create its first rooms in one go.
  - **+** on a facility row, or **Add room** on its page, opens the add-rooms wizard. It suggests the next names ("Court 5") and the usual capacity.
  - **View details** opens the facility's page. There you can edit the booking rules (hours, length, advance window, cancellation notice, check-in grace, approval), **who can book** and the **fair-use limits** (leave a limit blank for none), then press Save rules. The rooms table lets you change capacity, assign managers, give one room its own rules, take a room offline or delete it.
- **Users**: set each person's **member type** (undergraduate, postgraduate, staff) and **role** (student, facility manager, administrator).
- **Approvals**: requests for facilities that have no manager.
- **Feedback**: every room problem on campus.
- **Smart room**: rooms with a connected device. **Connect a room** links an existing room to a simulated (Wokwi) or physical ESP32 and shows the device ID and key once, to paste into the firmware. Each room has a live view (3D twin, readings, remote control, energy chart), plus **New device key** and **Disconnect** in its menu.
- **Equipment** and **Records** (the full activity log, with filters).

## Smart room door (library demo)

- The door screen shows the room's state. Book the room, get your door code in the app, type it and press # to unlock and check in.
- Five wrong codes lock the keypad for five minutes.
- Lights follow whether anyone is in the room; the air-con starts a few minutes before your booking and stops when it ends.
- In the last 10 minutes the ring of lights turns blue if you can extend, red if you can't. Press A, your code and # to add 30 minutes.
- When time is up the screen tells you. If you stay on, the managers are notified.
