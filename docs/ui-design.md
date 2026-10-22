# UI design notes

The interface follows a small design system so every screen looks like it belongs to one institution.

## Brand

The product presents as **Campus Reserve**. The brand mark is a crimson rounded square with a white campus building (`src/components/campus-icon.tsx`, drawn in `currentColor`), paired with the product name. It appears in the top-left of every page and links home. The same building is the browser tab icon (`src/app/icon.svg`, `favicon.ico`, `apple-icon.png`).

## Color

Defined as CSS variables in `src/app/globals.css` (light and dark), oklch color space:

- **Primary — deep crimson** `oklch(0.46 0.17 25)`: the APU brand red family. Used for the header band on dashboards, primary buttons, focus rings, and the hero gradient.
- **Surfaces — warm neutrals**: off-white background with white cards, warm gray borders. Avoids the sterile pure-gray look of default templates.
- **Support — slate navy** for body text, plus a soft crimson accent tint for step markers and highlights.
- **Charts**: crimson, navy, amber, teal, slate — distinct in both themes, ready for the analytics dashboard.

Dark mode mirrors the palette with a navy-black background and a deeper crimson (`oklch(0.54 0.18 25)`) so white text on crimson bands stays readable. The header switch (`components/theme-toggle.tsx`) cycles Light → Dark → Auto (follows the device); the choice is saved per browser (`localStorage` key `campus-theme`) and applied by a tiny script in `layout.tsx` before the first paint, so there is no white flash. Chart tooltips use the popover tokens so they follow the theme.

## Layout

- `src/components/app-shell.tsx` wraps all three dashboards: sticky header (brand, role badge, user name, sign out), a crimson page-title band with subtitle, a max-width content column, and an institutional footer. Adding a new role page means wrapping it in `<AppShell title=... role=...>` — nothing else.
- The landing page (`src/app/page.tsx`) uses the same header/footer plus a hero gradient, a facility-type strip, a feature grid with crimson left-border cards, and a four-step "How it works".
- The login page sits on a crimson gradient with the brand mark above the card.

## Typography

- **Display / headings — Fraunces** (`--font-serif`, optical-size axis), applied via the `.font-display` utility. Used on page titles, card titles, hero headlines, the brand mark, and stat numbers. Gives a collegiate, editorial feel that separates the product from generic dashboards.
- **Body / UI — Inter** (`--font-sans`). Everything else.

## Auth page

`src/app/login/page.tsx` is a split-screen: a crimson brand panel (left, desktop only) with two drifting blurred blobs (`animate-blob`), five floating facility icons (`animate-float-y`), and a dot-grid overlay; and a form panel (right) with a sliding segmented sign-in/sign-up toggle, staggered field entrance (`animate-field-in`), a spinner in the submit button while busy, and a link to switch modes. Keyframes live in `globals.css` and all respect `prefers-reduced-motion`.

## Admin dashboard

Organised into five tabs via a sticky section nav (Overview, Facilities, Approvals, Equipment, Records) so the admin never scrolls through everything at once — only the active section renders. The nav sits just under the app header (`sticky top-16`), scrolls horizontally on mobile, highlights the active tab in crimson, and shows live count badges (facility count, pending approvals). Switching tabs replays the `animate-reveal` entrance via React `key`.

Overview: four clickable stat cards (each jumps to its tab), "Campus right
now" venue picture cards (rooms in use, an occupancy bar, today's bookings,
pending bubble) and a recent-activity timeline. Users: role filter chips with
counts, search, avatar initials. Approvals: request cards with spinner and locked
buttons, same as the manager page. Loading shows a skeleton.

Facilities (`components/admin-facilities.tsx`): an overview grouped by
location - one card per venue with a flat 2D drawing of the building
(`components/venue-art.tsx`: sports hall, library, teaching block with its
letter, or a generic building, picked from the venue name and the facility
types inside; windows light up crimson when a room is in use), the venue's
rooms / in use / offline, and its facility types as rows (thumbnail, approval
mode, active rooms, hours, booking length) each with a "+" (add rooms) and a
**View details** button. Adding is done by step-by-step wizards
(`components/facility-wizards.tsx`): **New facility** = location (existing
venues as drawn tiles, or a new one with a live drawing preview) -> facility
(name or one of 8 presets with sensible rules) -> rules + optional first rooms
(how many, name prefix, capacity, live name preview). **Add rooms** = location
-> facility -> how many / names / capacity, suggesting the next free names
("Court 5") and the capacity sibling rooms use; it can jump to New facility if
the facility isn't listed. Both can start part-way from a venue card, a
facility row or the detail page. Naming, unique slugs and presets live in
`lib/facility-setup.ts` (tested), plus search, "Add room"
and "New facility type" (both open dialogs). The detail page has a header
(picture, counts, Add room, a menu with Delete type), the booking rules as a
normal form with Discard / Save, and the rooms in a table: status dot,
capacity (saves on leaving the box), managers (remove with x, "+ Add"), and a
row menu for custom rules, taking the room offline, or deleting it.

Within tabs: stat cards carry an icon tile, an uppercase label, and a serif number that pops in (`animate-count`). The dense "Add a facility" form is collapsed behind a full-width toggle header (Plus icon + rotating chevron). Section titles use the serif display font with a leading crimson icon. All entrance animations respect `prefers-reduced-motion`.

## Student dashboard

- **Loading:** a skeleton in the shape of the real page (stat cards and venue
  grid) with a shimmer, so nothing jumps when the data arrives.
- **Steps:** venue (cards use the same 2D venue drawing as the admin page), then room, then booking form. Each step slides in
  (`animate-step-in`, keyed by step), and venue and room cards cascade in.
- **AI suggestions:** cards cascade in (`.stagger`). The best option has a
  ring and a "Best" badge that pops in. While a booking is being made, every
  card is disabled and the chosen one shows a spinner, which prevents double
  bookings from double clicks.
- **My bookings:** upcoming and running bookings come first, soonest first.
  History sits under a collapsible "Past and cancelled" toggle. A running
  booking is highlighted with a pulsing "Now" dot. The Check in / Door code
  button pulses gently while a check-in deadline is close. The door code is
  revealed digit by digit and has a copy button.
- **The form follows the rules:** the duration list only offers what the room
  allows, and the date picker is limited to today through the advance-booking
  window.
- **Time-dependent UI** (check-in buttons, deadlines, "Now") runs off a clock
  that ticks every 30 seconds, never `Date.now()` during render. That keeps it
  current and React-Compiler-safe.

## Admin smart rooms and the 3D twin

The Smart room tab is a grid with one picture panel per room (filter by type,
search). Panels show live status, a "Live 3D" badge when the room has a Wokwi
device, capacity, today's bookings and managers. Clicking a panel opens the
room on its own page (with "All rooms" to go back). Managing rooms (rules,
capacity, managers) stays in the Facilities tab.

- **3D twin** (three.js): the room built for its type, lit and animated from
  the device's latest events: lights fade up, the air-con flap opens and
  airflow drifts out, the door swings, the lock LED turns green after a good
  code, people appear when presence is detected, and a coloured base shows
  free (green), booked waiting for check-in (amber, pulsing) or in use
  (crimson). Drag to rotate, scroll to zoom, reset button. Without WebGL it
  falls back to the 2.5D picture.
- **Live panel:** booking now with a seconds countdown, presence / lights /
  air-con / door / lock tiles, power in kW and kWh today, and 7-day savings.
- **Today, room log, energy:** today's bookings, what the device reported, and
  the 7-day energy chart (conventional room vs smart room).

Rooms without a device still get the twin, inferred from bookings and labelled
"No smart device - shown from bookings".

## Facility manager dashboard

- **Summary strip:** waiting for approval, bookings today, rooms in use now,
  attendance still to mark.
- **Your facilities:** picture cards (the same isometric renders students
  see), with a live "In use / Free now" badge, a "n waiting" bubble, and a
  timeline of today's opening hours (approved and pending blocks plus a "now"
  line). Clicking a card focuses the queue and schedule on that room; click
  again or "Show all" to clear.
- **Approval queue:** cards rather than a table: student, room thumbnail,
  day and time, duration, party size against capacity (red if over), purpose,
  and requested equipment. The button spins while saving, and all buttons lock
  so nothing gets double-submitted.
- **Today & upcoming:** grouped by day, running bookings highlighted with a
  "Now" dot, and Attended / No-show buttons appear once a session starts.
- The same 30-second clock as the student page; no `Date.now()` during render.

## Motion system

Defined in `globals.css`. Every animation stops under `prefers-reduced-motion`.

| Utility | Use |
|---|---|
| `animate-reveal` | general entrance: fade and rise |
| `stagger` + `style={{"--i": n}}` | cascade a list 55 ms apart |
| `animate-step-in` | moving between steps of a flow |
| `animate-pop-in` | something the user should notice arriving |
| `animate-digit-in` | per-digit reveal, used for door codes |
| `animate-soft-pulse` | gentle "action needed soon" cue |
| `skeleton` | loading placeholder with shimmer |

## Texture

- `.pattern-dots` utility lays a faint radial dot grid over crimson bands (hero, page-title band, chatbot header, CTA) so large color fields read as designed surfaces, not flat blocks.
- A 1px gradient accent line sits at the very top of every page.
- Cards lift slightly on hover (`-translate-y-0.5` + shadow); feature icons invert to crimson on hover.

## Conventions

- Radius 0.5rem everywhere (set via `--radius`).
- Tables for queues/records, cards for grouped inputs and stats, badges for status (approved = filled, pending = secondary, rejected = destructive, cancelled = outline).
- Page metadata is set in `src/app/layout.tsx` ("Campus Reserve - APU Smart Facility Reservation").
- All colors come from the CSS variables - no hard-coded hex values in components, so a rebrand is a one-file change.
