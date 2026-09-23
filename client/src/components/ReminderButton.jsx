import React from 'react';
import { useReminder } from '../hooks/useReminder.js';
import { useNotification } from '../contexts/NotificationContext.jsx';

const COMPLETED_STATUSES = new Set(['submitted', 'completed', 'cancelled']);

function hoursAgo(iso) {
  return Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 3600000));
}

/**
 * Shared "Send Reminder" action — used by both the admin assignment table
 * (AssessmentManagement.jsx) and the manager dashboard's employee list.
 * Hidden entirely for completed/cancelled assignments; shows a disabled
 * "Sent Xh ago" state during the 24h server-enforced cooldown so a manager
 * can't accidentally spam the same employee.
 */
export default function ReminderButton({ assessmentId, userId, status, lastSentAt, onSent }) {
  const { sendReminder, isSending, cooldownRemaining } = useReminder();
  const { notify } = useNotification();

  if (COMPLETED_STATUSES.has(status)) return null;

  const onCooldown = cooldownRemaining(lastSentAt) > 0;
  const sending = isSending(assessmentId, userId);

  if (onCooldown) {
    return (
      <span className="text-xs text-slate-500 italic whitespace-nowrap">
        Sent {hoursAgo(lastSentAt)}h ago
      </span>
    );
  }

  return (
    <button
      onClick={async () => {
        const result = await sendReminder(assessmentId, userId);
        if (result.success) {
          notify('Reminder sent', 'success');
          onSent?.(result.sentAt);
        } else {
          notify(result.error, 'error');
        }
      }}
      disabled={sending}
      className="text-xs px-2.5 py-1 rounded-lg bg-amber-600/20 text-amber-300 border border-amber-500/30 hover:bg-amber-600/40 disabled:opacity-50 transition-colors whitespace-nowrap"
    >
      {sending ? '⏳ Sending…' : '🔔 Send Reminder'}
    </button>
  );
}
