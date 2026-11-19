# Changelog

Plain-language release notes for every commit pushed from here on — what changed, why, and which files were touched. Newest entries at the top.

---

## 2026-11-19 — Core Platform Hardening: Latest Status Reporting, Assessment Stability, Question Generation Quality, and Post-Assessment Adaptive Modules

1. **Latest Status Only Across Reports & Dashboards:**
   - **Root Cause:** Historical assignment snapshots (Not Started, In Progress, Completed) were emitting multiple rows per employee for the same assessment or module in downloaded exports and UI dashboards.
   - **Fix:** Implemented canonical assignment deduplication via `deduplicateAssessmentRows()` in `server/services/reports/reportLoader.js`, `server/routes/assessment.js`, `server/routes/report.js`, `server/routes/assignments.js`, and `server/routes/adminDashboard.js`.
   - **Outcome:** Exactly ONE row per employee-assignment pair is displayed across assessment reports, module reports, consolidated PDF/Excel/CSV exports, and admin/manager dashboards. The latest status (Completed > In Progress > Overdue > Not Started) strictly replaces historical statuses.
   - Idempotent upsert enforced in `server/services/UserStore.js` to prevent duplicate row creation in DB.

2. **Assessment Stability & Timer Integrity (No Auto-Submit / Reset on Tab Switch):**
   - **Root Cause:** Inactive tabs throttled JavaScript intervals and re-triggered auth/window focus reloads that reset React state and timer count.
   - **Fix:** Refactored `client/src/pages/Assessment.jsx` to use an absolute wall-clock deadline architecture (`deadlineMs` stored in `localStorage` and synchronized against timestamps).
   - Tab switching, visibility change, and window blur never submit questions, never submit the assessment, never refresh the page, and never reset or pause the running timer.
   - Integrated online/offline network detection with recovery banner and incremental background progress persistence (`POST /api/assessments/:id/progress`).

3. **AI Question Generation Quality & Style Learning:**
   - **Self-Contained Questions:** Removed all document/file/page references ("According to the document...", "As per page 1...", section references) from question stems, options, and explanations in `server/services/ExtractiveQuestionGenerator.js`, `server/services/AssessmentGenerator.js`, and `server/services/QuestionStyleLearning.js`. Questions read naturally as standalone workplace evaluations.
   - **Meaningful Fill-in-the-Blanks:** Added strict quality filtering rejecting trivial grammar blanks (e.g. "is", "was", "the", "a", "an") in favor of domain terminology, operational codes, and system parameters.
   - **Question Style Learning:** Implemented `server/services/QuestionStyleLearning.js` and wired it into `server/routes/roles.js` and `server/services/AssessmentGenerator.js`. Learns framing, complexity, and scenario depth from approved manual questions in the Job Library while strictly preserving 100% factual grounding from the role's current JD and supporting documents.

4. **Post-Assessment Training Module Generation & Explicit Status Tracking:**
   - Automatically evaluates assessed knowledge gaps and weak areas upon submission in `server/routes/assessment.js`.
   - Pre-generates multi-day sessions and knowledge quizzes directly into the database (`db.createModule`) and assigns them idempotently.
   - Added end-to-end status tracking (`pending` → `processing` → `generated` → `assigned`, or `not_required` for perfect scores with no gaps, or `failed` on error) persisted on `Reports` and `PendingModules`, and exposed on admin and manager dashboards.

5. **Testing & Verification:**
   - All 29 Vitest server test suites passed (348 tests).
   - Passed UI no-horizontal-scroll layout audit (`npm run check:scroll`).

1. **Assessment Assignment Approval Gate:**
   - In `server/services/AssessmentAutoAssign.js`, removed the unapproved draft fallback that automatically assigned raw question banks when employees joined or were created. Assessments now strictly require an officially approved question bank version (`QuestionBankVersions.getApproved`).
   - If a role does not yet have an approved question bank version, automatic assignment safely skips and waits until an admin explicitly reviews, locks, and approves the role in the Role Library.

2. **Strict Question Locking (No Unlocked Question Leakage):**
   - In `server/routes/assessment.js`, tightened `resolveEmployeeQuestions`, `hydrateAssignmentsForAdmin`, and `assignEmployeesToAssessment` to strictly deliver `locked: true` questions.
   - Removed legacy fallbacks (`allowedBank = locked.length > 0 ? locked : rawBank`) that allowed unlocked draft questions to leak into assessments when none were marked locked.

3. **Post-Assessment Training Module Policy Gate:**
   - In `server/routes/assessment.js` (`POST /:id/submit`), gated the automatic post-assessment module generation behind explicit policy flags (`assessment.autoGenerateModules === true` or `platform_settings.general.autoPostAssessmentModules === true`).
   - Prevents unsolicited, unvetted training modules from automatically appearing on employee dashboards after assessment completion unless explicitly desired by the organization.

---

## 2026-10-28 — Four major updates: Locked questions only, complete module report details, single latest status, and exact role-name matching for assessment assignment

4. **Exact role-name matching for assessment assignment (no cross-role spillover):**
   - Any single character/word difference in a job role name = completely different role. "Telecom Analyst Junior" must never receive the assessment bank created for "Telecom Analyst" or "Senior Telecom Analyst", even if they share ≥50% of their words.
   - Root cause: `RoleLibrary.findByName()` has intentional fuzzy tiers (contains + word-overlap ≥50%) that are correct for JD/skills/module matching but wrong for assessment assignment.
   - Fix: Added a new `RoleLibrary.findExact(roleName, companyId)` method to `server/services/DataStore.js` that performs **only** case-insensitive, whitespace/separator-normalized exact matching — no contains or overlap tiers.
   - Replaced `findByName` with `findExact` in all three assessment-assignment code paths:
     - `server/services/AssessmentAutoAssign.js` — new employee auto-assignment on account creation
     - `server/routes/assessment.js` `getBankSubsetForRole` — question bank subset selection for bulk assessment generation
     - `server/routes/assessment.js` lazy auto-assign — self-healing assignment check on every assessment page load
   - `findByName` is **preserved unchanged** for JD/skills/module lookup paths (auth, users, roles search endpoint) where fuzzy matching is correct.
   - The `handleLockAssessment` employee-filtering in `server/routes/roles.js` already used exact normalization (`normalizeRoleName` equality) — no change needed there.
   - Added 10 new regression tests in `server/services/assessmentRoster.test.js` verifying: exact match by name, that "Telecom Analyst Junior" ≠ "Telecom Analyst", case-insensitivity, separator normalization (hyphen→space), null for unknown roles, null for wrong company, and that `findByName` (fuzzy) is documented to behave differently from `findExact`.
   - Files: `server/services/DataStore.js`, `server/services/AssessmentAutoAssign.js`, `server/routes/assessment.js`, `server/services/assessmentRoster.test.js`.

Tests: All 28 server test files pass (343 tests); `check:scroll`, `check:layout` and client production build pass.

---

## 2026-10-28 — Three major updates: Locked questions only in assessments, module reports complete employee details, and single latest status per employee-module

1. **Assessment Question Locking (Only locked questions go to employees):**
   - When generating and approving question banks, only locked questions (`q.locked === true`) are included in approved assessments and delivered to employees.
   - Server enforces this in `server/routes/roles.js` (`handleLockAssessment` rejects approvals with 0 locked questions and strips unlocked questions), `server/services/AssessmentAutoAssign.js` (filters only locked questions), and `server/routes/assessment.js` (`resolveEmployeeQuestions` only delivers locked questions; removed rogue append of unlocked questions via `missingIds`).
   - Added bulk lock/unlock endpoints (`POST /api/roles/:id/questions/lock-all` and `unlock-all`).
   - Added "Lock All" and "Unlock All" buttons to the question bank toolbar in `RoleLibrary.jsx`.
   - Updated `ApproveModal` to display the exact count of locked questions, show warnings and disable approval if 0 questions are locked, and provide a 1-click "Lock All Questions Now" button.
   - Files: `server/routes/roles.js`, `server/routes/assessment.js`, `server/services/AssessmentAutoAssign.js`, `client/src/pages/admin/RoleLibrary.jsx`.

2. **Module Reports Employee ID & Complete Personal Details:**
   - In module report downloads and UI views, resolved missing `employeeId` and added complete personal details across all export formats (Excel, PDF, Word, ZIP).
   - In `server/services/reports/moduleReportData.js`, extracted `employeeId` with comprehensive fallbacks (`u.employeeId`, `u.employee_id`, `u.empId`, `u.emp_id`, `a.employeeId`, `u.userId`, `u.id`), plus `name`, `email`, `phone`, `jobRole`, `department`, `managerName`, `managerId`, and `companyName`.
   - In `server/services/reports/moduleReportLoader.js`, indexed `loadUsers()` by `userId`, `id`, `email` (lowercased), `learningUUID`, `employeeId`, and `employee_id`.
   - Updated `moduleXlsx.js`, `modulePdf.js`, and `moduleDocx.js` to include `Employee ID`, `Name`, `Email`, `Phone`, `Job Role`, `Department`, `Manager`, `Manager ID`, and `Company` in overview grids and consolidated tables.
   - Files: `server/services/reports/moduleReportData.js`, `server/services/reports/moduleReportLoader.js`, `server/services/reports/moduleXlsx.js`, `server/services/reports/modulePdf.js`, `server/services/reports/moduleDocx.js`.

3. **Single Recent/Latest Status in Module Reports (No Phase Duplication):**
   - Eliminated duplicate rows showing multiple phases (`not_started`, `in_progress`, `completed`, `ongoing`) for the same employee and module.
   - Implemented intelligent deduplication and recency scoring in `loadModuleRows()`: compares interaction timestamps (`updatedAt`, `completedAt`, `lastActiveAt`, `startedAt`), status weights (`Completed` > `In progress` > `Not started`), progress percentage, and days completed.
   - Exactly one status—the employee's last updated/logout status—is shown in both the web UI table and all downloaded reports (Excel, PDF, Word, ZIP).
   - Files: `server/services/reports/moduleReportLoader.js`, `server/services/reports/moduleReports.test.js`.

Tests: All 28 server test files pass (333 tests); `check:scroll`, `check:layout` and client production build pass (343 tests total after Fix 4 adds 10 more).

---

## 2026-10-20 — Six assessment fixes: emails, tab-switch refresh, answer case, multiple correct answers, pending employees in reports, view-only Role Library for managers

1. **Missing employee emails in reports:** the email was taken from the saved assignment/report first and the live user only as a backup, and the backup lookup could miss. Reports now read the live user's email first, fill in any missing users one by one, and the Reports list now returns the email too. Files: `server/services/reports/reportLoader.js`, `reportData.js`, `moduleReportLoader.js`, `server/routes/assessment.js`.
2. **Assessment page reloading when switching browser tabs:** the login session refreshes every time the tab regains focus and handed the page a brand-new user object, which restarted the assessment load. The page now depends only on the user id, and the session refresh keeps the same object when nothing changed. Files: `client/src/pages/Assessment.jsx`, `client/src/contexts/AuthContext.jsx`.
3. **Lowercase answers rejected:** all answer checks (assessment scoring, practice sessions, agent evaluator) now compare ignoring letter case, and a plain "a user..." option text is no longer misread as option A. Files: `server/services/answerMatching.js` (new), `server/routes/assessment.js`, `server/agent/Evaluator.js`, `client/src/pages/Session.jsx`.
4. **Several correct answers:** multiple-choice questions can now have more than one correct option (stored as e.g. `A,C`). Employees see tick boxes with "select all correct answers"; scoring is all-or-nothing and ignores order and case. Fill-in answers can list alternatives with `||`. Admins can tick several correct answers when adding questions. Files: `server/services/answerMatching.js`, `QuestionMix.js`, `AssessmentGenerator.js`, `client/src/pages/Assessment.jsx`, `AssessmentManagement.jsx`, `admin/RoleLibrary.jsx`, `client/src/utils/assessmentRules.js`.
5. **Pending employees missing from the manager report:** the all-reports download and Reports page listed only submitted results. They now also list assigned-but-not-submitted employees (Not started / In progress / Overdue) with blank score and rating, in Excel, PDF and Word. Add `?includePending=0` to get the old file. Files: `server/services/reports/*`, `server/routes/assessment.js`, `client/src/pages/Report.jsx`.
6. **Role Library view-only for managers:** every edit/create/delete/generate/approve route returns 403 for the manager role, and the page hides all edit controls and shows a "View only" notice. Admins are unchanged. Files: `server/routes/roles.js`, `client/src/pages/admin/RoleLibrary.jsx`.

Tests: 330 server tests pass (new: answer matching, manager read-only, report email/pending); `check:scroll`, `check:layout` and the client build pass.

---

## 2026-10-12 (d) — Fixed the real cause of the Supabase egress quota getting blown (45 MB DB, 17 GB read)

**Why:** Supabase suspended the project for exceeding its egress quota (45 MB database, 17 GB read — ~378x). The cause: several admin/employee pages poll the backend every 30 seconds (notifications in the header, user management, assignment management), but the server-side read cache in front of Supabase only lived 5 seconds. A 5 s cache never overlaps a 30 s poll, so every single poll re-ran a full, uncached `select('*')` against Supabase. A separate poller (generation-status, every 3 s during question-bank generation) was also pulling the full `questions` JSON blob on every tick when it only ever needed a count and an id, both already stored in their own small columns.
**Fix:** raised the Supabase-backed read caches from 5 s to 25 s (`DataStore.js`'s shared table cache, plus `UserStore.js`'s users/assignments list caches) and added a 20 s cache to notifications — all still invalidate immediately on every write, so this only cuts down on re-reading *unchanged* data, it never serves stale data after a save. Added a lightweight `QuestionBankVersions.getLatestSummaryByRole()` that selects only `id, version, status, question_count, created_at` instead of the full row with its `questions` blob, and pointed the generation-status endpoint at it.
**Note:** this does not restore the suspended project by itself — Supabase's own quota needs to reset (Oct 23) or the plan needs upgrading from the Supabase billing dashboard. This fix is about not immediately re-blowing the quota the moment service resumes.
Files: `server/services/DataStore.js`, `server/services/UserStore.js`, `server/db/store.js`, `server/routes/roles.js`.

---

## 2026-10-12 (c) — Backfill script now fails with a clear message if Supabase itself is unreachable

**Why:** The backfill script's very first step reads all users from Supabase. If Supabase is down, paused, or access-restricted, that read throws and the whole script used to crash with a raw error message. It still stops either way (nothing gets written to MySQL until Supabase works again), but now it says so plainly instead of showing a stack trace.
**Note:** creating the MySQL schema itself is unaffected by this — that step never touches Supabase.
Files: `server/scripts/backfillMysql.mjs`, `docs/mysql.report.md`.

---

## 2026-10-12 (b) — MySQL runbook updated for self-hosting (not a managed service)

**Why:** The original runbook assumed a managed database (Azure Database for MySQL, PlanetScale, etc.). Self-hosting means you own patching, backups and uptime yourself — the steps are different, and the tradeoffs needed saying plainly.
**Added:** a `mysql` service in `docker-compose.yml` (off by default — only starts with `docker compose --profile mysql up -d mysql`), with its own persistent storage, a health check, and the schema file mounted so it sets itself up automatically the first time it starts.
**Rewrote `docs/mysql.report.md`** with two self-hosting paths: **Option A** — MySQL as a container next to the app, if the server already runs via Docker Compose (one command, schema applies itself). **Option B** — a separate small VM running MySQL directly, for Azure App Service or any non-Docker setup, including the firewall rule that matters (only the app's own IP, never the whole internet) and a reminder that backups are now your own responsibility either way.
Files: `docker-compose.yml`, `docs/mysql.report.md`.

---

## 2026-10-12 — Full runbook for turning on MySQL on the company server

**Added:** `docs/mysql.report.md` — one in-order checklist covering everything needed to actually turn on the MySQL mirror on the real Azure company server: deploying the code, provisioning Azure Database for MySQL (with the specific networking setting that avoids a connection-refused error), running the schema file, the exact environment variables to set, confirming it's live via `/api/health`, and running the one-time backfill of existing data (including why that must run on the server itself, not a laptop, so production database credentials never need to leave it).
Files: `docs/mysql.report.md` (new).

---

## 2026-10-09 (c) — One-time backfill script + setup docs finish the MySQL dual-write feature

Closes out the MySQL mirroring work from earlier today. Every NEW write has been copying itself into MySQL in the background since the last two entries below — this adds the piece needed to get data that already existed before the mirror was turned on caught up too, plus the documentation to actually turn the whole feature on.
`server/scripts/backfillMysql.mjs` is a new, manually-run (never automatic) script that reads every collection the app has — users, assignments, assessments, companies, modules, packages, question banks, reminders, all ~35 tables — the exact same way the live app already reads them (through DataStore.js/UserStore.js/db/store.js, never a parallel hand-rolled query), and copies it all into MySQL. It refuses to run at all if MySQL isn't configured, has a `--dry-run` flag that only counts rows and writes nothing (for a sanity check beforehand), is safe to run more than once (upsert, no duplicates), and if a handful of rows fail to copy (a bad connection blip, for instance) it keeps going and prints exactly which ones at the end instead of stopping or silently losing them. New npm scripts: `npm run db:backfill-mysql` and `npm run db:backfill-mysql:dry-run` (run from `server/`).
Also wrote `docs/MYSQL_DUAL_WRITE.md` (the full walkthrough: what the feature does, provisioning a MySQL database, every env var, running the backfill, checking `/api/health` day-to-day) and rewrote `queries/mysql/README.md` to match — both now reflect that the mirror covers every collection, not just the older `DB_BACKEND=mysql` subset.
This is entirely opt-in: with no MySQL environment variables set (how the app runs today), none of this does anything. Full server test suite: 295 tests passing (up from 290), run twice clean.
Files: `server/scripts/backfillMysql.mjs` (new), `server/scripts/backfillMysql.test.js` (new), `server/package.json`, `docs/MYSQL_DUAL_WRITE.md` (new), `queries/mysql/README.md`, `server/services/UserStore.js`, `server/db/store.js` (both: two existing internal row-shaping helper functions exported, additively, so the backfill script reuses the exact same column mapping the live mirror writes use — no behavior change).

---

## 2026-10-09 (b) — UserStore.js and server/db/store.js now actually fire the MySQL mirror on every write

Turns on the mirror plumbing added earlier today: every write in `server/services/UserStore.js` and `server/db/store.js` (create/update/delete for users, assignments, assignment requests, modules, packages, skill packages, learning tracks, groups, group memberships, notifications, and audit log entries) now ALSO copies itself into MySQL in the background, whenever a MySQL connection is configured — completely independent of the existing `DB_BACKEND=mysql` switch. With `DB_BACKEND` unset (how the app runs today), nothing about Supabase/file behavior changes; MySQL just quietly gets a copy of each write too. If `DB_BACKEND=mysql` is set (the older, separate "MySQL only" mode), the mirror call is skipped for that write since the switch already sent it straight to MySQL — no double-writing.
Also finished the "Groups hasn't been wired for MySQL yet" TODO in `UserStore.js`'s user-deletion cleanup: since `DataStore.js`'s Groups collection now mirrors its own writes (done by a parallel change), `_cleanupUserReferences` no longer needs its own separate mirror call there — removed the stale comment and the now-redundant code.
Found and fixed a real (pre-existing, unrelated to this change) bug while wiring `db/store.js`'s `createAssignment`: when a caller passed their own `id` in the assignment payload, the file-fallback path saved the row under that caller-given id but the write was being tracked under a different, internally-generated id — now consistent.
Added 15 new tests (`server/services/UserStore.mirror.test.js`, `server/db/store.mirror.test.js`) covering: mirrored writes in file-mode, no double-mirroring in switch mode, mirror skipped on a failed primary write, and the Groups cascade-delete cleanup. Full suite: 290 tests passing (up from 256).
Files: `server/services/UserStore.js`, `server/db/store.js`, `server/services/UserStore.mirror.test.js` (new), `server/db/store.mirror.test.js` (new).

---

## 2026-10-09 — Foundation for mirroring writes to MySQL as a second datastore (no behavior change yet)

MySQL is being added as a second datastore alongside Supabase/the JSON-file fallback, which stays the one source of truth. This adds the plumbing so a later change can make every write also get copied to MySQL in the background, without ever slowing down or failing a user's request: `server/db/mysqlMirror.js` is new and does nothing at all unless MySQL is actually configured and reachable (`mirrorEnabled()`); when it is, each write gets a short 2-second attempt, and on any failure (timeout, dropped connection, etc.) it's queued to a small local file (`server/data/mysql-mirror-queue.jsonl`) and retried automatically every 2 minutes until it succeeds or is given up on after 20 tries.
Also softened `server/db/mysql.js` so a failed MySQL connection attempt is retried again after 5 minutes instead of giving up permanently until the next restart — needed so mirroring can recover on its own if MySQL has a brief outage.
Nothing user-facing changes yet: no code calls the new mirror, so with MySQL unconfigured (the current setup) this is zero-overhead and behaves exactly as before. Documented the relevant env vars in `.env.example`.
Files: `server/db/mysqlMirror.js` (new), `server/db/mysqlMirror.test.js` (new), `server/db/mysql.js`, `.env.example`.

---

## 2026-10-13 (c) — Small follow-up: the daily brief's button now goes somewhere

The "Continue Learning" / "Take a Challenge" button on the Dashboard's daily brief card had no action. It now opens today's session.
Checked and left as-is (harmless, not used anywhere): `KnowledgeQuiz.jsx`, `ModuleLearn.jsx` and `admin/Dashboard.jsx` are not connected to any route and call no live code path. Safe to delete later if you want; ask and I will.
Files: `client/src/components/DailyBrief.jsx`.

---

## 2026-10-13 (b) — More free AI capacity for question generation, and a way to see how much you have

**More capacity from the same free keys.** Google's free limit is per key AND per model, so each Gemini key now rotates across a few models automatically, multiplying what one key can do per day. Groq and OpenRouter now support several keys each (`GROQ_API_KEY_2` to `_6`, `OPENROUTER_API_KEY_2` to `_5`), each with its own independent limit, so adding keys gives real extra capacity instead of sharing one limit.
**See your capacity.** `/api/health` now shows `llmCapacity`: how many usable slots you have right now, a rough questions-per-minute estimate, and plain suggestions like "Add more GEMINI_API_KEY_n keys" when capacity is low. The server log also prints a line at the start of each generation showing available capacity, and a line at the end showing where the time went (building questions locally vs. waiting for a free AI slot vs. actual AI calls), so a slow run can be explained.
Not yet measured against the real Google/Groq/OpenRouter services — the gain is based on how their documented free limits work, not a live timing test.
Files: `server/services/GeminiService.js`, `LLMQueue.js`, `AssessmentGenerator.js`, `server/index.js`, `.env.example`.

---

## 2026-10-13 — Every page fills the screen, readable text, fewer crowded buttons, and a bug audit

**Full width.** Pages no longer sit in a narrow centred column with empty bands on both sides. They use the whole width with a small gutter, and wide screens use side-by-side layouts (for example a main area plus a side panel, or two and three column card grids). Sign-in pages now use a two-panel layout (brand panel on one half, form on the other), and the landing page uses full-width sections.
**Readable text.** All tiny text sizes (9 to 12 px) were removed and low-contrast grey text was lifted.
**Fewer, clearer buttons.** Rows of small icon buttons became one labelled "Manage", "More", "Download" or "Bulk actions" menu with full words. Actions that only appeared on hover (unreachable on touch screens) are now always visible.
**Bugs found and fixed during the audit.** The module detail panel never opened when you clicked a row; reject and cancel actions had no confirmation; several pages showed an empty screen instead of an error when loading failed (now an error with Retry); the manager's "Submit Request" said it succeeded even when the server rejected it; a certificate button said "Download PNG" but only printed; two pages crashed on corrupt saved browser data; hidden tools (manager mapping, bulk update) are now reachable from the Users page; the Explainability filter hid agent types beyond the sixth; Content Review read some data the wrong way and used 30 minutes instead of 60; the Interview Simulator still showed letter grades (now the rating scale).
**New shared pieces and rules.** `PageContainer`, `PageHeader`, `Button`, `ActionMenu`, and `npm run check:layout` (fails on page-width caps and tiny text) so new pages follow the same rules; the rules are in `CLAUDE.md`.
Not changed: `KnowledgeQuiz`, `ModuleLearn` and `admin/Dashboard.jsx` are not connected to any route (dead code). The daily brief's call-to-action button still has no action.
Files: almost every page under `client/src/pages/`, the shared widgets in `client/src/components/`, `client/scripts/check-layout.mjs`, `CLAUDE.md`.

---

## 2026-10-12 (b) — New rating scale, module reports, and compact Excel reports

**Rating scale replaces letter grades and Pass/Fail everywhere.** Score 90 and above is Expert, 80 to 89.99 is Intermediate, 70 to 79.99 is Basic, below 70 is No Rating, worked out on the exact (unrounded) score. Old results are rated the same way when shown. Dashboards that showed pass rate or "passed / needs attention" now show rating counts and shares; the employee result screen, manager and admin dashboards, reports, PDF, Word and Excel all use it. Readiness is derived from the rating so the two never disagree.
**Excel reports redesigned.** Each workbook now has an Overview sheet (key numbers and rating distribution), a compact Results sheet of 14 narrow columns (one row per employee, no wrapped text, frozen header and first two columns, filters, colour-coded Status and Rating), a Details sheet for the long text, a Skills matrix coloured by rating, and a compact Question Review. PDF and Word follow the same rating wording.
**Modules in Reports.** A new "Modules" tab under Reports lists completed modules by employee with filters (employee, module, job role, status, dates). Open any row to see the whole engagement: day-wise and section-wise progress, time spent, every question with the employee's answer, the correct answer and whether it was right, wrong or skipped, plus skills and a timeline. Download one employee-module or all filtered results as Excel, PDF, Word or a ZIP. The module screens now save each quiz attempt with the answers and time spent (modules finished before this only show what was saved then).
**Re-approving a role no longer re-adds an employee whose assignment you deleted.**
Files: `server/services/grading.js`, `client/src/utils/assessmentRules.js`, `server/services/reports/*`, `server/routes/moduleReports.js`, `server/services/moduleEngagement.js`, `server/routes/assignments.js`, `server/routes/roles.js`, `client/src/pages/reports/ModuleReports.jsx`, `ModuleSession.jsx`, `Report.jsx`, and the dashboards.

---

## 2026-10-12 — Assign by employee or by assessment, and manage each assigned employee (edit, reassign, delete)

**Assign.** One dialog ("+ Assign employees" on the Assessments page, and inside each assessment): pick employees on the left (search by name, ID, email, department, job role), pick one or more existing assessments on the right (those that fit the employee's job role are shown first, and the best one is ticked for you), set start and end, and assign. A new joiner with an existing Job Library role takes three clicks. The result lists, per assessment, who was added, given again, or skipped and why.
**Manage each employee inside an assessment.** Every row has a labelled "Manage" menu: View result, Edit dates, Reassign, Send reminder, Download report, Delete assignment. Tick rows for "Send reminders", "Reassign selected" or "Delete selected". The letter grade, Pass/Fail, Pass % / Fail % and Pass Threshold tiles are gone; the rating (Expert, Intermediate, Basic, No Rating) and a rating count per level are shown instead.
**Delete is permanent and complete.** Deleting an assignment removes it from the assessment, the assignment row in the database, the employee's report and answers, and reminder history; the employee no longer sees it. Only an audit-log line is kept. If the employee already submitted, you must type their name or ID and click "Delete permanently". Deleting a whole assessment now also removes all of that and asks for confirmation.
**It does not come back by itself.** The system remembers who was deleted from an assessment, so the automatic assignment for new joiners and the self-check when an employee opens their assessments will not re-add them (re-approving a role in the Job Library creates a new assessment and still needs a small separate change). Assigning them again on purpose clears that.
Files: `server/services/assessmentRoster.js` (+ test), `server/services/AssessmentAutoAssign.js`, `server/services/DataStore.js` (delete helpers only), `server/routes/assessment.js`, `client/src/pages/AssessmentManagement.jsx`, `client/src/components/AssignAssessmentModals.jsx`, `client/src/components/AssignmentActions.jsx`.

---

## 2026-10-11 — Pages load much faster, new header, and a read-only database check

**Faster pages.** The biggest cause was the assessment list sending every employee's full question set (about 340 MB for a large assessment, taking 14 to 36 seconds) and the reports list sending every answer (about 170 MB, and in a large case it ran the server out of memory). Lists now send only what the screen shows (about 0.7 MB and 2.5 MB), and the full details load only when you open a row. Measured on synthetic data: assessments list 24 s to 0.02 s, reports 21 s to 0.14 s, admin dashboard 1.2 s to 0.07 s, the dashboard's first load 30 s to 0.15 s. Also: the server now remembers the signed-in user and table reads for a few seconds instead of asking the database on every call; static files are cached by the browser; missing files return 404 instead of the home page; the animation library loads only when needed.
**Slowness can be traced.** Slow requests (over 0.8 s) are logged in one line, every API response carries a timing header, and `/api/health` shows the slowest routes under `performance`.
**New header.** Full navigation names (no "Dashb..."), wrapping to a second line instead of cutting off or scrolling, consistent line icons, a clear active tab, the company name only (no ID, no "Admin Panel"), a profile menu that is never clipped, and no back/forward arrows. The company banner at the top of the admin dashboard was removed.
**Read-only database check.** `queries/supabase/00_check_nothing_lost_READ_ONLY.sql` lists every table, whether it exists, and its row count, without changing anything. Run it before and after any script and compare.
Note: the caches are per server process, so with several server copies a change shows on the others within about 5 seconds. Real database speed could not be measured here; the gains are from far smaller downloads and fewer database calls.
Files: `server/services/assessmentListView.js`, `TtlCache.js`, `server/middleware/requestTiming.js`, `DataStore.js`, `UserStore.js`, `routes/assessment.js`, `routes/users.js`, `middleware/auth.js`, `client/src/components/Navbar.jsx` (+ `CompanyChip`, `NavIcons`, `UserMenu`), `client/vite.config.js`, several client pages, `queries/`.

---

## 2026-10-10 (b) — Fix: new settings now reach the container, and the live version can be checked

**Why:** Changes pushed to GitHub were not showing on the company server. Pushing does not update that server by itself; it only changes when the app is rebuilt and restarted (the screens are built into the image). Also, `docker-compose.yml` only passed a fixed short list of settings into the container, so new ones (extra Gemini keys, the OpenRouter key, generation and report settings) were silently dropped.
**Changes:** `docker-compose.yml` now loads every variable from `.env` into the container. `/api/health` now shows `build.startedAt` (changes on every restart) and `build.commit`, plus whether OpenRouter is enabled, so you can see which version is really live. The Dockerfile accepts `APP_COMMIT` at build time. New runbook `docs/DEPLOY_COMPANY_SERVER.md` lists the exact steps to put a new version on the company server.
Files: `docker-compose.yml`, `Dockerfile`, `server/index.js`, `docs/DEPLOY_COMPANY_SERVER.md`.

---

## 2026-10-10 — No sideways scrolling anywhere, and complete database setup SQL

**No horizontal scroll.** Tab bars, the top navbar and wide tables no longer scroll sideways; they shrink, wrap or move less important columns under the name instead. A new shared `TabBar` is used for every tab strip (tabs share the width, labels shorten with a tooltip, and they wrap to a second row on narrow screens). The top bar shows icons only at laptop width and labels on wider screens. The assessment employee table went from 14 columns to 7 grouped columns, and rows become stacked cards on small screens. A global rule that silently hid overflow was removed so real problems show up. `CLAUDE.md` now records this rule for future work, and `npm run check:scroll` in `client/` fails if a new horizontal scroll is added.
Files: `client/src/components/TabBar.jsx` (new), `Navbar.jsx`, `index.css`, most dashboard and management pages, `client/scripts/check-no-scroll.mjs`, `CLAUDE.md`.

**Database SQL for the company database.** A new `queries/` folder holds everything to run in the Supabase SQL editor: `01_full_schema_new_database.sql` (all 43 tables, safe to run twice), `02_update_existing_database.sql` (only the recent additions, nothing deleted), `03_verify.sql` (read-only checks), a plain-language `README.md`, and `verify_schema.mjs` which checks the code against the SQL. It also fills gaps in the old SQL files: six tables the app uses were never created anywhere (`reminders`, `platform_settings`, `access_codes`, `generated_content`, `generated_modules`, `assessment_thresholds`), and several user and assignment columns were missing. These scripts create structure only; existing data must be copied across separately (see the README).
Files: `queries/`.

---

## 2026-10-09 — Report downloads rebuilt: complete Excel, clear section-wise PDF and Word

**Excel:** the "Results" sheet now has one row for every assigned employee (including those who have not finished) with 35 columns: Employee ID, name, email, phone, job role, department, group, manager and manager ID, assessment, **assigned date, start window, due date, started at, completed date**, status, time taken, time limit, attempt number, correct, total, score, grade, pass or fail, pass mark, performance, readiness, skill scores, strengths, needs improvement, missing skills, recommendations and reminders sent. Dates are real Excel dates and numbers are real numbers, with a frozen styled header and filters. Extra sheets: Summary, Skills, Question Review.
**PDF and Word:** reports are now split into short, plain sections. The individual report has a header, an "At a glance" box, skill scores with bars, what went well and what to improve, next steps, then a compact question review. The all-employees report has an overview, a results table, skill performance, and a "needs follow-up" list. Pages flow with no blank pages and no gaps larger than about 30 points; repeating table headers; page numbers.
**Data now saved:** when an employee starts an assessment the start time is saved (it was never saved before, so "time taken" could not be shown). At submission the employee ID, department, manager, company, time taken and attempt number are saved with the result, so old and new reports show the same details. Old results still download, with a dash where a value was never recorded.
**Also fixed:** "all reports" downloads in PDF and Word used to return a web page and an old Word format; they are real PDF and Word files now. Scores in the all-reports export were blank and are filled in.
Files: `server/services/reports/` (new), `server/routes/assessment.js`, `client/src/pages/Assessment.jsx`, `Report.jsx`, `AssessmentManagement.jsx`.

---

## 2026-10-08 — Question generation is much faster, and no longer falls back to generic questions

**Problem:** Generating a role's question bank took 30 to 60+ minutes. When Gemini's daily limit ran out, the old code still sized its requests for Gemini and sent those oversized requests to Groq, which rejected every one, then filled the gaps with generic template questions.
**Fix (simulated test, not yet measured on a live run):** about 7 minutes with Gemini exhausted (was 191 minutes and 158 generic questions), 6 minutes on Groq alone (was 41), 1.4 minutes with Gemini working.
- All uploaded files now generate at the same time, with requests sized to what each provider can really take, and smaller prompts.
- A new local generator builds fact and rule questions straight from sentences in the document (fill in the blank, thresholds, step order, wrong-statement choices), each carrying its exact source quote. It replaces the generic template padding. These are recall questions; scenario questions still come from the AI.
- An 8-minute time limit (`GEN_TIME_BUDGET_MS`): when it is reached, the bank is finished with what is ready.
- Unchanged chunks are cached, so regenerating them is instant. The progress display no longer gets stuck on "paused".
- Optional settings are listed in `.env.example`: `GEN_TIME_BUDGET_MS`, `GEN_CONCURRENCY`, `GEN_EXTRACTIVE_SHARE`, `GEN_LLM_PACE`, `GEN_MAX_ROUNDS`, `GEN_CACHE`.
Files: `server/services/AssessmentGenerator.js`, `GeminiService.js`, `LLMQueue.js`, `ExtractiveQuestionGenerator.js`, `TextRanking.js`, `GenScheduler.js`, `QuestionChunkCache.js` and their tests.

---

## 2026-10-07 — Company name and CRUD, correct dashboard numbers, grades, 60-minute tests, employee IDs, assign/reassign, quarterly New Generation

**1. Company name at the top of every portal, and full company management for the super admin.**
Admin, manager and employee screens now show the company name exactly as the super admin entered it (top bar, plus the sidebar). The super admin can now add, view, edit and delete companies with a company code, domain, plan, status, industry, address, contact details and more. Renaming a company updates every user's stored company name. Deleting a company that still has users asks for confirmation first.
Files: `server/routes/superadmin.js`, `server/routes/auth.js`, `client/src/components/CompanyBadge.jsx`, `Navbar.jsx`, `CorporateLayout.jsx`, `AuthContext.jsx`, `SuperAdminDashboard.jsx` and the other super admin pages.

**2. Dashboard numbers audited and fixed, and every card now explains itself.**
Fixed: "Average Completion" (now Average Progress, no longer counting cancelled work), "Assessments Done" (counts each person's assessment once, limited to your company), manager counts (now include all manager-level roles), overdue always showing 0, wrong field names that left employee popups and reports empty, and LLM call counts. Every card on every dashboard now has a one-line description and a hover pop-up explaining how its number is worked out.
Files: `AdminDashboard.jsx`, `ManagerDashboard.jsx`, `Employee.jsx`, `employee/Analytics.jsx`, `MetricsDashboard.jsx`, `components/StatCard.jsx`, `server/routes/adminDashboard.js`, `assignments.js`.

**3. Assessment time limit is now 60 minutes everywhere.** Assessments saved with the old 30-minute default are shown and timed as 60; a limit an admin chose on purpose is kept.
Files: `server/services/assessmentDefaults.js`, `routes/roles.js`, `routes/assessment.js`, `AssessmentAutoAssign.js`, `Assessment.jsx`, `AssessmentManagement.jsx`.

**4. New grades: A is 85 and above, B is 70 up to 85, C is below 70.** The grade uses the exact score, so 84.99 is a B and 70.01 is a B. Old results are regraded when shown. The employee result screen now uses the assessment's real pass mark instead of a fixed 60.
Files: `server/services/grading.js`, `routes/assessment.js`, `client/src/utils/assessmentRules.js`, `Assessment.jsx`, `Report.jsx`, `ManagerDashboard.jsx`.

**5. Employee ID / Manager ID and full profile editing.** Employee ID (labelled Manager ID for managers) and phone can be added and edited by admins in User Management and by users on their own Profile page, unique within a company. The Profile page now shows and edits every field. The broken email-change flow was replaced. Run `sql/migrations/2026-10-add-user-profile-columns.sql` on the live database so IDs are saved.
Files: `server/routes/users.js`, `UserStore.js`, `routes/auth.js`, `UserManagement.jsx`, `Profile.jsx`, `sql/migrations/`.

**6. Give an existing assessment to more employees, and reassign.** On an assessment, "+ Assign employees" opens a search (name, ID, email, role) with a start and end date for each person. "Use Existing" on the main page does the same for any existing assessment. The employee table has a tick or cross column, and a Reassign button for anyone who has not completed it (same questions, new dates, earlier attempts kept).
Files: `server/routes/assessment.js`, `server/services/assessmentSchedule.js`, `client/src/components/AssignAssessmentModals.jsx`, `AssessmentManagement.jsx`.

**7. Quarterly "New Generation" in the Role Library.** A New Generation button regenerates all questions, locked and unlocked, after a confirmation, and saves the current approved questions as Q1, Q2 and so on. The Quarters buttons show each saved set read-only in the same layout. Create the `question_bank_archives` table on the live database (see `server/utils/migrateDB.js`).
Files: `server/routes/roles.js`, `server/services/quarterArchive.js`, `DataStore.js`, `RoleLibrary.jsx`, `components/QuestionCard.jsx`.

---

## 2026-09-30 — Added OpenRouter as a new free AI fallback tier

**What changed:** Question generation was falling through to Groq's very narrow rate limit (~7,000 tokens/minute, shared across everything) whenever Gemini's daily quota ran out, because the intended middle-tier fallback, Cerebras, silently stopped being a real option — Cerebras changed its policy in August 2026 to require a payment method even for its free credits, so it was never actually being used on this deployment (no card was ever added). OpenRouter is added as a new middle tier instead: genuinely free, no card required, its own separate model-provider quota, and it automatically discovers which free model is currently available instead of hardcoding one that could go stale.

**Why:** So generation has a real, permanently-free second option before falling into Groq's slow per-minute pacing, instead of relying on a fallback (Cerebras) that quietly stopped working for free-tier users months ago.

**To activate:** add `OPENROUTER_API_KEY` to wherever this app's environment variables actually live (local `.env`, or the Azure App Service configuration for the deployed instance) and restart the server. Without that key set, this tier is simply skipped, same as Cerebras today.

Files: `server/services/GeminiService.js`, `.env.example`

---

## 2026-09-30 — Role Library question generation: 4 fixes

**1. Generation looked "stuck at 0" after a rate-limit pause, even after waiting 20+ minutes.**
Fix: the progress indicator had a bug where, once it showed "Paused ~90s for rate limit," it could get frozen on that message forever — even though the generation was still actively working in the background — because the code only updated the display when the question count itself changed, and a pause followed by several rejected attempts never changed that count. The display now updates properly every time. Also increased how long the page keeps checking before giving up, from 15 minutes to 45 minutes, matching how long this can legitimately take on the free AI tier for a large multi-file role.
Files: `server/services/AssessmentGenerator.js`, `client/src/pages/admin/RoleLibrary.jsx`

**2. Generic questions when a role has one strong document and one/more thin ones.**
Fix: every uploaded file used to be told "give me at least 10 questions," even a file with only a couple of paragraphs — which can't ground 10 real questions, so it fell back to generic template ones. Files now get a share of the question count based on how much real content they actually have; a thin file gets a small, honest number, and the difference goes to the file(s) that can actually support it. This directly raises the average quality score, since it's the generic template questions that were dragging it down.
Files: `server/routes/roles.js`

**3. Deleted questions could reappear after regenerating, if reworded slightly.**
Fix: there's a duplicate-detection system that already catches obvious repeats and even paraphrases, but it never actually double-checked new questions against a deleted question's real *meaning* (only its similar wording) at the strongest, most accurate detection layer. It now does. Also fixed the priority order of what's told to the AI to avoid repeating — deleted questions used to lose out to existing-bank content when both couldn't fit, when they should come first.
Files: `server/services/AssessmentGenerator.js`, `server/routes/roles.js`

**4. Checked: "Regen All" respecting locked questions.**
Confirmed already working correctly — locked questions are always preserved byte-for-byte no matter which regenerate mode is used. No code change needed here.

---

## 2026-09-29 — Manager field moved to Profile tab, now supports multiple managers

**Fix:** The Manager field is now shown directly in Edit User's Profile tab (previously it was buried in a separate Assignments tab). It's also no longer a single dropdown that overwrites whoever was set before — you can now add several managers to one person (e.g. a dotted-line report) and remove any one of them independently, without affecting the others. The backend already supported multiple managers per person; this was purely a UI limitation.

**Files:** `client/src/pages/admin/UserManagement.jsx`

**Verified:** Ran it live locally — added two different managers to a test employee (both showed with independent Remove buttons), removed one (the other stayed), and confirmed the background Users list updates immediately to match.

---

## 2026-09-29 — Add a changelog

**Why:** So changes are trackable at a glance instead of having to read git history.

**Files:** `CHANGELOG.md` (new)

---

## 2026-09-28 — Manager could not be assigned/changed for a Manager-role user

**Fix:** In Edit User, the "Assignments" tab (where you set who someone reports to) was hidden for anyone whose Role wasn't literally "Employee" — so there was no way to set or change a Manager's own manager, even though the backend already supported it. Also fixed a second, related bug found in the same area: the "Current: ..." manager display was reading the response in the wrong shape and never actually showed the real current assignment, for any role.

**Files:** `client/src/pages/admin/UserManagement.jsx`

---

## 2026-09-28 — Checked: bulk import password column, bulk import "Created" count

**Result:** Both already correct — no code change needed.
- Password column in bulk import is optional everywhere (server validation and the downloadable template's own instructions already say to leave it blank).
- Ran a real import through the API directly and confirmed the "Created" count comes back correct; could not reproduce it showing zero.

---

## 2026-09-25 — Job Role dropdown was too small to use

**Fix:** Replaced the tiny native browser autocomplete (a `<datalist>`, which can't be resized or styled) with a proper, larger, scrollable dropdown component across every Job Role field: Add User, Edit User (all 3 of its Job Role fields), and the post-signup onboarding page.

**Files:** `client/src/components/JobRoleCombobox.jsx` (new), `client/src/pages/admin/UserManagement.jsx`, `client/src/pages/auth/Onboarding.jsx`

---

## 2026-09-25 — Add/Edit User Role field showed too many options

**Fix:** The Role field (system access level: Admin/Manager/Employee) was also listing all 13 job-title roles (Leadership, Senior Manager variants, WFM, Lead, Trainer, etc.), which belong in the separate Job Role field instead. Role now only offers Admin, Manager, Employee. Existing users already on one of those 13 roles are untouched — this only limits what a NEW assignment can pick.

**Files:** `client/src/pages/admin/UserManagement.jsx`
