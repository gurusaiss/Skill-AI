/**
 * quarterArchive.js — pure helpers for the Role Library "New Generation" flow.
 * No I/O: callers pass in the role / versions / existing archives, so this is
 * trivially testable. A snapshot is a DEEP COPY of a question bank, stored in
 * its own collection (QuestionBankArchives) so later edits/locks of the live
 * question_bank_versions rows can never alter it.
 */
import { randomUUID } from 'crypto';

// JSON round-trip deep copy: question banks are plain JSON (they come from
// JSONB / JSON files), and this also strips any shared references.
export function deepCopy(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

// Next quarter number for a role = max(existing numbers, existing count) + 1.
export function nextQuarterNumber(existingArchives = []) {
  const nums = existingArchives.map(a => Number(a?.quarterNumber) || 0);
  return Math.max(existingArchives.length, ...nums, 0) + 1;
}

export function quarterLabel(n) { return `Q${n}`; }

// Which bank to archive: the approved version; else the latest version that
// has questions; else the legacy role.questionBank; else null (nothing to archive).
export function pickArchiveSource(versions = [], role = {}) {
  const approved = versions.find(v => v?.status === 'approved' && (v.questions || []).length > 0);
  if (approved) return { id: approved.id, version: approved.version, questions: approved.questions };
  for (let i = versions.length - 1; i >= 0; i--) {
    const v = versions[i];
    if ((v?.questions || []).length > 0) return { id: v.id, version: v.version, questions: v.questions };
  }
  if (Array.isArray(role?.questionBank) && role.questionBank.length > 0) {
    return { id: null, version: null, questions: role.questionBank };
  }
  return null;
}

export function buildArchiveDoc({ role, source, existingArchives = [], userId }) {
  const quarterNumber = nextQuarterNumber(existingArchives);
  const questions = deepCopy(source.questions);
  return {
    id: `qba-${role.id}-q${quarterNumber}-${randomUUID()}`,
    roleId: role.id,
    companyId: role.companyId || 'default',
    roleName: role.roleName || null,
    label: quarterLabel(quarterNumber),
    quarterNumber,
    createdAt: new Date().toISOString(),
    createdBy: userId || null,
    questionCount: questions.length,
    sourceVersionId: source.id || null,
    sourceVersion: source.version ?? null,
    questions,
  };
}

// Idempotency: a retried New Generation (previous run failed, or a second click
// before anything new was approved) must not mint a duplicate quarter for the
// exact same content. Reuse the latest archive if it has the same source and
// byte-identical questions.
export function findIdenticalArchive(existingArchives = [], source) {
  const last = [...existingArchives].sort((a, b) => (a.quarterNumber || 0) - (b.quarterNumber || 0)).pop();
  if (!last) return null;
  if ((last.sourceVersionId || null) !== (source.id || null)) return null;
  return JSON.stringify(last.questions) === JSON.stringify(source.questions) ? last : null;
}

// List-view projection: metadata only, no question bodies.
export function archiveSummary(a) {
  return {
    id: a.id, label: a.label, quarterNumber: a.quarterNumber, createdAt: a.createdAt,
    createdBy: a.createdBy, questionCount: a.questionCount,
    sourceVersionId: a.sourceVersionId, sourceVersion: a.sourceVersion,
  };
}
