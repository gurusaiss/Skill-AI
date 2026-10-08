# SkillForge AI - project instructions for Claude

Monorepo (npm workspaces): `client/` (React 18 + Vite + Tailwind, dark slate theme) and `server/` (Node/Express, ESM). Tests: `npm test` (vitest, server).

## UI rules (client) - read before touching any page
- NEVER add a horizontal scrollbar. No `overflow-x-auto|scroll`, no `min-w-[900px]`-style fixed widths, no `overflow-x:hidden` on body to hide problems. Fix the cause.
- Instead: shrink font/padding, wrap, `truncate` + `title` tooltip, `min-w-0` on flex/grid children, `minmax(0,1fr)` grid columns, hide low-priority columns at narrower breakpoints (`hidden xl:table-cell`) while keeping the info reachable (secondary line under the name, or a detail modal), and stack rows as cards below `lg`.
- Tabs: ALWAYS use `client/src/components/TabBar.jsx` (props: `tabs=[{key,label,icon,badge,disabled}]`, `active`, `onChange`, `size 'md'|'sm'`, `variant 'pill'|'underline'`, `className`). It shrinks, truncates and wraps to a second row; it never scrolls. Same for any new tab, page or modal.
- Metric cards: ALWAYS use `client/src/components/StatCard.jsx`. Every card needs a `description` and a hover `tooltip`.
- Header (`Navbar.jsx`, two tiers on `lg`+): navigation labels ALWAYS show in full; if they do not fit one line they wrap to a second row (never truncate, never scroll). Below `lg` a hamburger opens a full-height drawer with every full label. Add new links to the `ADMIN_LINKS` / `ROLE_LINKS` arrays in `Navbar.jsx`.
- No company ID and no "Admin Panel" text in the header or page banners; the company name appears only in the header company chip (`CompanyChip.jsx`).
- No emoji icons in navigation: use heroicons OUTLINE (20px, stroke 1.75, currentColor) via `NavIcons.jsx`.
- The user chip (`UserMenu.jsx`) is `shrink-0` and must never be clipped; its name truncates (with tooltip) before the chip overflows. No back/forward arrows in the header (browser provides them); pages keep their own in-page "Back to ..." links.
- Page layout: every app page fills the width. Wrap content in `components/PageContainer.jsx` (full width, small gutter only). NEVER cap a page with `max-w-7xl mx-auto` / `max-w-6xl` / `max-w-5xl` / `max-w-4xl`; `PageContainer narrow` is only for single-column forms. No empty bands left or right. Use `components/PageHeader.jsx` for the title block.
- Buttons: use `components/Button.jsx` (text-sm or larger, 36-40px tall). A toolbar has at most 1-2 visible buttons plus ONE `components/ActionMenu.jsx` ("Actions", "Download", "More") holding the rest with full labels. Never a row of tiny icon-only or text-[10px] buttons. No arbitrary text sizes below `text-xs` (use `text-xs`/`text-sm`/`text-base`; `text-[10px]`/`text-[11px]`/`text-[12px]` are not allowed for readable content).
- Row grids defined with inline `gridTemplateColumns` get class `grid-stack-lg` / `grid-stack-md` (see `index.css`) so they stack on small screens.
- Test every new/changed page at 1024, 1280 and 1440 px widths (and a phone width). Vertical scroll is fine; sideways scroll is a bug.
- Intentional exceptions (code blocks, chart internals) must carry a comment `scroll-ok: <reason>` on the same or previous line.
- Guard: `cd client && npm run check:scroll` (scripts/check-no-scroll.mjs) fails on any unmarked horizontal-scroll class. Run it before committing UI work.

## Domain conventions (verified in code)
- Ratings come from ONE place: `server/services/grading.js` (`ratingFromPercent`, `ratingForReport`, `RATINGS`; mirrored client-side in `client/src/utils/assessmentRules.js` with `RATING_STYLES`): Expert >= 90, Intermediate 80 to 89.99, Basic 70 to 79.99, No Rating <= 69.99, compared on the UNROUNDED percentage. There are NO letter grades and NO Pass/Fail anywhere in the UI or exports (old stored `grade`/`passed` fields are kept for compatibility but never shown). Readiness is derived from the rating, never stored separately. Do not re-implement the thresholds.
- Assessments default to 60 minutes: `server/services/assessmentDefaults.js` (`normalizeDuration`; legacy 30 is treated as 60). Client mirror in `assessmentRules.js`. Keep both in sync.
- API response envelope is `{ success, data, error }` (e.g. `res.json({ success: true, data, error: null })`, errors `{ success:false, data:null, error }`).
- Client API calls go through `client/src/utils/authFetch.js` / `api.js`; roles: superadmin, admin, manager, employee (plus trainer etc. treated as staff).

## Workflow
- Add a `CHANGELOG.md` entry for every commit/push (what, why, files) in plain language.
- Do not run the dev server against the live database for UI checks; verify layout statically or with seeded/demo data.
