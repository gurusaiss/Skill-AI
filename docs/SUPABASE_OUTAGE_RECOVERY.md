# Supabase outage — what happened and what to do

**Situation:** Supabase suspended the project for exceeding its egress quota.
The database itself is tiny (~45 MB), but ~17 GB was *read* from it — a bug
(fixed, see bottom of this doc) that re-read full tables on every 30-second
page poll instead of using a cache. Supabase's own quota resets **Oct 23**.

Pick ONE path below. They're ordered easiest/cheapest first.

---

## Option A — Ask Supabase for an early reset (free, do this first)

Costs nothing, takes 5 minutes, and is worth doing even if you also try
Option C below.

1. Open the Supabase dashboard → your project → **Support** (or use the
   chat widget).
2. Paste this message, filling in your project ref and plan:

   ```
   Subject: Project suspended for egress quota — bug identified and fixed, requesting early reset

   Hi Supabase team,

   Our project was restricted for exceeding the egress quota (database is
   ~45MB, but ~17GB was read in this billing period — roughly 378x the
   actual data size).

   We've identified the root cause: several pages in our app poll the
   backend every 30 seconds, but our server-side cache in front of Supabase
   only lived 5 seconds, so almost every poll triggered a fresh full-table
   read instead of being served from cache. We've already fixed this (cache
   lifetimes raised to match the actual polling intervals, plus one endpoint
   trimmed to stop pulling a large JSON column it didn't need) and verified
   it with our full test suite.

   Since this was a bug on our end (now fixed) rather than ongoing
   legitimate usage, we'd like to ask whether the project's access can be
   restored before the Oct 23 quota reset, or whether a temporary egress
   allowance can be granted so our live users aren't blocked for the full
   period.

   Project ref: [your project ref]
   Plan: [Free / Pro / etc.]

   Happy to share the exact commit/diff that fixed this if useful.

   Thanks,
   [Your name]
   ```

3. If asked for proof of the fix, point them at this repo's `CHANGELOG.md`,
   entry "Fixed the real cause of the Supabase egress quota getting blown".

**Outcome:** either they restore it early (free), or you wait for Oct 23
(also free) — nothing to lose by asking.

---

## Option B — If you decide to pay instead

Only relevant if Option A doesn't come through fast enough and you'd rather
pay than wait.

| Plan | Cost | Egress included | Notes |
|---|---|---|---|
| Free | $0 | ~5 GB/month | What you're on now — hard stop, no billing, just a wait for reset |
| Pro | **$25/month** | 250 GB/month | Covers your real usage many times over, now that the bug is fixed |
| Pro overage | — | — | ~$0.09/GB beyond 250 GB (very unlikely to hit this now) |

Given the bug is fixed, $25/month on Pro would make this kind of suspension
very unlikely to happen again, with large headroom to spare.

---

## Option C — Migrate to a brand-new (free) Supabase account

Only possible if the old project's direct database connection still works
despite the suspension — untested, but costs nothing to try.

### Step 1 — test if direct access still works

Get the old project's connection string: dashboard → **Settings → Database**
→ Connection string → URI tab → **non-pooler**, port `5432`.

```bash
pg_isready -d "postgresql://postgres:[YOUR-PASSWORD]@[OLD-PROJECT-REF].supabase.co:5432/postgres"
```

- `accepting connections` → continue to Step 2.
- Times out / refused → the whole project is paused; stop here, nothing
  else works until Oct 23 regardless of a new account.

### Step 2 — back up everything

```bash
pg_dump --no-owner --no-privileges --format=plain \
  -f supabase_backup.sql \
  "postgresql://postgres:[YOUR-PASSWORD]@[OLD-PROJECT-REF].supabase.co:5432/postgres"
```

Sanity-check the dump isn't empty/truncated:

```bash
grep -c "^COPY " supabase_backup.sql   # roughly one line per table
wc -l supabase_backup.sql
```

### Step 3 — create the new project

Supabase dashboard → **New project** → free tier → pick a region → wait
~2 minutes for it to provision. Grab its connection string the same way as
Step 1.

### Step 4 — restore into the new project

```bash
psql "postgresql://postgres:[YOUR-NEW-PASSWORD]@[NEW-PROJECT-REF].supabase.co:5432/postgres" \
  -f supabase_backup.sql
```

A few harmless `ERROR`s about extensions/roles that already exist are
normal. Anything about a missing table or a failed `COPY` is not — stop and
check before moving on.

### Step 5 — point the app at the new project

Update these on the **deployed server** (not just your local `.env`), then
restart:

```
SUPABASE_URL=https://[NEW-PROJECT-REF].supabase.co
SUPABASESERVICE_ROLE_KEY=[new project's service_role key, from Settings → API]
```

Log in as a real existing user and confirm their data is actually there
before telling anyone the site is back.

### Important caveat

A new project is still free tier — same ~5 GB/month egress allowance as the
one that just got suspended. Before today's fix, this exact migration
would've blown the new project's quota too, probably within days. The fix is
already shipped (see below), so real usage going forward should sit well
under that limit — but it's not a guarantee, just much safer than before.

---

## Option D — Run on local files only, no Supabase (stopgap, conditional)

Only worth considering if the *deployed* server's local JSON files
(`server/data/users.json` and similar) actually have real, current data —
unlikely if Supabase has been primary for a while, and only checkable by
looking at the live server directly (not this local checkout).

1. On the deployed server, check `server/data/users.json` — real recent
   rows, or empty/stale leftovers from before Supabase became primary?
2. If usable: remove `SUPABASE_URL` and `SUPABASESERVICE_ROLE_KEY` from the
   server's environment and restart. With no Supabase config, every part of
   the app falls back to local files automatically.
3. **Risk:** most collections (assessments, reports, modules...)
   auto-reconcile — anything written to file while Supabase is down gets
   re-uploaded once Supabase is back. **Users, notifications, and
   assignments do not** — anything created/changed there during the outage
   stays local-only unless someone manually merges it back later.

---

## What's already fixed (so this doesn't happen again)

Shipped today, both repos, 295/295 tests passing:
- Server-side caches that sat in front of Supabase were 5 seconds, while the
  app's own pages poll every 30 seconds — so caching never actually helped,
  and every poll re-read full tables. Raised to 20–25 seconds (writes still
  invalidate the cache immediately, so nothing stale is ever shown after a
  save).
- One endpoint (question-bank generation status, polled every 3 seconds)
  was pulling a large JSON column it didn't need — now pulls only the small
  columns it actually uses.

This is the fix referenced in Option A's support message.
