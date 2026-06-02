/**
 * AutonomousScheduler — Background AI Agent
 *
 * Runs proactive monitoring without user prompting.
 * This is the "agentic automation" — AI that acts autonomously.
 */
import GeminiService from '../services/GeminiService.js';
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '../data');
const BRIEFS_DIR = join(__dirname, '../data/briefs');

class AutonomousScheduler {
  constructor() {
    this.gemini = GeminiService; // singleton instance, not a class
    this.isRunning = false;
    this.lastRun = null;
    this.intervalMs = 6 * 60 * 60 * 1000; // every 6 hours
  }

  // Start the background loop
  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    this._runCycle();
    setInterval(() => this._runCycle(), this.intervalMs);
    console.log('[AutonomousScheduler] Background agent started — running every 6 hours');
  }

  async _runCycle() {
    this.lastRun = new Date().toISOString();
    console.log('[AutonomousScheduler] Running autonomous cycle...');
    try {
      await this._generateDailyBriefs();
      await this._checkProgressAnomalies();
    } catch (e) {
      console.error('[AutonomousScheduler] Cycle error:', e.message);
    }
  }

  // Generate daily brief for all active users
  async _generateDailyBriefs() {
    if (!existsSync(DATA_DIR)) return;
    const { mkdirSync } = await import('fs');
    if (!existsSync(BRIEFS_DIR)) mkdirSync(BRIEFS_DIR, { recursive: true });

    const files = readdirSync(DATA_DIR).filter(f => f.endsWith('.json') && !f.includes('_'));
    for (const file of files.slice(0, 10)) { // limit to 10 users per cycle
      try {
        const userId = file.replace('.json', '');
        const data = JSON.parse(readFileSync(join(DATA_DIR, file), 'utf8'));
        if (!data.learningPlan || !data.sessions) continue;

        const brief = await this._buildBrief(userId, data);
        writeFileSync(join(BRIEFS_DIR, `${userId}.json`), JSON.stringify(brief, null, 2));
      } catch (e) { /* skip failed users */ }
    }
  }

  // Build a personalized daily brief
  async _buildBrief(userId, data) {
    const sessions = data.sessions || [];
    const plan = data.learningPlan || [];
    const skills = data.skillTree?.skills || [];

    const completedDays = sessions.length;
    const avgScore = sessions.length > 0
      ? Math.round(sessions.reduce((s, x) => s + (x.score || 0), 0) / sessions.length)
      : 0;
    const lastScore = sessions.slice(-1)[0]?.score || 0;
    const nextDay = plan.find(d => !d.completed && d.day > completedDays);
    const streak = this._calculateStreak(sessions);

    // Try AI-generated insight, fall back to template
    let insight = '';
    try {
      if (this.gemini.isEnabled()) {
        const prompt = `Generate a 2-sentence motivational learning insight for a student who: completed ${completedDays} sessions, has avg score ${avgScore}%, last score ${lastScore}%, streak ${streak} days. Be encouraging and specific. No generic platitudes.`;
        insight = await this.gemini.generateText?.(prompt) || '';
      }
    } catch {}

    if (!insight) {
      // Template fallback
      if (streak >= 7) insight = `${streak}-day streak! You're in the top 5% of consistent learners. Keep this momentum.`;
      else if (avgScore >= 85) insight = `Excellent mastery (${avgScore}% avg). You're absorbing concepts at expert pace.`;
      else if (lastScore > avgScore) insight = `Your last session was your best! Score improved to ${lastScore}%. You're accelerating.`;
      else insight = `Every session builds your foundation. ${completedDays} sessions completed — you're making real progress.`;
    }

    const alerts = [];
    if (streak === 0 && completedDays > 0) alerts.push({ type: 'warning', msg: 'Streak broken! Get back on track today.' });
    if (lastScore < 60 && sessions.length > 0) alerts.push({ type: 'review', msg: `Last score was ${lastScore}%. Agent recommends reviewing before continuing.` });
    if (avgScore > 85 && completedDays >= 5) alerts.push({ type: 'achievement', msg: 'You qualify for the next difficulty level!' });

    return {
      userId,
      generatedAt: new Date().toISOString(),
      type: 'daily_brief',
      streak,
      completedDays,
      avgScore,
      lastScore,
      nextDay: nextDay ? { day: nextDay.day, topic: nextDay.topic, skillName: nextDay.skillName } : null,
      insight,
      alerts,
      recommendation: this._getRecommendation(avgScore, streak, completedDays),
    };
  }

  // Check for anomalies across all users
  async _checkProgressAnomalies() {
    // In a real system this would send notifications
    // For demo: just log detected anomalies
  }

  _calculateStreak(sessions) {
    if (sessions.length === 0) return 0;
    let streak = 1;
    for (let i = sessions.length - 1; i > 0; i--) {
      const curr = new Date(sessions[i].completedAt || sessions[i].createdAt);
      const prev = new Date(sessions[i - 1].completedAt || sessions[i - 1].createdAt);
      const diffDays = Math.round((curr - prev) / (1000 * 60 * 60 * 24));
      if (diffDays <= 1) streak++;
      else break;
    }
    return streak;
  }

  _getRecommendation(avgScore, streak, days) {
    if (avgScore >= 85 && streak >= 3) return { action: 'accelerate', msg: 'You\'re performing excellently. Consider taking on harder challenges.' };
    if (avgScore < 60) return { action: 'review', msg: 'Schedule a review session before proceeding to new material.' };
    if (streak === 0) return { action: 'resume', msg: 'Resume your streak today — consistency is key to mastery.' };
    return { action: 'continue', msg: 'You\'re on track. Complete today\'s session to maintain momentum.' };
  }

  // Get brief for a specific user (for API)
  getBrief(userId) {
    const path = join(BRIEFS_DIR, `${userId}.json`);
    if (existsSync(path)) {
      try { return JSON.parse(readFileSync(path, 'utf8')); } catch {}
    }
    return null;
  }

  getStatus() {
    return { isRunning: this.isRunning, lastRun: this.lastRun, intervalHours: 6 };
  }
}

export default new AutonomousScheduler();
