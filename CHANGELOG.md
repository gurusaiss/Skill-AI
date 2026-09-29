# Changelog

Plain-language release notes for every commit pushed from here on — what changed, why, and which files were touched. Newest entries at the top.

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
