-- Assessment Generation Engine v2 — versioned, frozen question banks and
-- per-employee assignment-by-reference.
--
-- Root problem this fixes: question banks previously lived only as a
-- `questionBank` JSONB array embedded on the `role_library` document, with no
-- history, and employees received independently-sampled/generated question
-- sets copied into `assessments.employeeAssignments[i].questions`. That let
-- question counts and content drift between employees on the same job role.
--
-- With this schema:
--   * A question bank is only ever mutated by INSERTing a new version row
--     (draft -> approved -> archived). Approved rows are treated as immutable.
--   * Every employee assignment references a single question_bank_version_id
--     plus its own shuffle order — no question text is duplicated per user.
--
-- Safe to run multiple times (IF NOT EXISTS guards).

CREATE TABLE IF NOT EXISTS question_bank_versions (
  id                  TEXT PRIMARY KEY,
  role_id             TEXT NOT NULL,
  version             INT NOT NULL,
  status              TEXT NOT NULL CHECK (status IN ('draft','approved','archived')) DEFAULT 'draft',
  questions           JSONB NOT NULL,          -- frozen array once approved; each item carries full metadata
  question_count      INT NOT NULL,
  generation_config    JSONB NOT NULL,          -- { questionCount, stakeholder, processDelivery, difficultyDist, typeDist, requestedByFiles }
  validation_report    JSONB,                   -- structured pass/fail report from validateQuestionBank
  approved_by         TEXT,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE(role_id, version)
);

CREATE INDEX IF NOT EXISTS idx_qbv_role_status ON question_bank_versions(role_id, status);

CREATE TABLE IF NOT EXISTS employee_assessment_assignments (
  id                          TEXT PRIMARY KEY,
  assessment_id               TEXT NOT NULL,
  user_id                     TEXT NOT NULL,
  question_bank_version_id    TEXT NOT NULL REFERENCES question_bank_versions(id),
  question_order              JSONB NOT NULL,   -- array of question IDs, shuffled per employee
  status                      TEXT DEFAULT 'assigned',
  assigned_at                 TIMESTAMPTZ DEFAULT now(),
  submitted_at                TIMESTAMPTZ,
  scoring                     JSONB,
  UNIQUE(assessment_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_eaa_assessment ON employee_assessment_assignments(assessment_id);
CREATE INDEX IF NOT EXISTS idx_eaa_user ON employee_assessment_assignments(user_id);
CREATE INDEX IF NOT EXISTS idx_eaa_version ON employee_assessment_assignments(question_bank_version_id);
