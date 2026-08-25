-- Assessment Lock / Unlock / Regenerate workflow — additive schema change.
--
-- "Locked"/"Unlocked" reuse the existing question_bank_versions.status
-- (draft/approved/archived) and approved_at/approved_by columns — a version
-- is "Locked" once approved, never mutated in place after that. The only
-- genuinely new state this workflow needs is WHEN a role was most recently
-- unlocked (i.e. when the draft that supersedes a locked version was
-- created) and WHO did it, for audit/display purposes.
--
-- Safe to re-run (IF NOT EXISTS guards).

ALTER TABLE question_bank_versions ADD COLUMN IF NOT EXISTS unlocked_at TIMESTAMPTZ;
ALTER TABLE question_bank_versions ADD COLUMN IF NOT EXISTS unlocked_by TEXT;
