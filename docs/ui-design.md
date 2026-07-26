# UI design notes

The interface follows a small design system so every screen looks like it belongs to one institution.

## Brand

The product presents as **Campus Reserve** under the Asia Pacific University name. The brand mark is a crimson square with a serif "R", paired with the university name in small text. It appears in the top-left of every page and links home.

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

Within tabs: stat cards carry an icon tile, an uppercase label, and a serif number that pops in (`animate-count`). The dense "Add a facility" form is collapsed behind a full-width toggle header (Plus icon + rotating chevron). Section titles use the serif display font with a leading crimson icon. All entrance animations respect `prefers-reduced-motion`.

## Texture

- `.pattern-dots` utility lays a faint radial dot grid over crimson bands (hero, page-title band, chatbot header, CTA) so large color fields read as designed surfaces, not flat blocks.
- A 1px gradient accent line sits at the very top of every page.
- Cards lift slightly on hover (`-translate-y-0.5` + shadow); feature icons invert to crimson on hover.

## Conventions

- Radius 0.5rem everywhere (set via `--radius`).
- Tables for queues/records, cards for grouped inputs and stats, badges for status (approved = filled, pending = secondary, rejected = destructive, cancelled = outline).
- Page metadata is set in `src/app/layout.tsx` ("Campus Reserve - APU Smart Facility Reservation").
- All colors come from the CSS variables - no hard-coded hex values in components, so a rebrand is a one-file change.
