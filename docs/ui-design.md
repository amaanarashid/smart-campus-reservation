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

Dark mode mirrors the palette with a navy-black background and a brighter crimson for contrast.

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
counts, search, avatar initials. Facilities: each room is a picture card with
live status (greyed when offline), capacity, rules, managers and a "Take
offline / Reactivate" button. Approvals: request cards with spinner and locked
buttons, same as the manager page. Loading shows a skeleton.

Within tabs: stat cards carry an icon tile, an uppercase label, and a serif number that pops in (`animate-count`). The dense "Add a facility" form is collapsed behind a full-width toggle header (Plus icon + rotating chevron). Section titles use the serif display font with a leading crimson icon. All entrance animations respect `prefers-reduced-motion`.

## Student dashboard

- **Loading:** a skeleton in the shape of the real page (stat cards and venue
  grid) with a shimmer, so nothing jumps when the data arrives.
- **Steps:** venue, then room, then booking form. Each step slides in
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
