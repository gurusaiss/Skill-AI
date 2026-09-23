import { useState, useCallback } from 'react';
import { authFetch } from '../utils/authFetch.js';

const COOLDOWN_MS = 24 * 60 * 60 * 1000;

/**
 * Shared reminder-sending logic — used by both the admin assignment table
 * (AssessmentManagement.jsx) and the manager dashboard's employee list, so
 * the button/API-call/cooldown behavior can't drift between the two
 * surfaces. Server enforces the same 24h cooldown independently; this hook
 * mirrors it client-side purely so the button can show "Sent Xh ago"
 * without waiting for a rejected request.
 */
export function useReminder() {
  const [sendingId, setSendingId] = useState(null); // `${assessmentId}:${userId}` currently in flight

  const sendReminder = useCallback(async (assessmentId, userId) => {
    const key = `${assessmentId}:${userId}`;
    setSendingId(key);
    try {
      const res = await authFetch(`/api/assessments/${assessmentId}/employees/${userId}/remind`, { method: 'POST' });
      return { success: true, sentAt: res?.sent_at || new Date().toISOString() };
    } catch (e) {
      return { success: false, error: e.message || 'Failed to send reminder' };
    } finally {
      setSendingId(null);
    }
  }, []);

  const isSending = useCallback((assessmentId, userId) => sendingId === `${assessmentId}:${userId}`, [sendingId]);

  const cooldownRemaining = useCallback((lastSentAt) => {
    if (!lastSentAt) return 0;
    const remaining = COOLDOWN_MS - (Date.now() - new Date(lastSentAt).getTime());
    return Math.max(0, remaining);
  }, []);

  return { sendReminder, isSending, cooldownRemaining };
}
