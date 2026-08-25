/**
 * QuestionBankCache.js — in-memory cache for approved question_bank_versions rows.
 *
 * Approved versions are immutable (regeneration always creates a NEW version
 * row instead of mutating one in place — see AssessmentGenerator.js /
 * roles.js regenerate-questions), so a version once cached by id never goes
 * stale. There is no invalidation-on-write race to guard against: the only
 * way a version's content could change is if a new id were created, which
 * simply populates a new cache entry.
 */
import { QuestionBankVersions } from './DataStore.js';

const cache = new Map(); // versionId -> version row

export async function getApprovedBankCached(versionId) {
  if (!versionId) return null;
  if (cache.has(versionId)) return cache.get(versionId);
  const version = await QuestionBankVersions.getById(versionId);
  if (version) cache.set(versionId, version);
  return version;
}
