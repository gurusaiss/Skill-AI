# Changelog

Plain-language release notes for every commit pushed from here on — what changed, why, and which files were touched. Newest entries at the top.

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
