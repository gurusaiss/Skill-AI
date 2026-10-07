# Database setup guide (`queries/`)

Everything the app needs in its database, as copy-paste SQL for the **Supabase SQL Editor** (PostgreSQL).
You do not need to know SQL. Follow the steps for your situation.

## Which file do I run?

| Your situation | Run these, in this order |
|---|---|
| **Brand-new, empty database** (the company's new DB) | 1. `supabase/01_full_schema_new_database.sql`  then  2. `supabase/03_verify.sql` |
| **Existing database that already has data** (production) | 1. `supabase/02_update_existing_database.sql`  then  2. `supabase/03_verify.sql` |
| Not sure / something looks half-set-up | Run `01_full_schema_new_database.sql` again. It is safe on any database (see below). |

### How to run a file
1. Open your Supabase project -> **SQL Editor** -> **New query**.
2. Open the `.sql` file from this folder, copy **all** of it, paste it into the editor.
3. Click **Run**. It should finish with "Success". Run each file once; running again is harmless.

## What each file does

* **`supabase/01_full_schema_new_database.sql`** - creates every table, column, index and trigger the app uses (43 tables: users, companies, assessments, question banks, assignments, reports, reminders, modules, recommendations, audit logs, settings...). Every statement is "create if it does not exist", so it never deletes, overwrites or duplicates anything. It also works on a database that already has some tables - it only fills in what is missing.
* **`supabase/02_update_existing_database.sql`** - only the recent additions, for a database that already holds data: `users.employee_id / phone / status` (+ the `company_id, lower(employee_id)` index), `employee_assessment_assignments.start_at / due_at`, the `reminders`, `question_bank_archives` and `platform_settings` tables, and other columns that older scripts never created (see "Problems found" below).
* **`supabase/00_check_nothing_lost_READ_ONLY.sql`** - ONE read-only query: every table, whether it exists, and its row count (OK / EMPTY / MISSING). Run it BEFORE and AFTER any other script and compare; a count that goes down means data was lost. Never errors on a missing table.
* **`supabase/03_verify.sql`** - read-only checks. Run each numbered block on its own. Block 1 must show only `OK`; block 4 must return **no rows**; block 3 lists the columns of `users` and `employee_assessment_assignments`.
* **`verify_schema.mjs`** - an offline developer check (no database needed): `node queries/verify_schema.mjs` re-reads the app source and confirms every table/column the code uses is in file 01. It prints OK/MISSING and exits 1 on any gap.
* **`mysql/`** - notes only; see "MySQL" below.

None of the files contains any statement that deletes data or removes tables.

## After the SQL: server environment (names only)

Set these where the server runs (e.g. Render/Vercel environment settings, or `.env` locally). Never commit real values.

* `SUPABASE_URL` - the new project's URL.
* The **service-role / secret key**, under any ONE of these names (the code checks them in this order): `SUPABASESERVICE_ROLE_KEY` (sic - no underscore after SUPABASE), `SUPABASE_SECRET_KEY`, `SUPABASE_KEY`.
* The Python recommendation service (`rec-engine/`) reads `SUPABASE_URL` and **`SUPABASE_SERVICE_ROLE_KEY`** (different spelling from the Node server - set both if you run it).
* Also needed to run the app: `JWT_SECRET`, `FRONTEND_URL`, plus the email (`SMTP_*`) and AI-key (`GEMINI_API_KEY`, ...) settings from `.env.example`.

### What happens on first start
* The server checks the tables at startup (`server/utils/migrateDB.js`) and prints a banner if any are missing - after running file 01 you should see "All Supabase tables exist".
* **`autoSeed`**: if the `users` table is **empty**, the server creates a "GSS" company and **20 demo accounts** (one super admin, one admin, 3 managers, 15 employees) with default demo passwords that are written in `server/utils/autoSeed.js`. On a real company database, sign in, **change those passwords (or remove those accounts) immediately**, or make sure real users exist before the first start. It does nothing if any user already exists.
* If the server runs without Supabase variables it silently uses local JSON files that are wiped on every restart on hosts like Render - so data would appear to "disappear". Check the variables above if data does not persist.

## Moving the existing data into the new database

These scripts create the **structure** only. They do not copy data. To make the existing data show up in the UI and downloads of the new database you must also copy the rows (for example a Supabase backup/restore, or `pg_dump --data-only` from the old database and import into the new one **after** running file 01). Copy tables in the order the file lists them (users first).

## How to check it worked
1. Run `supabase/03_verify.sql` block 1 (all `OK`), block 4 (zero rows).
2. Start the server and open `/api/health/db` as an admin (note: that endpoint probes `users.id`, which does not exist - the users key is `user_id` - so it can report `users` as missing even when everything is fine; trust `03_verify.sql` instead).
3. Log in, add a user with an Employee ID, create and assign an assessment, and download a report - the Employee ID and due date should appear.

## Rollback notes
* The scripts only **add**. To undo, there is nothing to undo for existing data - added empty tables/columns are harmless and the app ignores columns it does not know.
* If you want a safety net before running 02 on production, take a backup first: Supabase -> Project Settings -> Database -> Backups (or "Database -> Backups -> Download").
* Do **not** try to "reset" by deleting tables. If a run fails half-way, fix the reported error and run the same file again; it picks up where it left off.

## Warnings

> **DO NOT run `sql/supabase_cleanup.sql`.** It is a cleanup script that removes things and will damage a live database. It is not part of any setup.

* Do not run the older scripts in `sql/` (`supabase_schema.sql`, `supabase_enterprise_schema.sql`, ...) on a database you set up with this folder - they define some tables differently (for example `assessments` with flat columns instead of the JSONB document shape the code expects) and `supabase_schema.sql` is not re-runnable (it creates triggers before their tables exist and re-creates a publication). This folder replaces them.
* Row Level Security is switched **off** on the app tables (same as before). The server uses only the service-role key, so you can safely turn RLS **on** (no policies needed) to stop the public/anon key from reading anything. A ready-to-uncomment block is at the end of file 01.
* No Supabase Storage bucket is created because the application does not use Storage (job-description files are stored inside the database).

## Problems found while preparing these scripts (code vs. old SQL)

1. `users.otp_expires`, `reset_token`, `reset_token_expires`, `must_change_password`, `permissions`, `additional_job_roles` are used by `UserStore` but created by **no** old SQL file (old scripts name the OTP column `otp_expiry`). Both names now exist; the code uses `otp_expires`. Without them password reset/OTP and per-user permissions silently fail or are dropped.
2. `users.accesses`, `jd_skills`, `job_description_file`, `jd_source_*`, `company_name` were only in some scripts.
3. `employee_assessment_assignments.start_at / due_at`, and the whole `reminders`, `platform_settings`, `question_bank_archives` tables: no SQL file created them.
4. `access_codes`, `generated_content`, `generated_modules`, `assessment_thresholds`, `sessions`: used by code but absent from `migrateDB.js` / most old scripts.
5. `packages`, `skill_packages`, `learning_tracks`: the API stores fields (`type`, `category`, `skills_covered`, `track_type`, ...) that the old schema lacked, and inserts without an `id` (old schema had no default). Fixed here.
6. `groups.name` column (code writes it; old table definitions lack it) and `groups.company_id` (an old index script expects it).
7. Old `supabase_schema.sql` gives several tables foreign keys to `users` and the wrong shape for `assessments`/`organizations`/`teams`; the code needs JSONB document tables. The `sql/migration_add_company_indexes.sql` file would fail on `groups.company_id` without the column added here.
8. Code-level issues noticed (not fixed - outside this task): `server/routes/users.js` calls `db.createAssignment` with camelCase fields (`employeeId`, `assignableId`...) that are not columns, so those auto-assignments fail silently; `store.logAuthEvent` builds `log_id` from `Date.now()` so two events in the same millisecond collide on the primary key.

## MySQL

`DB_BACKEND=mysql` covers **only part** of the app: the users store (`UserStore.js`) and the `server/db/store.js` tables (modules, packages, groups, assignments, notifications, audit logs). `server/services/DataStore.js` - assessments, submissions, reports, companies, organizations, role library, question banks, assessment assignments, reminders, settings, access codes - has **no MySQL support at all** (Supabase or local JSON files only). Therefore **the full app needs a Supabase / PostgreSQL database**; do not use MySQL for the company deployment. The existing `sql/mysql_schema.sql` already contains the newer users columns (`employee_id`, `phone`, `status` and the matching index), so no MySQL change was needed, and no MySQL scripts were added here.
