# Database Architecture Review — Skill Forge
Date: 2026-06-19 | Analyst: Claude Code | Status: ANALYSIS ONLY — no changes made

---

## Database Overview

The database has **28 tables** across two distinct storage systems:

| Storage System | Tables | Schema Pattern |
|---|---|---|
| `DataStore.js` (newer) | 17 tables | JSONB `{ id TEXT PK, data JSONB }` |
| `db/store.js` (older) | 11 tables | Flat relational columns |

This dual-system architecture is the single biggest structural issue. It works correctly today because both systems have file-based fallbacks, but it means there are two code paths, two query styles, and inconsistent scoping behavior. No tables are unused — every table has active read/write code paths. The architecture is sound for its current scale but has three issues that will matter before enterprise scale: multi-tenancy gaps, no database-enforced relationships (JSONB stores everything), and the sessions table disconnect.

Overall quality: **Functional. Not yet enterprise-ready. No critical failures, several forward risks.**

---

## Table Review

### Core User & Auth Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `users` | Central user registry — all roles (superadmin, admin, manager, employee) | `UserStore.js`, every route | **KEEP** | Core identity table. Single source of truth. |
| `activation_tokens` | Email verification tokens for account activation flow | `DataStore.ActivationTokens`, `auth.js` | **KEEP** | Needed for the email invite + activate workflow. Short-lived records. |

---

### Company & Structure Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `companies` | Multi-tenant company registry — stores companyCode, name, settings | `DataStore.Companies`, `superadmin.js`, `auth.js` | **KEEP** | Core to multi-tenancy. Company codes, admin linking, self-registration all depend on it. |
| `organizations` | Earlier abstraction for org hierarchy (pre-companies) | `DataStore.Organizations`, `organizations.js` | **REVIEW** | Conceptually overlaps with `companies`. In code, Organizations are treated as sub-units or a legacy layer. Needs clarification on whether this is a sub-tenant concept (division within a company) or a duplicate of companies. |
| `departments` | Org units within an organization | `DataStore.Departments`, `organizations.js` | **KEEP** | Enterprise org structure. Part of org → dept → team hierarchy. Needed for manager scoping. |
| `teams` | Sub-units within departments | `DataStore.Teams`, `organizations.js` | **KEEP** | Part of the org hierarchy. Manager-scoped views depend on this. |

**Risk:** The `organizations` → `departments` → `teams` hierarchy exists in parallel with `companies`. It is not yet clear in the code whether organizations.companyId links back to companies. If they are independent trees, data written to one is invisible to the other. Needs verification.

---

### Assessment Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `assessments` | Assessment definitions — questions, target roles, settings | `DataStore.Assessments`, `assessment.js` | **KEEP** | Core to the product. Auto-generated and manually created assessments both land here. |
| `assessment_submissions` | Employee answers and scores | `DataStore.Submissions`, `assessment.js` | **KEEP** | Separate from the assessment definition intentionally — one assessment can have many submissions per employee (retakes). |
| `assessment_reports` | Post-submission AI analysis and performance classification | `DataStore.Reports`, `assessment.js` | **KEEP** | Needed. Reports are generated after submission and contain more data than the submission itself (tier classification, recommendations). |
| `assessment_thresholds` | Per-company configurable performance tier settings | `DataStore.AssessmentThresholds`, `assessment.js` | **KEEP** | Recently added. One record per company. Correctly designed. |

**Note:** `assessments`, `assessment_submissions`, `assessment_reports` are three separate tables for a reason — the assessment lifecycle has three distinct states. Do not merge.

---

### Module & Content Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `modules` | Training module definitions — title, content, sessions, skills | `db/store.js`, `modules.js` | **KEEP** | Core content unit. Uses flat schema (older system). |
| `pending_modules` | AI-generated modules awaiting admin approval before publishing | `DataStore.PendingModules`, `modules.js` | **KEEP** | Needed for the content review approval gate. Without this, AI-generated content would go live immediately. |
| `assignments` | Links modules to employees/groups with due dates and progress | `db/store.js`, `assignments.js` | **KEEP** | The core assignment record. Tracks per-user progress. |
| `module_assignments` | Secondary assignment tracking (JSONB pattern) | `DataStore.ModuleAssignments`, routes | **REVIEW** | Potentially duplicates `assignments`. Both tables track module→user links. Need to confirm these are used for different assignment types (e.g., individual vs group) or if one is legacy. |
| `packages` | Named collections of modules bundled together | `db/store.js`, `content.js` | **KEEP** | Distinct from modules — a package is a curated bundle. Used for structured curriculum delivery. |
| `skill_packages` | Module collections organized by skill axis | `db/store.js`, `content.js` | **REVIEW** | Functionally similar to `packages`. Both are "collection of modules." Difference is the grouping axis (skill vs general). May be mergeable into packages with a `type` field — but only merge if the data shapes are truly compatible. |
| `learning_tracks` | Sequential ordered learning paths | `db/store.js`, `content.js` | **KEEP** | Distinct concept — a learning track defines order and progression rules. Not the same as a package. |
| `assignment_requests` | Employee self-request for a module/package | `db/store.js`, `assignments.js` | **KEEP** | Needed for the approval workflow — employees request, admin approves. |

---

### Role & JD Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `role_library` | Company-scoped master list of job roles with JD and skills | `DataStore.RoleLibrary`, `roles.js` | **KEEP** | Source of truth for job descriptions and skill mappings. Central to auto-assessment generation. |
| `user_jd_profiles` | Per-user snapshot of their JD and skills at time of onboarding | `DataStore.UserJDProfiles`, `users.js`, `auth.js` | **KEEP** | Needed. Separate from role_library — a user's JD is a point-in-time snapshot. If the role's JD is updated in role_library, the user's assessment should reflect their JD at hire time, not the updated one. |

---

### Generated Content & AI Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `generated_content` | Audit log of all AI-generated content for admin review | `DataStore.GeneratedContent`, `assessment.js` | **KEEP** | Recently added. Needed for the content review workflow — admins see what was auto-generated and when. |

---

### Social / Group Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `groups` | Named employee groups for bulk assignment and scoping | `DataStore.Groups` + `db/store.js`, `groups.js` | **KEEP** | Note: `groups` is read by TWO different store systems. DataStore and db/store both query it. Risk of inconsistency. |
| `group_memberships` | Junction table mapping users to groups | `db/store.js`, `groups.js` | **KEEP** | Correct design for a many-to-many relationship. |

---

### Operations & Infrastructure Tables

| Table | Purpose | Used By | Status | Reason |
|---|---|---|---|---|
| `notifications` | In-app user notification records | `db/store.js`, `notifications.js` | **KEEP** | Active. Read/write confirmed in store.js. |
| `audit_logs` | Platform-wide event log (user actions, admin operations) | `db/store.js`, `audit.js` | **KEEP** | Enterprise compliance requirement. Needed. |
| `approval_requests` | Module/content approval requests and decisions | `DataStore.ApprovalRequests`, `approvals.js` | **KEEP** | Powers the admin approval center. |
| `employee_checklists` | Per-employee onboarding and task checklists | `DataStore.EmployeeChecklists` | **KEEP** | Onboarding flow. One record per user (keyed by userId). |
| `sessions` | Learning session data (per-user AI tutor sessions) | `migrate_to_supabase.js` only | **REVIEW** | **Critical gap.** The live session system reads/writes `{uuid}.json` flat files in `server/data/`. The Supabase `sessions` table is only written by the one-time migration script. In production (Render), flat files are ephemeral and wiped on restart. Session data is currently at risk of loss unless the migration script was run after every new user. The DataStore / session.js routes do NOT write to this table. |

---

## Multi-Tenant Review

### What is correctly isolated

- `users` — every user record has a `companyId` field
- `role_library` — `getByCompany(companyId)` filter enforced in DataStore
- `generated_content` — `getByCompany(companyId)` filter enforced
- `assessment_thresholds` — keyed by companyId
- `companies` — isolated by definition

### Risks identified

**Risk 1 — Application-layer-only isolation (no DB enforcement)**

All multi-tenant filtering is done in application code, not at the database level. The JSONB pattern stores `companyId` inside the `data` JSONB blob. Supabase RLS cannot filter on JSONB internals without generated columns or custom policies. This means:

- If application code has a bug, Company A's data can be returned to Company B
- There is no database-level safety net preventing cross-company reads

Affected tables: `assessments`, `assessment_submissions`, `assessment_reports`, `generated_content`, `role_library`, `user_jd_profiles`, `employee_checklists`

**Risk 2 — modules, packages, assignments have no visible companyId**

The `modules`, `packages`, `skill_packages`, `learning_tracks`, `assignments` tables use flat column schemas in `db/store.js`. The schema does not show a `companyId` column. If these tables are shared across all companies, a Company A employee could be assigned Company B's modules. This needs verification.

**Risk 3 — organizations table may not be linked to companies**

The `DataStore.Organizations` and `DataStore.Departments` code filters by `org_id` but it is not confirmed that each `organization` record links back to a `companyId`. If organizations are not scoped to a company, an admin from one company could see another company's org structure.

**Risk 4 — groups table has dual writers**

`groups` is written by both `DataStore.Groups` (JSONB pattern) and `db/store.js` (flat pattern). The two systems use different query structures. A group written via DataStore uses `{ id, data: {...} }` — a group written via db/store uses flat columns. Reading from one system will not see records written by the other unless both systems produce compatible rows. Verified: DataStore groups.js does query `id, data` specifically. This needs a careful audit of which routes use which store.

---

## Storage Review

### Where storage is being consumed

| Area | Concern | Severity |
|---|---|---|
| `assessments` JSONB | Each assessment stores full question arrays (10-50 questions) with options and answers inside one JSONB blob | Medium — grows with scale |
| `assessment_submissions` JSONB | Stores full user answers for every submission | Medium |
| `sessions` flat files | `server/data/*.json` files — each UUID file stores an entire learning session including full LLM conversation history | **High** — these files are large (500KB–2MB each based on the sample JSON files in the repo) and grow unboundedly |
| `modules` content column | Module content is stored inline in the modules table and stripped on upsert if too large (code has a retry without content field) | Medium — the retry-without-content means some modules may silently lose their content |
| `audit_logs` | Append-only, no TTL or archiving | Low now, grows forever |
| `notifications` | No cleanup/archiving | Low now |

### Storage optimization opportunities (do not implement yet)

1. Session flat files (`server/data/*.json`) are the largest storage consumers. These should be persisted to the `sessions` Supabase table rather than disk — the migration script exists but the live code path doesn't use it.
2. Assessment JSONB blobs could be split if question banks grow large, but this is premature at current scale.
3. `audit_logs` and `notifications` should eventually have a retention policy (e.g. keep 90 days) — not needed yet.

---

## Performance Review

### Missing indexes (suspected — cannot confirm without schema column definitions)

The JSONB `data` column pattern means most filtering is done by loading all rows and filtering in JavaScript (e.g., `getAll()` then `.filter()`). This is fine at hundreds of records but becomes a bottleneck at thousands.

| Table | Query Pattern | Risk |
|---|---|---|
| `assessments` | `getAll()` → filter by `companyId`, `userId`, `roleName` in JS | High at scale |
| `assessment_submissions` | `getAll()` → filter by `userId` or `assessmentId` in JS | High at scale |
| `assessment_reports` | `getAll()` → filter by `userId` in JS | Medium |
| `role_library` | `getAll()` → filter by `companyId` in JS | Medium |
| `generated_content` | `getAll()` → filter by `companyId` in JS | Medium |
| `notifications` | Supabase `.eq('user_id', userId)` | OK — column exists |
| `audit_logs` | Supabase `.eq('user_id', userId)` | OK — column exists |

### Slow query risks

- `Assessments.getAll()` is called on every assessment-related page load. At 10,000+ assessments this becomes slow. The JSONB pattern has no way to add a Postgres index on `data->>'companyId'` without a generated column.
- `getAllHealed()` performs a Supabase read AND a file read on every call. At high request rates, this doubles I/O.

### Dual-store system risk

`groups` is queried by two different systems. A future developer adding a group via one system that gets read by another is a real bug risk. This inconsistency will become a production incident at some point.

---

## Enterprise Readiness Review

| Dimension | Current State | Enterprise Ready? |
|---|---|---|
| Data isolation | Application-level only, no DB enforcement | No |
| Tenant scoping | Inconsistent — some tables scoped, others not confirmed | Partial |
| Session persistence | Flat files on Render (ephemeral) | No |
| Indexes | None on JSONB fields (cannot add without schema change) | No |
| Relationship enforcement | None — JSONB stores references as strings | No |
| Audit trail | Yes — audit_logs table active | Yes |
| Multi-company | Yes — companies + companyCode system works | Yes |
| Bulk operations | Yes — bulk import in users.js | Yes |
| Content review workflow | Yes — generated_content + ContentReview page | Yes |
| Configurable per-company | Yes — assessment_thresholds | Yes |
| Horizontal scalability | Blocked by file-based session storage | No |

**Summary:** The platform handles its current load well and all features work. It is not yet ready for thousands of concurrent users across dozens of companies because of the session storage gap, the application-only multi-tenancy enforcement, and the JSONB query pattern at scale.

---

## Recommended Next Actions

Listed in order of risk priority. No implementation — analysis only.

### Priority 1 — Critical

1. **Fix session persistence.** The `sessions` Supabase table exists and the migration script works, but the live session code still reads/writes `{uuid}.json` flat files. On Render these files are wiped on every restart. Either route live session reads/writes through Supabase, or document and accept that session data is ephemeral. This is the most likely source of user-reported data loss.

2. **Confirm companyId scoping on modules, packages, assignments.** Check whether these flat-schema tables have a `company_id` column. If not, a Company A admin can currently assign Company B modules to their employees. This is the most serious multi-tenancy gap.

3. **Clarify organizations vs companies.** Determine if `organizations` is a sub-entity of a company (i.e., each org has a companyId foreign key) or if they are parallel competing concepts. If parallel, the organization features are not multi-tenant-safe.

### Priority 2 — Important

4. **Resolve the groups dual-writer problem.** Pick one store system as the source of truth for groups. Migrate the other system's routes to use the same store. The current dual-writer risk is silent data inconsistency.

5. **Add companyId as a Supabase-native column to high-traffic JSONB tables.** For `assessments`, `role_library`, `generated_content`, add a real `company_id` column alongside the JSONB `data` blob. This enables native Postgres indexes and real RLS policies.

6. **Evaluate skill_packages vs packages.** Review whether these two tables can be unified with a `type` or `subtype` field. Merging is only recommended if the data shapes are identical — do not merge if they serve genuinely different UX purposes.

### Priority 3 — Before Scale

7. **Add a Postgres generated column + index** on `data->>'companyId'` for the four highest-traffic JSONB tables (assessments, role_library, generated_content, assessment_reports). This converts full-table scans into indexed lookups.

8. **Add retention policy for audit_logs and notifications.** At 1,000 users doing 10 actions/day, audit_logs grows by 10,000 records/day. After one year that's 3.6M rows. Add a scheduled cleanup or archive to cold storage.

9. **Document and standardize the two-store system.** Either migrate all tables to the JSONB DataStore pattern or all to the flat-column store.js pattern. Having both doubles maintenance burden.

10. **Review module_assignments vs assignments.** Confirm whether these are used for different purposes (group assignments vs individual assignments) or if one is a legacy table that can be retired after data migration.

---

*No schema changes, migrations, or SQL were executed. This is analysis only. All recommendations require approval before implementation.*
