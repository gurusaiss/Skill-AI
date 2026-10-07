# Changelog

Plain-language release notes for every commit pushed from here on — what changed, why, and which files were touched. Newest entries at the top.

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
