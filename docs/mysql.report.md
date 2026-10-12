# Putting MySQL live on the company server (Azure) — full runbook

This is the complete, in-order checklist for turning on the MySQL mirror on your real
company server. The code side is already built, tested (295 tests) and pushed to both
repos — everything below is what's left for you to do on real infrastructure.

Two companion docs cover background detail this runbook won't repeat:
- `docs/MYSQL_DUAL_WRITE.md` — what the feature actually does, the full env var list, how to
  read `/api/health`, what "pending" means day to day.
- `docs/DEPLOY_COMPANY_SERVER.md` — how code and settings reach the Azure server in general.

Read this file top to bottom, in order — later steps assume earlier ones are done.

---

## Before you start: what you need

- Access to the Azure portal for the company server (App Service / Container App / VM —
  whichever it is).
- A way to run one SQL file and one command-line script against the new MySQL database
  (see Step 4 for the easiest way to do this without installing anything locally).
- About 30–45 minutes, most of it waiting for Azure to provision a database.

---

## Step 1 — Get the MySQL code onto the server

The dual-write code is already in `main` on both repos (your repo and the company repo),
commit `34bc591` / `1aaf2b5`. If the server hasn't been rebuilt since then, do that first —
this is the same step you'd do for any update, described fully in
`docs/DEPLOY_COMPANY_SERVER.md` §1. In short:

- **App Service connected to GitHub**: open Deployment Center, confirm it picked up the
  latest commit (press **Sync** if not).
- **Docker image**: rebuild the image from the `Dockerfile` and redeploy it — the MySQL
  code is server-side only, so no `VITE_API_URL` change is needed for this specific update.
- **A VM**: `git pull`, `npm ci`, restart the app process.

Don't set any `MYSQL_*` variables yet — do that in Step 5, after the database exists.
Until then this deploy is a no-op change (MySQL code present but inactive).

---

## Step 2 — Decide where MySQL will actually run

Pick one. Since the server is already on Azure, the first option is usually the simplest:

| Option | Why you'd pick it |
|---|---|
| **Azure Database for MySQL — Flexible Server** | Same cloud, same billing, same network as your App Service — easiest to connect securely, no new vendor account needed. Recommended default. |
| PlanetScale | Free tier, nothing to manage, works from anywhere (including Azure) — good if you'd rather not add another Azure resource. |
| AWS RDS for MySQL | Only makes sense if you already use AWS for something else. |
| A Railway MySQL add-on | Quick for a one-off test, not recommended for the real company data. |

The rest of this runbook works the same regardless of which you pick — only Step 3's exact
clicks differ slightly.

---

## Step 3 — Create the database

### If you picked Azure Database for MySQL Flexible Server

1. Azure Portal → **Create a resource** → search **"Azure Database for MySQL flexible server"** → Create.
2. Basics: pick the **same region** as your App Service (lower latency, no cross-region data
   transfer cost). Choose the smallest/burstable tier to start (you can resize later).
3. Authentication: set an admin username and a strong password — save these somewhere safe,
   you'll need them in Step 5.
4. Networking: choose **"Public access"** and, importantly, tick **"Allow public access from
   any Azure service within Azure"** (or add your App Service's outbound IP addresses
   specifically, which is more secure — find them under your App Service → Networking →
   Outbound IP addresses). Without this, the app will get a connection-refused/timeout error
   in Step 6.
5. Create it. This takes 5–10 minutes.
6. Once it's ready, open the resource → **Overview** and note down: **Server name** (host),
   **Port** (default 3306). You'll also need a database name — under **Databases**, create
   one (e.g. `skillforge`) if one doesn't already exist by default.

### If you picked PlanetScale / RDS / another provider

Follow their own "create a database" flow — you need the same four things either way: host,
port, username/password, database name (or one connection URL bundling all of it).

---

## Step 4 — Run the schema file against the new database

The repo already has the full table definitions in `sql/mysql_schema.sql`. You need to run
this ONCE against the empty database you just created. Two ways to do it without installing
anything extra:

**Option A — Azure Cloud Shell (easiest, no local install needed)**
1. In the Azure Portal, open **Cloud Shell** (the `>_` icon in the top bar).
2. Upload `sql/mysql_schema.sql` from your computer (Cloud Shell has an upload button).
3. Run:
   ```bash
   mysql -h <your-mysql-host> -P 3306 -u <admin-username> -p <database-name> < mysql_schema.sql
   ```
   Enter the password when prompted.

**Option B — your own machine, if it has a MySQL client installed**
```bash
mysql -h <your-mysql-host> -P 3306 -u <admin-username> -p <database-name> < sql/mysql_schema.sql
```

Either way, it's safe to re-run if you're not sure it worked the first time — every
statement is `CREATE TABLE IF NOT EXISTS`, so running it twice changes nothing.

**If the connection is refused here**, go back to Step 3's networking setting — this almost
always means the database isn't allowing your connection's IP address yet.

---

## Step 5 — Set the environment variables on the Azure App Service

Go to your App Service → **Settings → Environment variables** (or **Configuration →
Application settings** on the classic portal UI) and add these. Full description of each is
in `docs/MYSQL_DUAL_WRITE.md` §3 — here's the copy-paste version:

```
MYSQL_HOST=<your-mysql-host>
MYSQL_PORT=3306
MYSQL_USER=<admin-username>
MYSQL_PASSWORD=<the password you saved in Step 3>
MYSQL_DATABASE=<database-name>
```

(If your provider gave you one connection URL instead of separate pieces — common with
PlanetScale/Railway — set `MYSQL_URL=<that whole URL>` instead of the five lines above.)

Leave every other `MYSQL_*` variable and `DB_BACKEND` unset — the defaults are correct for
this setup (see `docs/MYSQL_DUAL_WRITE.md` for what each one does if you want to tune
anything later).

**Save, then restart the App Service.** Settings changes in Azure don't take effect until
the app restarts.

---

## Step 6 — Confirm the mirror turned on

Open `https://<your-site>/api/health` in a browser and find the `mysqlMirror` field:

```json
"mysqlMirror": { "enabled": true, "pending": 0, "oldestPendingAt": null }
```

- **`enabled: true`** — it worked, move to Step 7.
- **`enabled: false`** — the server either didn't restart, or one of the five variables above
  is wrong/missing. Double check: did the App Service actually restart (check `build.startedAt`
  in the same `/api/health` response — it should show a recent time)? Are the variable NAMES
  spelled exactly as above (no typos, no extra spaces)?
- **A connection-refused or timeout error in the server's logs** — this is almost always the
  Step 3 networking setting. Go back and confirm the App Service's outbound IPs (or "any
  Azure service") are allowed through the MySQL firewall.

---

## Step 7 — Copy your existing data into MySQL (one time)

Everything above only makes **new** writes, from now on, get copied into MySQL. Your
existing users, assessments, reports — everything already in Supabase — needs a one-time
copy across. The script for this (`server/scripts/backfillMysql.mjs`) reads through the same
code the live app uses, so it needs access to BOTH the production Supabase credentials (to
read existing data) AND the new MySQL credentials (to write it) at the same time.

**The safest place to run it is on the server itself**, since that's the one place both sets
of credentials are already configured correctly:

- **Azure App Service**: open the **SSH** console (App Service → Development Tools → SSH,
  or via Kudu's `https://<your-site>.scm.azurewebsites.net/DebugConsole`), then:
  ```bash
  cd /home/site/wwwroot/server   # or wherever the app is deployed — check the SSH console's starting directory
  npm run db:backfill-mysql:dry-run
  ```
  Check the row counts look sensible (roughly your real number of users, assessments, etc.),
  then run the real copy:
  ```bash
  npm run db:backfill-mysql
  ```
- **A VM**: SSH in directly and run the same two commands from the app's server directory.
- **A Docker container**: `docker exec -it <container-name> npm run db:backfill-mysql:dry-run`
  (then the real run), from inside the `server/` working directory of the image.

The real run prints progress per table and a summary at the end (total rows, any failures by
table/id). It's safe to run more than once if anything looks off — it only ever updates the
same rows, never duplicates them.

**Do not run the backfill from your own laptop** unless you temporarily set your laptop's
`.env` to the exact same production `SUPABASE_URL`/service key the server uses — that means
your laptop would briefly hold a copy of production database credentials, which is avoidable
by just running it on the server as above.

---

## Step 8 — Ongoing: what to check later

You don't need to do anything else day-to-day. Occasionally glance at `/api/health`'s
`mysqlMirror.pending` number:

- Zero, or a small number that goes up and down — normal.
- A number that keeps climbing and never comes back down — MySQL has been unreachable for a
  while (wrong credentials after a password rotation, a firewall rule changed, the database
  was paused/deleted). Check the server logs for lines starting `[mysqlMirror]`.

Nothing about the live app depends on this ever being fixed quickly — per the design we
agreed on, MySQL being down never breaks or slows down the real app, which keeps running on
Supabase exactly as it does today.

---

## Quick reference: all commands in order

```bash
# Step 4 — once, against the new empty MySQL database
mysql -h <mysql-host> -P 3306 -u <user> -p <database> < sql/mysql_schema.sql

# Step 7 — once, run ON THE SERVER (has both Supabase and MySQL credentials)
cd server
npm run db:backfill-mysql:dry-run
npm run db:backfill-mysql
```

```
# Step 5 — environment variables to add on the App Service, then restart
MYSQL_HOST=<your-mysql-host>
MYSQL_PORT=3306
MYSQL_USER=<admin-username>
MYSQL_PASSWORD=<password>
MYSQL_DATABASE=<database-name>
```

```
# Step 6 — what success looks like at /api/health
"mysqlMirror": { "enabled": true, "pending": 0, "oldestPendingAt": null }
```
