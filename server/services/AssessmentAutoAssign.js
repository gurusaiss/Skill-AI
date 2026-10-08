/**
 * AssessmentAutoAssign.js
 *
 * Shared by users.js (manual employee creation + bulk import) and auth.js
 * (self-registration) — previously each had its OWN copy of this logic with
 * its own hardcoded `pickFromBank(bank, 10)`, silently truncating every new
 * employee's assessment to 10 questions regardless of the role's real
 * approved count (30, 50, etc). Extracted to a single implementation so
 * there is exactly one place this can ever drift from "full approved bank,
 * order-only randomization" again.
 */
import { randomUUID } from 'crypto';
import { RoleLibrary, Assessments, QuestionBankVersions, EmployeeAssessmentAssignments } from './DataStore.js';
import { ASSESSMENT_DURATION_MINUTES } from './assessmentDefaults.js';
import { isRemovedFromAssessment } from './assessmentRoster.js';

const shuffle = arr => [...arr].sort(() => Math.random() - 0.5);

/**
 * Auto-assign a pre-assessment from the Role Library's existing question
 * bank. NO API / LLM calls — uses only pre-approved questions already
 * stored in DB. Every employee gets the COMPLETE bank; only delivery order
 * is randomized, never the question set itself.
 */
export async function autoAssignPreAssessment(user) {
  if (!user.jobRole) return;
  try {
    const companyId = user.companyId || 'default';
    const roleMatch = await RoleLibrary.findByName(user.jobRole, companyId);
    if (!roleMatch) {
      console.warn(`[auto-assessment] No role library entry for "${user.jobRole}" — skipping`);
      return;
    }

    // Prefer the durable, versioned APPROVED bank — the real source of
    // truth once a role has been locked via the Role Library, and the same
    // full bank every other employee with this role already received.
    const approvedVersion = await QuestionBankVersions.getApproved(roleMatch.id);
    const bank = approvedVersion ? approvedVersion.questions : (roleMatch.questionBank || []);

    if (!bank?.length || bank.length < 5) {
      console.warn(`[auto-assessment] Role "${user.jobRole}" has no usable question bank (${bank?.length || 0} q) — skipping`);
      return;
    }

    const userId = user.userId || user.id;
    const assignedAt = new Date().toISOString();

    if (approvedVersion) {
      // Role has a locked/approved assessment already assigned to other
      // employees of this role — join THAT SAME assessment + version, so
      // this employee gets the identical full question set (order only is
      // randomized), matching handleLockAssessment's guarantee.
      const allAssessments = await Assessments.getAll();
      let assessment = allAssessments.find(a => a.fromRoleId === roleMatch.id && a.isActive && (a.companyId || 'default') === companyId);

      if (assessment && isRemovedFromAssessment(assessment, userId)) {
        // An admin deleted this employee's assignment on purpose: never bring it
        // back automatically. Only an explicit POST /:id/assign clears the tombstone.
        console.log(`[auto-assessment] ${user.email} was removed from assessment ${assessment.id} by an admin - not re-assigning`);
        return;
      }

      if (assessment) {
        const alreadyTargeted = (assessment.targetUsers || []).includes(userId);
        if (!alreadyTargeted) {
          const updatedTargets = [...(assessment.targetUsers || []), userId];
          const updatedAssignments = [...(assessment.employeeAssignments || []), {
            userId, userName: user.name, userEmail: user.email, jobRole: user.jobRole,
            status: 'assigned', assignedAt, startedAt: null, submittedAt: null, score: null, report: null,
          }];
          const updates = { targetUsers: updatedTargets, employeeAssignments: updatedAssignments, updatedAt: assignedAt };
          // This assessment may predate the role's approval (created via the
          // unapproved-bank branch below, back when no version existed yet) —
          // in which case it never got a questionBankVersionId, and
          // resolveEmployeeQuestions (assessment.js) has no way to find this
          // employee's actual questions: it gates the entire versioned-bank
          // lookup on assessment.questionBankVersionId being set, and this
          // employee's own roster entry carries no embedded `questions`
          // either (only the very first employees assigned before approval
          // do). Backfilling it here is what actually fixes "approved in
          // Job Library but the employee never gets the assessment" — every
          // later employee joining this same pre-existing assessment was
          // silently getting an unresolvable, question-less assignment.
          if (!assessment.questionBankVersionId) {
            updates.questionBankVersionId = approvedVersion.id;
          }
          // Same correction as the title comment below, applied to an
          // assessment that already exists: if its title still reflects
          // whichever employee's raw job title first created it (e.g.
          // "Process Associate-AMI") rather than the role's own canonical
          // name, fix it now — every employee sharing this same role's bank
          // should see one consistent, role-accurate title.
          const canonicalTitle = `Pre-Assessment: ${roleMatch.roleName}`;
          if (assessment.title !== canonicalTitle && /^Pre-Assessment: /.test(assessment.title || '')) {
            updates.title = canonicalTitle;
          }
          await Assessments.update(assessment.id, updates);
        }
      } else {
        // Bank was approved but never locked/assigned to anyone yet (e.g.
        // the very first employee with this role) — create the thin
        // roster-only assessment record, same shape as handleLockAssessment.
        assessment = {
          id: randomUUID(),
          title: `${roleMatch.roleName} Assessment`,
          targetUsers: [userId],
          employeeAssignments: [{
            userId, userName: user.name, userEmail: user.email, jobRole: user.jobRole,
            status: 'assigned', assignedAt, startedAt: null, submittedAt: null, score: null, report: null,
          }],
          questionCount: bank.length,
          questionTypes: ['mcq', 'fill_blank', 'subjective'],
          duration: ASSESSMENT_DURATION_MINUTES, createdBy: 'system', companyId,
          isAutoGenerated: true, autoTrigger: 'user_onboarding',
          fromRoleId: roleMatch.id,
          questionBankVersionId: approvedVersion.id,
          createdAt: assignedAt, updatedAt: assignedAt, isActive: true,
        };
        await Assessments.create(assessment);
      }

      // Resolve THIS employee's own start/due date from the assessment's
      // scheduling policy — same immutable-at-assignment-time rule as
      // handleLockAssessment (roles.js): a 'relative' policy means this
      // employee's due date is anchored to the moment THEY joined this
      // assessment (right now), not a copy of an earlier employee's
      // deadline, which would give a late joiner an unfair/already-expired
      // window. `schedulingPolicy` predates this employee's join if the
      // assessment was created before this feature existed — treat that as
      // legacy 'fixed' with whatever `assessment.deadline` already holds.
      const policy = assessment.schedulingPolicy || { mode: 'fixed', fixedDeadline: assessment.deadline || null };
      const dueAt = policy.mode === 'relative'
        ? new Date(Date.now() + policy.durationDays * 86400000).toISOString()
        : policy.fixedDeadline;

      const bankIds = bank.map(q => q.id);
      await EmployeeAssessmentAssignments.bulkCreate([{
        assessmentId: assessment.id,
        userId,
        questionBankVersionId: approvedVersion.id,
        questionOrder: shuffle(bankIds),
        status: 'assigned',
        assignedAt,
        startAt: assignedAt,
        dueAt,
      }]);

      console.log(`[auto-assessment] Assigned "${user.email}" (${user.jobRole}) to versioned assessment ${assessment.id} — full bank of ${bank.length} questions`);
    } else {
      // No approved version yet — legacy embedded-question path, but using
      // the FULL bank (whatever size it genuinely is), never truncated.
      // This branch creates a NEW assessment on every call, so a deleted
      // assignment on an existing active assessment of the role must stop it.
      const existingForRole = (await Assessments.getAll())
        .filter(a => a.fromRoleId === roleMatch.id && a.isActive !== false && (a.companyId || 'default') === companyId);
      if (existingForRole.some(a => isRemovedFromAssessment(a, userId))) {
        console.log(`[auto-assessment] ${user.email} was removed from an assessment for role "${roleMatch.roleName}" by an admin - not re-assigning`);
        return;
      }
      const assessment = {
        id: randomUUID(),
        // Titled from the matched Job Library role's own canonical name, not
        // this specific employee's raw typed job title — otherwise whichever
        // employee happened to create this shared assessment first (e.g. one
        // whose title was typed as "Process Associate-AMI", a fuzzy-matched
        // variant of the "Process Associate" role) permanently sets a
        // confusing title for every other employee who later joins the same
        // assessment via a plain, exact match to that same role.
        title: `Pre-Assessment: ${roleMatch.roleName}`,
        targetUsers: [userId],
        employeeAssignments: [{
          userId, userName: user.name, userEmail: user.email,
          jobRole: user.jobRole, questions: shuffle(bank), status: 'assigned',
          assignedAt, startedAt: null, submittedAt: null,
        }],
        questionCount: bank.length, questionTypes: ['mcq'], duration: ASSESSMENT_DURATION_MINUTES,
        createdBy: 'system', companyId,
        isAutoGenerated: true, autoTrigger: 'user_onboarding',
        fromRoleId: roleMatch.id,
        createdAt: assignedAt, updatedAt: assignedAt, isActive: true,
      };
      await Assessments.create(assessment);
      console.log(`[auto-assessment] Assigned to ${user.email} (${user.jobRole}) — ${bank.length} questions from unapproved bank`);
    }
  } catch (e) {
    console.error(`[auto-assessment] Failed for ${user.email}:`, e.message);
  }
}
