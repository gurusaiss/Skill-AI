/**
 * rescoreZeroReports.mjs
 * ──────────────────────────────────────────────────────────────────────────────
 * One-time fix: re-score assessment reports that were stored with score=0 and
 * total=0 due to the in-progress lock bug that prevented resolveEmployeeQuestions
 * from resolving version-backed questions at submission time.
 *
 * Usage (run from the project root on the company server):
 *   node --experimental-vm-modules server/scripts/rescoreZeroReports.mjs [--dry-run]
 *
 * What it does:
 *   1. Loads every assessment_report where score=0 AND total=0 AND correct=0
 *   2. Finds the matching assessment + employeeAssignments entry
 *   3. Re-resolves questions from the question_bank_version (same logic as submit)
 *   4. Re-scores using responses stored on the assignment (draftAnswers or responses)
 *   5. Writes the corrected score/rating/breakdown back to the report and roster
 *
 * Flags:
 *   --dry-run   Print what would be changed without writing anything
 *   --after YYYY-MM-DD  Only re-score reports submitted after this date (default: 2026-11-19)
 */

import 'dotenv/config';
import { Reports, EmployeeAssessmentAssignments, QuestionBankVersions } from '../services/DataStore.js';
import { Assessments } from '../services/DataStore.js';
import { percentFromCounts, ratingFromPercent } from '../services/grading.js';
import { isMcqCorrect } from '../services/answerMatching.js';
import { acceptedTextAnswers } from '../services/answerMatching.js';

const DRY_RUN = process.argv.includes('--dry-run');
const afterIdx = process.argv.indexOf('--after');
const AFTER_DATE = afterIdx >= 0 ? new Date(process.argv[afterIdx + 1]) : new Date('2026-11-19T00:00:00.000Z');

console.log(`\n=== SkillForge: Re-score Zero Reports ===`);
console.log(`Mode      : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE (will update DB)'}`);
console.log(`After     : ${AFTER_DATE.toISOString()}\n`);

// ── Helper: score a set of responses against questions ────────────────────────
function scoreResponses(questions, responses) {
  let correct = 0;
  const breakdown = [];
  questions.forEach((q, i) => {
    const resp = responses[i] || { answer: '' };
    const userAnswer = resp.answer || '';
    let isCorrect = false;
    const isMcq = q.type === 'mcq' || q.type === 'multiple_choice';
    if (isMcq) {
      isCorrect = isMcqCorrect(userAnswer, q);
    } else {
      const kind = (q.type === 'fill_blank' || q.type === 'fill_in_blank') ? 'fill_blank' : 'subjective';
      isCorrect = acceptedTextAnswers(q.answer).some(alt => isAnswerCorrect(userAnswer, alt, kind));
    }
    if (isCorrect) correct++;
    breakdown.push({ questionIndex: i, question: q.question, type: q.type, userAnswer: userAnswer || null, isCorrect });
  });
  const total = questions.length;
  const rawScore = percentFromCounts(correct, total);
  const score = Math.round(rawScore);
  const rating = ratingFromPercent(rawScore);
  return { correct, total, score, rawScore, rating, breakdown };
}

// Minimal answer-correctness for text questions
function isAnswerCorrect(userAnswer, correctAnswer, kind) {
  const normalise = s => String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const ua = normalise(userAnswer);
  const ca = normalise(correctAnswer);
  if (!ua) return false;
  if (ua === ca) return true;
  if (ca.length > 2 && ua.includes(ca)) return true;
  if (ua.length > 2 && ca.includes(ua)) return true;
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const allReports = await Reports.getAll();
  const zeroReports = allReports.filter(r => {
    const isZero = Number(r.score) === 0 && Number(r.total) === 0 && Number(r.correct) === 0;
    const isRecent = r.submittedAt && new Date(r.submittedAt) >= AFTER_DATE;
    return isZero && isRecent;
  });

  console.log(`Found ${allReports.length} total reports.`);
  console.log(`Found ${zeroReports.length} zero-scored reports submitted after ${AFTER_DATE.toDateString()}.\n`);

  if (zeroReports.length === 0) {
    console.log('Nothing to fix. If scores are still wrong on screen, the server may not have been restarted yet.');
    return;
  }

  let fixed = 0, skipped = 0, failed = 0;

  for (const report of zeroReports) {
    const { id: reportId, assessmentId, userId, userName, submittedAt } = report;
    console.log(`\n── Report: ${reportId} | User: ${userName} | Submitted: ${submittedAt}`);

    try {
      // 1. Load assessment
      const assessment = await Assessments.getById(assessmentId);
      if (!assessment) { console.warn('  ⚠ Assessment not found, skipping.'); skipped++; continue; }

      // 2. Find this employee's assignment entry
      const assignment = assessment.employeeAssignments?.find(ea => ea.userId === userId);
      if (!assignment) { console.warn('  ⚠ Employee assignment not found, skipping.'); skipped++; continue; }

      // 3. Find stored responses: check assignment.responses, then draftAnswers
      let storedResponses = null;
      if (Array.isArray(assignment.responses) && assignment.responses.length > 0) {
        storedResponses = assignment.responses;
        console.log(`  ✓ Found ${storedResponses.length} responses on assignment.responses`);
      } else if (assignment.draftAnswers && typeof assignment.draftAnswers === 'object') {
        // draftAnswers is { [idx]: value } object from handleAnswer
        const keys = Object.keys(assignment.draftAnswers);
        if (keys.length > 0) {
          const maxIdx = Math.max(...keys.map(Number));
          storedResponses = new Array(maxIdx + 1).fill({ answer: '' });
          for (const [k, v] of Object.entries(assignment.draftAnswers)) {
            storedResponses[Number(k)] = { answer: String(v ?? '') };
          }
          console.log(`  ✓ Found ${keys.length} draft answers (converted to responses array)`);
        }
      }

      if (!storedResponses || storedResponses.length === 0) {
        console.warn('  ⚠ No responses or draft answers found, cannot re-score. Employee must retake.');
        skipped++;
        continue;
      }

      // 4. Resolve questions from the question bank version
      let questions = null;
      if (assessment.questionBankVersionId) {
        try {
          const eaaRow = await EmployeeAssessmentAssignments.getOne(assessment.id, userId).catch(() => null);
          const version = await QuestionBankVersions.getById(assessment.questionBankVersionId);
          if (version?.questions?.length) {
            const allowedBank = version.questions.filter(q => q.locked === true || q.locked === 'true');
            const byId = new Map(allowedBank.map(q => [q.id, q]));
            const storedOrder = eaaRow?.question_order?.length ? eaaRow.question_order : [];
            const orderedIds = storedOrder.filter(qid => byId.has(qid));
            const order = orderedIds.length > 0 ? orderedIds : allowedBank.map(q => q.id);
            questions = order.map(qid => byId.get(qid)).filter(Boolean);
            console.log(`  ✓ Resolved ${questions.length} questions from question bank version`);
          }
        } catch (e) {
          console.warn('  ⚠ Failed to resolve from bank version:', e.message);
        }
      }

      // Fallback: embedded questions on assignment
      if (!questions || questions.length === 0) {
        if (Array.isArray(assignment.questions) && assignment.questions.length > 0) {
          questions = assignment.questions;
          console.log(`  ✓ Fallback: using ${questions.length} embedded questions from assignment`);
        }
      }

      if (!questions || questions.length === 0) {
        console.warn('  ⚠ Cannot resolve questions, skipping. Employee must retake.');
        skipped++;
        continue;
      }

      // 5. Normalise responses to same length as questions
      const responses = new Array(questions.length).fill({ answer: '' });
      storedResponses.forEach((r, i) => {
        if (i < questions.length) responses[i] = { answer: String(r?.answer ?? '') };
      });

      const answeredCount = responses.filter(r => r.answer).length;
      console.log(`  ✓ ${answeredCount}/${questions.length} questions answered`);

      // 6. Re-score
      const scoring = scoreResponses(questions, responses);
      console.log(`  → Score: ${scoring.score}% | Rating: ${scoring.rating} | Correct: ${scoring.correct}/${scoring.total}`);

      if (DRY_RUN) {
        console.log('  [DRY RUN] Would update report and assignment — no write made.');
        fixed++;
        continue;
      }

      // 7. Write corrected values back to report
      await Reports.update(reportId, {
        score: scoring.score,
        rawScore: scoring.rawScore,
        correct: scoring.correct,
        total: scoring.total,
        rating: scoring.rating,
        breakdown: scoring.breakdown,
        rescoredAt: new Date().toISOString(),
        rescoredReason: 'zero-report-fix: version-backed question resolution bug',
      });

      // 8. Write corrected scoring back to the assignment roster entry
      const updatedAssignments = assessment.employeeAssignments.map(ea => {
        if (ea.userId !== userId) return ea;
        return {
          ...ea,
          scoring: {
            ...(ea.scoring || {}),
            score: scoring.score,
            rawScore: scoring.rawScore,
            correct: scoring.correct,
            total: scoring.total,
            rating: scoring.rating,
          },
        };
      });
      await Assessments.update(assessmentId, {
        employeeAssignments: updatedAssignments,
        updatedAt: new Date().toISOString(),
      });

      console.log(`  ✅ Fixed!`);
      fixed++;
    } catch (e) {
      console.error(`  ✗ Error processing ${reportId}:`, e.message);
      failed++;
    }
  }

  console.log(`\n════════════════════════════════`);
  console.log(`Fixed : ${fixed}`);
  console.log(`Skipped: ${skipped} (no responses saved — employee must retake)`);
  console.log(`Failed : ${failed}`);
  if (DRY_RUN) console.log('\n[DRY RUN] No changes were written to the database.');
  console.log('');
}

main().catch(e => { console.error('[rescoreZeroReports] Fatal:', e); process.exit(1); });
