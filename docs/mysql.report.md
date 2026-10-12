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
- A way to SSH into (or `docker exec` into) wherever MySQL and the app server run.
- About 30–45 minutes, depending which self-hosting option you use below.

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

Don't set any `MYSQL_*` variables yet — do that in Step 3, after the database exists.
Until then this deploy is a no-op change (MySQL code present but inactive).

---

## Step 2 — Self-hosting: you run and own MySQL yourself

You've chosen to self-host rather than use a managed database service (Azure Database for
MySQL, PlanetScale, RDS, etc.). That means no one else patches it, backs it up, or restarts it
if it crashes — **that's now your job**, in exchange for not paying a managed-service fee.
Two ways to self-host, pick based on how your company server already runs:

| Your server runs via... | Use... |
|---|---|
| **Docker Compose** (the repo's own `docker-compose.yml`, on a VM) | **Option A** below — a `mysql` service is already added to `docker-compose.yml` for you, one command turns it on. |
| **Azure App Service (PaaS)**, or a VM without Docker | **Option B** below — a separate small Azure VM running MySQL directly, which the app connects to over the network. (App Service can't run an extra co-located container next to itself, so self-hosting on the same box isn't possible there — a second VM is the standard way to self-host alongside it.) |

Either way, the rest of this runbook (Steps 3–6) is identical once MySQL is reachable.

### Option A — MySQL as a container, alongside the app (Docker Compose)

A `mysql` service is already defined in `docker-compose.yml`, off by default. On the VM
where the app's `docker compose` stack runs:

1. Add to your `.env` on that server:
   ```
   MYSQL_ROOT_PASSWORD=<pick a strong password>
   MYSQL_DATABASE=skillforge
   ```
2. Start it:
   ```bash
   docker compose --profile mysql up -d mysql
   ```
   The first time it starts, it automatically creates every table from `sql/mysql_schema.sql`
   on its own — **schema is already done for you with this option**,
   skip straight to Step 3.
3. Check it came up healthy: `docker compose ps` should show `skillforge-mysql` as
   `healthy` within about 30 seconds.

The app reaches it at hostname `mysql` (the Docker Compose service name) on the default port,
over the private network those containers already share — nothing is exposed to the internet.
In Step 3, use:
```
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=<the MYSQL_ROOT_PASSWORD you set above>
MYSQL_DATABASE=skillforge
```

**Backups are now your responsibility** — the data lives in the `mysql-data` Docker volume on
that VM. At minimum, schedule something like:
```bash
docker compose exec mysql mysqldump -u root -p"$MYSQL_ROOT_PASSWORD" skillforge > backup-$(date +%F).sql
```
as a daily cron job, copied somewhere off that same VM (another disk, Azure Blob Storage, etc.)
— a backup that lives only on the same machine as the database doesn't protect you if that
machine is lost.

### Option B — a dedicated small VM running MySQL directly

Use this if the app itself runs on Azure App Service, or any setup without Docker Compose.

1. **Create a small Linux VM** in the Azure Portal (Ubuntu 22.04 LTS is fine, the smallest/
   cheapest size — MySQL for this app's data volume doesn't need much). Put it in the **same
   region** as wherever the app runs.
2. **Install MySQL** (SSH into the new VM):
   ```bash
   sudo apt update && sudo apt install -y mysql-server
   sudo mysql_secure_installation   # set a root password, answer the prompts (yes to all is fine)
   ```
3. **Create a database and a dedicated app user** (don't use root for the app itself):
   ```bash
   sudo mysql -u root -p
   ```
   then at the `mysql>` prompt:
   ```sql
   CREATE DATABASE skillforge;
   CREATE USER 'skillforge_app'@'%' IDENTIFIED BY '<pick a strong password>';
   GRANT ALL PRIVILEGES ON skillforge.* TO 'skillforge_app'@'%';
   FLUSH PRIVILEGES;
   EXIT;
   ```
4. **Let MySQL accept connections from outside itself** (by default it only listens on
   `localhost`, which is correct for Option A's same-box setup but not here since the app runs
   elsewhere):
   ```bash
   sudo sed -i "s/^bind-address.*/bind-address = 0.0.0.0/" /etc/mysql/mysql.conf.d/mysqld.cnf
   sudo systemctl restart mysql
   ```
5. **Firewall — the important security step.** In the Azure Portal, open this VM's
   **Networking** → **Network security group** → add an inbound rule allowing port **3306**,
   but restrict the **Source** to specifically the app server's own IP address (or its
   outbound IP addresses, if it's an App Service — find those under the App Service →
   Networking → Outbound IP addresses), never "Any"/`0.0.0.0/0`. An open 3306 to the whole
   internet is how self-hosted databases get found and attacked within hours.
6. **Run the schema file** (from the app server, or any machine that can now reach the new VM
   on port 3306 — this step's networking rule must already be in place):
   ```bash
   mysql -h <mysql-vm-ip-or-hostname> -P 3306 -u skillforge_app -p skillforge < sql/mysql_schema.sql
   ```
   Safe to re-run — every statement is `CREATE TABLE IF NOT EXISTS`.
7. In Step 3, use:
   ```
   MYSQL_HOST=<mysql-vm-ip-or-hostname>
   MYSQL_PORT=3306
   MYSQL_USER=skillforge_app
   MYSQL_PASSWORD=<the password from step 3>
   MYSQL_DATABASE=skillforge
   ```

**Backups are your responsibility here too.** Schedule a daily cron job on the MySQL VM:
```bash
mysqldump -u skillforge_app -p skillforge > /backups/skillforge-$(date +%F).sql
```
and copy those files off that VM regularly (Azure Blob Storage, another disk, anywhere other
than "only on this one VM").

**Ongoing care, since nobody is doing this for you:** keep the VM's OS and MySQL version
patched (`sudo apt update && sudo apt upgrade`), watch its disk space (a full disk will stop
MySQL from writing), and if this ever becomes business-critical, read up on MySQL replication
for a second standby copy — none of that is set up by this runbook, which only covers a single
self-hosted instance.

---

## Step 3 — Set the environment variables on the app server

Use the `MYSQL_HOST`/`MYSQL_USER`/etc. lines for whichever option (A or B) you used in Step 2
above. Where to set them depends on how the app itself runs:

- **Docker Compose**: put them in the same `.env` file the `server` container already reads
  (via `env_file`), then `docker compose up -d server` to restart it with the new values.
- **Azure App Service**: go to **Settings → Environment variables** (or **Configuration →
  Application settings** on the classic portal UI), add the five `MYSQL_*` lines, save, then
  restart the App Service — settings changes don't take effect until it restarts.
- **A VM without Docker**: add them to that server's `.env` file, restart the app process.

Leave every other `MYSQL_*` variable and `DB_BACKEND` unset — the defaults are correct for
this setup (see `docs/MYSQL_DUAL_WRITE.md` for what each one does if you want to tune
anything later).

---

## Step 4 — Confirm the mirror turned on

Open `https://<your-site>/api/health` in a browser and find the `mysqlMirror` field:

```json
"mysqlMirror": { "enabled": true, "pending": 0, "oldestPendingAt": null }
```

- **`enabled: true`** — it worked, move to Step 5.
- **`enabled: false`** — the server either didn't restart, or one of the five variables above
  is wrong/missing. Double check: did it actually restart (check `build.startedAt` in the same
  `/api/health` response — it should show a recent time)? Are the variable NAMES spelled
  exactly as above (no typos, no extra spaces)?
- **A connection-refused or timeout error in the server's logs** — for Option B, this is
  almost always the firewall rule in Step 2's sub-step 5 — confirm the app's IP is actually
  allowed through on port 3306. For Option A, confirm both containers are on the same Compose
  network (they are, by default, if you didn't change `networks:` in `docker-compose.yml`).

---

## Step 5 — Copy your existing data into MySQL (one time)

Everything above only makes **new** writes, from now on, get copied into MySQL. Your
existing users, assessments, reports — everything already in Supabase — needs a one-time
copy across. The script for this (`server/scripts/backfillMysql.mjs`) reads through the same
code the live app uses, so it needs access to BOTH the production Supabase credentials (to
read existing data) AND the new MySQL credentials (to write it) at the same time.

**The safest place to run it is on the server itself**, since that's the one place both sets
of credentials are already configured correctly:

- **Docker Compose**: `docker compose exec server npm run db:backfill-mysql:dry-run`, check the
  row counts look sensible, then `docker compose exec server npm run db:backfill-mysql`.
- **Azure App Service**: open the **SSH** console (App Service → Development Tools → SSH,
  or via Kudu's `https://<your-site>.scm.azurewebsites.net/DebugConsole`), then:
  ```bash
  cd /home/site/wwwroot/server   # or wherever the app is deployed — check the SSH console's starting directory
  npm run db:backfill-mysql:dry-run
  npm run db:backfill-mysql
  ```
- **A VM without Docker**: SSH in directly and run the same two commands from the app's server
  directory.

The real run prints progress per table and a summary at the end (total rows, any failures by
table/id). It's safe to run more than once if anything looks off — it only ever updates the
same rows, never duplicates them.

**Do not run the backfill from your own laptop** unless you temporarily set your laptop's
`.env` to the exact same production `SUPABASE_URL`/service key the server uses — that means
your laptop would briefly hold a copy of production database credentials, which is avoidable
by just running it on the server as above.

---

## Step 6 — Ongoing: what to check later

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
# Option A (Docker Compose) — one command, schema applies itself on first boot
docker compose --profile mysql up -d mysql

# Option B (dedicated VM) — once, against the new empty MySQL database
mysql -h <mysql-vm-ip> -P 3306 -u skillforge_app -p skillforge < sql/mysql_schema.sql

# Step 5 — once, run ON THE SERVER (has both Supabase and MySQL credentials)
cd server
npm run db:backfill-mysql:dry-run
npm run db:backfill-mysql
```

```
# Step 3 — environment variables, then restart the app
# Option A (Docker Compose, hostname is the Compose service name):
MYSQL_HOST=mysql
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=<your MYSQL_ROOT_PASSWORD>
MYSQL_DATABASE=skillforge

# Option B (dedicated VM, use its IP/hostname):
MYSQL_HOST=<mysql-vm-ip-or-hostname>
MYSQL_PORT=3306
MYSQL_USER=skillforge_app
MYSQL_PASSWORD=<password you set>
MYSQL_DATABASE=skillforge
```

```
# Step 4 — what success looks like at /api/health
"mysqlMirror": { "enabled": true, "pending": 0, "oldestPendingAt": null }
```
