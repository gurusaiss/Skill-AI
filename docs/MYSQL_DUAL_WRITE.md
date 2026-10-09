# MySQL dual-write (a safety-net copy of your data)

This explains a feature that is **off by default and safe to ignore**. If you never
touch any of the `MYSQL_*` environment variables, nothing in this document applies to
your server — Supabase (or local JSON files) keeps working exactly as it always has.

## What this actually does

Supabase stays the one real database. Every page the app shows, every save button,
every report — all of it reads from and writes to Supabase (or local files, if
Supabase isn't configured) first, same as before.

If you also configure a MySQL database, the app starts **additionally** copying every
new write into MySQL, in the background, after the real save to Supabase already
succeeded. This is called the "mirror". A few important guarantees:

- **MySQL can be down, slow, or missing entirely and nothing breaks.** If a copy to
  MySQL fails, the app logs it, queues it for a retry a couple of minutes later, and
  moves on — the person using the app never sees an error or a delay because of this.
- **MySQL is not read from.** The app never asks MySQL for data to show a page. Today
  it is purely a write-only copy, nothing more.
- **It costs nothing when unconfigured.** If you never set a MySQL env var, the app
  doesn't open a connection, doesn't start a background timer, doesn't do anything
  extra at all — it's a single cheap check ("is MySQL configured?") that returns "no"
  and stops there.

## Why would I want this?

Three reasons, roughly in order of how likely you are to actually need them: (1)
**disaster recovery** — a second, independent copy of your data in a different
database technology, so a problem with Supabase (outage, accidental deletion, account
issue) doesn't mean total data loss; (2) it keeps the door open to **moving some
reads to MySQL later** if you ever want to, without a scramble to export everything
first; (3) general **data portability** — your data isn't locked into one vendor.
None of this is urgent — treat it as a low-cost insurance policy, not something you
need to set up on day one.

## Turning it on

### 1. Get a MySQL database

Any of these work — pick whichever is easiest for you:

- **PlanetScale** — free tier, MySQL-compatible, no server to manage.
- **AWS RDS for MySQL** — if you're already on AWS.
- **A Railway MySQL add-on** — one click from a Railway project.
- **A local Docker container**, for testing only: `docker run -d -p 3306:3306 -e MYSQL_ROOT_PASSWORD=devpass -e MYSQL_DATABASE=skillforge mysql:8`.

Any of these will hand you a host, port, user, password, and database name (or a
single connection URL that bundles all of it).

### 2. Create the tables

Run the schema file once against your new database:

```bash
mysql -h <host> -u <user> -p <database> < sql/mysql_schema.sql
```

It's safe to run more than once — every statement is `CREATE TABLE IF NOT EXISTS`.

### 3. Set the environment variables

Set these on the server (not just in your local `.env` — see
`docs/DEPLOY_COMPANY_SERVER.md` for how environment variables actually reach the
running server). Values below are placeholders — use your own.

**Connection (set one of these two groups):**

| Variable | What it's for |
|---|---|
| `MYSQL_URL` | A full connection string, e.g. `mysql://user:pass@host:3306/dbname` — whatever PlanetScale/Railway/Aiven hand you. Takes priority if both this and the discrete vars below are set. `DATABASE_URL` also works as an alias. |
| `MYSQL_HOST` | MySQL host (only used if `MYSQL_URL` is unset) |
| `MYSQL_PORT` | MySQL port (default `3306`) |
| `MYSQL_USER` | MySQL user |
| `MYSQL_PASSWORD` | MySQL password |
| `MYSQL_DATABASE` | MySQL database name |

**Optional tuning (sensible defaults if you skip these):**

| Variable | What it's for |
|---|---|
| `MYSQL_POOL_SIZE` | Connection pool size (default `10`) |
| `MYSQL_SSL` | Set to `false` to disable TLS (default on — most managed MySQL providers require it) |
| `MYSQL_POOL_RETRY_MS` | After a failed connection attempt, how long before it tries again (default `300000` = 5 min) |
| `MYSQL_MIRROR_TIMEOUT_MS` | How long a single mirrored write is allowed to take before it's given up on and queued for retry (default `2000` = 2 sec) |
| `MYSQL_MIRROR_RETRY_MS` | How often the background job retries queued writes (default `120000` = 2 min) |

**Leave this one alone unless you specifically mean to change it:**

| Variable | What it's for |
|---|---|
| `DB_BACKEND` | A separate, older switch. Setting it to `mysql` makes MySQL the *primary* store for users/assignments/modules/packages/groups/notifications only (not the rest of the app — see `queries/mysql/README.md`). Unrelated to the mirror described in this document — leave it unset. |

Restart the server after setting these.

### 4. Confirm the mirror is active

Open `/api/health` and look for the `mysqlMirror` field:

```json
"mysqlMirror": { "enabled": true, "pending": 0, "oldestPendingAt": null }
```

- `enabled: true` means the server found and connected to your MySQL database.
- If it says `false`, double-check the environment variables actually reached the
  server (same restart-and-recheck process as `docs/DEPLOY_COMPANY_SERVER.md`
  describes for other settings).

### 5. Copy your existing data in

Steps 1–4 only make *new* writes (from now on) get copied to MySQL. Anything already
sitting in Supabase/file from before you turned this on needs a one-time copy:

```bash
cd server
npm run db:backfill-mysql:dry-run   # read-only — reports row counts, writes nothing
npm run db:backfill-mysql           # the real copy
```

Always run the dry-run first and sanity-check the counts look right (roughly what you'd
expect for your number of users, assessments, etc.) before running the real one.

The real run prints a line per table as it goes, and a summary at the end:

```
users                               412/412 row(s) copied
assignments                         1988/1988 row(s) copied
...
[backfill] total rows read:   6210
[backfill] total rows written: 6208
[backfill] total failures:     2
[backfill] elapsed:            14.2s
```

If anything failed, it's listed at the end as `table  id  error` — safe to re-run the
whole script afterward; it only re-saves the same rows (upsert), it never creates
duplicates.

## Checking it's healthy day-to-day

Glance at `/api/health`'s `mysqlMirror` field occasionally:

- `pending` is how many writes are queued up waiting to retry (because MySQL was
  briefly unreachable when they happened). A small, temporary number is normal — it
  clears out on its own every couple of minutes once MySQL is reachable again. If it
  keeps climbing and never goes back down, that means MySQL has been unreachable for
  a while and is worth checking on.
- `oldestPendingAt` tells you how long the oldest queued write has been waiting.
- Mirror failures are logged to the server's normal console/log output, prefixed
  `[mysqlMirror]` — that's the place to look if `pending` is stuck high.

## What this is NOT (yet)

- The app **never reads from MySQL**. If MySQL goes down, falls behind, or you delete
  it entirely, the live app is completely unaffected — every page still comes from
  Supabase/file exactly as before. MySQL going down is a "fix it when convenient"
  problem, never a "the app is broken" problem.
- This is not a replacement for Supabase, and not a migration — it's a parallel,
  best-effort copy kept purely as a safety net and an option for later.
