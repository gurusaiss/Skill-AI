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
- Row grids defined with inline `gridTemplateColumns` get class `grid-stack-lg` / `grid-stack-md` (see `index.css`) so they stack on small screens.
- Test every new/changed page at 1024, 1280 and 1440 px widths (and a phone width). Vertical scroll is fine; sideways scroll is a bug.
- Intentional exceptions (code blocks, chart internals) must carry a comment `scroll-ok: <reason>` on the same or previous line.
- Guard: `cd client && npm run check:scroll` (scripts/check-no-scroll.mjs) fails on any unmarked horizontal-scroll class. Run it before committing UI work.

## Domain conventions (verified in code)
- Grades come from ONE place: `server/services/grading.js` (mirrored client-side in `client/src/utils/assessmentRules.js`): A >= 85, B 70 to <85, C < 70, compared on the UNROUNDED percentage. Do not re-implement grade thresholds.
- Assessments default to 60 minutes: `server/services/assessmentDefaults.js` (`normalizeDuration`; legacy 30 is treated as 60). Client mirror in `assessmentRules.js`. Keep both in sync.
- API response envelope is `{ success, data, error }` (e.g. `res.json({ success: true, data, error: null })`, errors `{ success:false, data:null, error }`).
- Client API calls go through `client/src/utils/authFetch.js` / `api.js`; roles: superadmin, admin, manager, employee (plus trainer etc. treated as staff).

## Workflow
- Add a `CHANGELOG.md` entry for every commit/push (what, why, files) in plain language.
- Do not run the dev server against the live database for UI checks; verify layout statically or with seeded/demo data.
