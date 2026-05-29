/**
 * AgentMemory — Short-term (session) + Long-term (cross-session) memory
 *
 * Implements the memory layer that makes agents "learn" about each user over time.
 * Uses a simple JSON store (same pattern as rest of app) organized by userId.
 *
 * Memory types:
 * - episodic: specific events ("User scored 92% on React hooks quiz on Day 5")
 * - semantic: learned facts ("User learns faster in the evening", "Struggles with async/await")
 * - procedural: learned patterns ("User responds well to visual examples")
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MEMORY_DIR = join(__dirname, '../data/memory');

class AgentMemory {
  constructor() {
    if (!existsSync(MEMORY_DIR)) mkdirSync(MEMORY_DIR, { recursive: true });
  }

  _memoryPath(userId) { return join(MEMORY_DIR, `${userId}.json`); }

  _loadMemory(userId) {
    const path = this._memoryPath(userId);
    if (!existsSync(path)) return { episodic: [], semantic: {}, procedural: {}, lastUpdated: null };
    try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return { episodic: [], semantic: {}, procedural: {} }; }
  }

  _saveMemory(userId, memory) {
    memory.lastUpdated = new Date().toISOString();
    writeFileSync(this._memoryPath(userId), JSON.stringify(memory, null, 2));
  }

  // Record an episodic memory (specific event)
  remember(userId, event) {
    // event: { type, content, context, importance: 1-10 }
    const memory = this._loadMemory(userId);
    memory.episodic.push({ ...event, timestamp: new Date().toISOString(), id: Date.now() });
    // Keep last 100 episodic memories
    if (memory.episodic.length > 100) memory.episodic = memory.episodic.slice(-100);
    this._saveMemory(userId, memory);
  }

  // Learn a semantic fact about the user
  learn(userId, key, value) {
    const memory = this._loadMemory(userId);
    memory.semantic[key] = { value, learnedAt: new Date().toISOString(), confidence: 0.8 };
    this._saveMemory(userId, memory);
  }

  // Update procedural knowledge (patterns)
  updatePattern(userId, pattern, evidence) {
    const memory = this._loadMemory(userId);
    if (!memory.procedural[pattern]) {
      memory.procedural[pattern] = { count: 0, evidence: [], lastSeen: null };
    }
    memory.procedural[pattern].count++;
    memory.procedural[pattern].evidence.push(evidence);
    memory.procedural[pattern].lastSeen = new Date().toISOString();
    if (memory.procedural[pattern].evidence.length > 10) {
      memory.procedural[pattern].evidence = memory.procedural[pattern].evidence.slice(-10);
    }
    this._saveMemory(userId, memory);
  }

  // Retrieve relevant memories for a given context
  recall(userId, context = '', limit = 10) {
    const memory = this._loadMemory(userId);
    // Simple relevance: match context keywords against episodic memory
    const keywords = context.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    const scored = memory.episodic.map(m => {
      const text = (m.content + ' ' + m.type).toLowerCase();
      const relevance = keywords.filter(k => text.includes(k)).length;
      return { ...m, relevance };
    });
    scored.sort((a, b) => b.relevance - a.relevance || new Date(b.timestamp) - new Date(a.timestamp));
    return {
      episodic: scored.slice(0, limit),
      semantic: memory.semantic,
      procedural: memory.procedural,
      summary: this._buildSummary(memory),
    };
  }

  // Build a text summary of memory for agent context injection
  _buildSummary(memory) {
    const facts = Object.entries(memory.semantic)
      .map(([k, v]) => `${k}: ${v.value}`)
      .slice(0, 5)
      .join('; ');
    const patterns = Object.entries(memory.procedural)
      .filter(([, v]) => v.count >= 2)
      .map(([k, v]) => `${k} (seen ${v.count}x)`)
      .join(', ');
    const recentEpisodes = memory.episodic.slice(-3).map(e => e.content).join('. ');
    return `Learner profile: ${facts}. Patterns: ${patterns || 'none yet'}. Recent: ${recentEpisodes}`;
  }

  // Analyze sessions and auto-learn patterns
  analyzeAndLearn(userId, sessions = [], skills = []) {
    if (sessions.length === 0) return;

    const scores = sessions.map(s => s.score || 0);
    const avgScore = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
    const trend = scores.length >= 3 ? scores.slice(-1)[0] - scores[0] : 0;

    // Learn facts
    this.learn(userId, 'avg_score', avgScore);
    this.learn(userId, 'total_sessions', sessions.length);
    this.learn(userId, 'performance_trend', trend > 5 ? 'improving' : trend < -5 ? 'declining' : 'stable');

    // Detect patterns
    if (avgScore >= 85) this.updatePattern(userId, 'high_performer', `scored ${avgScore}% avg`);
    if (trend > 10) this.updatePattern(userId, 'fast_learner', `score improved ${trend} pts`);
    if (sessions.length >= 7) this.updatePattern(userId, 'consistent_learner', `${sessions.length} sessions completed`);

    // Record episode
    this.remember(userId, {
      type: 'session_analysis',
      content: `Analyzed ${sessions.length} sessions. Avg: ${avgScore}%. Trend: ${trend > 0 ? '+' : ''}${trend}pts.`,
      context: 'performance_review',
      importance: 7,
    });

    return this.recall(userId, 'performance', 5);
  }

  // Get full memory for a user (for the memory viewer UI)
  getFullMemory(userId) {
    return this._loadMemory(userId);
  }

  // Clear memory (for testing)
  clear(userId) {
    const path = this._memoryPath(userId);
    if (existsSync(path)) {
      writeFileSync(path, JSON.stringify({ episodic: [], semantic: {}, procedural: {}, lastUpdated: null }, null, 2));
    }
  }
}

export default new AgentMemory();
