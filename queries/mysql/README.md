# MySQL in SkillForge

Supabase (or local JSON files, if Supabase isn't configured) is the app's one real
database — every page reads from it and every write goes there first. MySQL is an
**optional, second copy** of that same data, kept in sync in the background. Nothing
about how the app works changes because of MySQL, and if MySQL is never configured
at all, this entire feature costs nothing — not a connection attempt, not a timer,
not a single extra line of overhead.

Full setup instructions (provisioning a database, env vars, the one-time backfill,
day-to-day health checks) live in **`docs/MYSQL_DUAL_WRITE.md`** — start there if you
want to actually turn this on. This file stays a short technical note about what's in
`queries/mysql/` and `sql/mysql_schema.sql`.

## What's here

- `sql/mysql_schema.sql` (repo root) — the one schema file to run against a MySQL
  database. Covers every table the app can write to a MySQL mirror: users,
  assignments, assignment requests, audit logs, modules, packages, groups, and every
  collection in `server/services/DataStore.js` (assessments, reports, companies,
  role library, question banks, employee assessment assignments, reminders, settings,
  access codes, and the rest). Safe to re-run — every statement is
  `CREATE TABLE IF NOT EXISTS`.
- `server/scripts/backfillMysql.mjs` — the one-time (but re-runnable) script that
  copies everything currently in Supabase/file-mode into MySQL. See
  `docs/MYSQL_DUAL_WRITE.md` for usage.

## Two independent switches — don't confuse them

- **`DB_BACKEND=mysql`** — an older, separate switch that makes MySQL the *primary*
  read/write store for `server/services/UserStore.js` and `server/db/store.js` only
  (users, assignments, modules, packages, groups, notifications, audit logs). Nothing
  in `server/services/DataStore.js` (assessments, reports, companies, role library,
  question banks, access codes, settings, ...) ever reads from MySQL — that half of
  the app is Supabase/file only, no matter what `DB_BACKEND` is set to. Leave this
  unset unless you deliberately mean to cut those specific stores over.
- **The mirror** (`server/db/mysqlMirror.js`, documented in `docs/MYSQL_DUAL_WRITE.md`)
  — independent of `DB_BACKEND`. As soon as a MySQL connection is configured
  (`MYSQL_URL` or the discrete `MYSQL_HOST`/`MYSQL_USER`/`MYSQL_DATABASE` vars), every
  write across **all** of DataStore.js, UserStore.js, and db/store.js is best-effort
  copied into MySQL too, regardless of `DB_BACKEND`. The app still reads only from
  Supabase/file (or MySQL, if `DB_BACKEND=mysql` for that half) — MySQL is never a
  read source for anything yet.

`sql/mysql_schema.sql` already includes `users.employee_id`, `phone`, `status`, and
the `(company_id, employee_id)` index, so there's nothing extra to add there for
those fields.
