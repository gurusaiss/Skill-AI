/**
 * ReminderSweep.js — automated "deadline approaching" assessment reminders.
 *
 * No generic cron/job runner exists in this codebase — the only precedent is
 * AutonomousScheduler's own internal setInterval (a different domain:
 * background agent briefs, every 6h). This follows the same "one dedicated
 * setInterval" pattern rather than introducing a new scheduling dependency.
 *
 * Idempotent by construction: before sending, checks whether a Reminders row
 * of type 'auto_deadline' already exists for that (assessment, employee)
 * pair — if so, skips it, so restarting the server or a slow sweep cycle can
 * never double-send.
 */
import { EmployeeAssessmentAssignments, Assessments, Reminders } from './DataStore.js';
import UserStore from './UserStore.js';
import EmailService from './EmailService.js';

const SWEEP_INTERVAL_MS = 60 * 60 * 1000; // hourly
// Reminder fires once due_at falls within this window — not the instant it's
// set, and not after it's already passed (that's the employee's own problem
// to resolve with their manager, not an automated nag after the fact).
const WINDOW_START_MS = 48 * 60 * 60 * 1000; // 48h out
const WINDOW_END_MS = 0; // up to the deadline itself

async function runSweep() {
  try {
    const [rows, assessments] = await Promise.all([EmployeeAssessmentAssignments.getAll(), Assessments.getAll()]);
    const assessmentById = new Map((assessments || []).map(a => [a.id, a]));
    const now = Date.now();

    const candidates = (rows || []).filter(r => {
      if (r.status === 'submitted') return false;
      if (!r.due_at) return false;
      const dueMs = new Date(r.due_at).getTime();
      const msUntilDue = dueMs - now;
      return msUntilDue <= WINDOW_START_MS && msUntilDue >= WINDOW_END_MS;
    });

    let sent = 0;
    for (const row of candidates) {
      const assessment = assessmentById.get(row.assessment_id);
      if (!assessment || assessment.isActive === false) continue;

      // Idempotency: never send a second auto_deadline reminder for the same
      // (assessment, employee) pair, regardless of how many sweep cycles run
      // before the deadline arrives.
      const already = await Reminders.getLatest(row.assessment_id, row.user_id, 'auto_deadline');
      if (already) continue;

      const employee = await UserStore.getUserById(row.user_id);
      if (!employee?.email) {
        await Reminders.create({ assessmentId: row.assessment_id, employeeId: row.user_id, type: 'auto_deadline', deliveryStatus: 'failed', errorMessage: 'Employee has no email on file' });
        continue;
      }
      if (!EmailService.isEnabled()) {
        // Don't spin forever re-attempting when email simply isn't
        // configured on this deployment — log once as failed so the
        // idempotency check above stops re-selecting this row every cycle.
        await Reminders.create({ assessmentId: row.assessment_id, employeeId: row.user_id, type: 'auto_deadline', deliveryStatus: 'failed', errorMessage: 'Email is not configured on this server' });
        continue;
      }

      const deadlineText = new Date(row.due_at).toLocaleString();
      const subject = `Reminder: "${assessment.title}" is due soon`;
      const htmlBody = `<p>Hi ${employee.name || 'there'},</p><p>Your assessment — <strong>${assessment.title}</strong> — is due by <strong>${deadlineText}</strong> and hasn't been completed yet.</p>`;
      const textBody = `Hi ${employee.name || 'there'}, your assessment "${assessment.title}" is due by ${deadlineText} and hasn't been completed yet.`;

      const result = await EmailService.sendEmail(employee.email, subject, htmlBody, textBody);
      await Reminders.create({
        assessmentId: row.assessment_id, employeeId: row.user_id, type: 'auto_deadline',
        deliveryStatus: result?.success ? 'sent' : 'failed',
        errorMessage: result?.success ? null : (result?.error || 'Unknown email error'),
      });
      if (result?.success) sent++;
    }

    if (candidates.length > 0) {
      console.log(`[ReminderSweep] Checked ${candidates.length} approaching-deadline assignment(s), sent ${sent} new reminder(s)`);
    }
  } catch (e) {
    console.error('[ReminderSweep] cycle failed:', e.message);
  }
}

export function startReminderSweep() {
  setInterval(runSweep, SWEEP_INTERVAL_MS);
  console.log('[ReminderSweep] Started — checking for approaching deadlines every hour');
}
