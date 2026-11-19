/**
 * QuestionStyleLearning.js — Reusable question-style learning system.
 *
 * Mandate:
 * Learns question-writing style (structure, complexity, tone, MCQ construction,
 * scenario depth) from approved manual questions added in the Job Library,
 * while STRICTLY separating style learning from content grounding.
 *
 * Manual questions provide style guidance ONLY. Every generated question,
 * answer, and explanation must remain 100% grounded in the target role's
 * current JD and selected supporting documents.
 */

export class ManualQuestionExample {
  constructor({ id, roleId, jobRole, type, question, difficulty, options = [], answer = '', skillArea = '' }) {
    this.id = id;
    this.roleId = roleId;
    this.jobRole = jobRole;
    this.type = type || 'mcq';
    this.question = question;
    this.difficulty = difficulty || 'medium';
    this.options = options;
    this.answer = answer;
    this.skillArea = skillArea;
    this.wordCount = (question || '').trim().split(/\s+/).filter(Boolean).length;
    this.isScenario = /^(when|given|suppose|in the event|during|if a|a colleague|an employee|a client|before|after)\b/i.test(question.trim());
  }
}

export class QuestionTypePattern {
  constructor(type, examples = []) {
    this.type = type;
    this.count = examples.length;
    this.avgWords = examples.length
      ? Math.round(examples.reduce((sum, e) => sum + e.wordCount, 0) / examples.length)
      : 18;
    this.scenarioCount = examples.filter(e => e.isScenario).length;
    this.scenarioRatio = examples.length ? Math.round((this.scenarioCount / examples.length) * 100) : 40;
    this.patterns = this._extractPatterns(examples);
  }

  _extractPatterns(examples) {
    const list = [];
    for (const ex of examples) {
      const q = (ex.question || '').trim();
      const firstWords = q.split(/\s+/).slice(0, 4).join(' ');
      if (firstWords && !list.includes(firstWords)) list.push(firstWords);
    }
    return list.slice(0, 5);
  }
}

export class DifficultyProfile {
  constructor(examples = []) {
    this.easy = examples.filter(e => e.difficulty === 'easy').length;
    this.medium = examples.filter(e => e.difficulty === 'medium').length;
    this.hard = examples.filter(e => e.difficulty === 'hard').length;
    this.total = examples.length;
  }
}

export class JobRoleStyleProfile {
  constructor({ roleId, jobRole, examples = [] }) {
    this.roleId = roleId;
    this.jobRole = jobRole;
    this.sampleCount = examples.length;
    this.hasCustomStyle = examples.length > 0;
    this.difficultyProfile = new DifficultyProfile(examples);

    const byType = {
      mcq: examples.filter(e => e.type === 'mcq' || e.type === 'multiple_choice'),
      fill_blank: examples.filter(e => e.type === 'fill_blank' || e.type === 'fill_in_blank'),
      subjective: examples.filter(e => e.type === 'subjective' || e.type === 'open_ended'),
    };

    this.typePatterns = {
      mcq: new QuestionTypePattern('mcq', byType.mcq),
      fill_blank: new QuestionTypePattern('fill_blank', byType.fill_blank),
      subjective: new QuestionTypePattern('subjective', byType.subjective),
    };

    this.preferredTone = this._inferTone(examples);
  }

  _inferTone(examples) {
    if (!examples.length) return 'professional, clear, practical workplace application';
    const hasScenario = examples.some(e => e.isScenario);
    const avgLen = examples.reduce((s, e) => s + e.wordCount, 0) / examples.length;
    if (hasScenario && avgLen > 22) return 'scenario-based, situational decision making with concrete job context';
    if (avgLen < 14) return 'concise, direct technical recall and operational precision';
    return 'applied professional practice with clear, unambiguous choices';
  }

  toPromptInstructions() {
    if (!this.hasCustomStyle) return '';
    const lines = [
      `ORGANIZATIONAL STYLE GUIDELINES (learned from approved manual examples for ${this.jobRole}):`,
      `- Tone & Depth: ${this.preferredTone}.`,
      `- MCQ Structure: Target ~${this.typePatterns.mcq.avgWords} words per question stem; options should be concise, parallel, and distinct.`,
      `- Question Framing: ${this.typePatterns.mcq.scenarioRatio}% scenario/application-based framing.`,
    ];
    if (this.typePatterns.fill_blank.count > 0) {
      lines.push(`- Fill-in-the-blank Style: Target unambiguous domain terminology or parameters; avoid trivial grammar completion.`);
    }
    lines.push(`CRITICAL: Use this style guidance for framing and structure ONLY. Ground all facts, options, and answers strictly in the provided excerpt.`);
    return lines.join('\n');
  }
}

/**
 * Builds or retrieves a style profile from approved manual questions.
 */
export function buildStyleProfileFromQuestions(jobRole, questions = [], roleId = null) {
  const manualOnly = (questions || [])
    .filter(q => q && (q.isManual === true || q.isManual === 'true'))
    .map(q => new ManualQuestionExample({
      id: q.id,
      roleId,
      jobRole,
      type: q.type,
      question: q.question,
      difficulty: q.difficulty,
      options: q.options,
      answer: q.answer,
      skillArea: q.skillArea,
    }));

  return new JobRoleStyleProfile({
    roleId,
    jobRole: jobRole || 'Professional',
    examples: manualOnly,
  });
}

/**
 * Sanitizes any leaked document/file/page references from questions, options,
 * answers, and explanations to ensure they are self-contained and natural.
 */
export function sanitizeDocumentReferences(q) {
  if (!q || typeof q !== 'object') return q;
  const out = { ...q };

  const PATTERNS_TO_STRIP = [
    /^(?:according to|as per|based on|as mentioned in|as stated in)\s+(?:the\s+)?(?:uploaded\s+)?(?:document|file|sop|text|material|manual|guide|handbook|pdf|docx?)(?:[,\s:]+|\s+on\s+page\s+\d+[,\s:]*)/i,
    /^(?:according to|as per|based on)\s+page\s+(?:number\s+)?\d+(?:\s+of\s+the\s+document)?[,\s:]*/i,
    /^(?:refer to|referencing)\s+(?:the\s+)?(?:following\s+)?(?:page|section|document|file)[,\s:]*/i,
    /^(?:based on\s+)?(?:the\s+)?page\s+section\s+[a-z0-9.]+[,\s:]*/i,
    /\b(?:from|in)\s+the\s+uploaded\s+(?:document|file)\b/gi,
    /\b(?:according to|as per)\s+the\s+(?:document|file)\b/gi,
    /\btaken from the document\b/gi,
    /\busing the document\b/gi,
    /\bfrom the document\b/gi,
  ];

  const cleanText = (str) => {
    if (!str || typeof str !== 'string') return str;
    let s = str.trim();
    for (const pat of PATTERNS_TO_STRIP) {
      s = s.replace(pat, '').trim();
    }
    // Capitalize first letter if needed
    if (s.length > 0) {
      s = s.charAt(0).toUpperCase() + s.slice(1);
    }
    return s;
  };

  if (out.question) {
    out.question = cleanText(out.question);
    // If stripping left a headless question like "what steps...", make sure it starts properly
    if (/^[a-z]/.test(out.question)) {
      out.question = out.question.charAt(0).toUpperCase() + out.question.slice(1);
    }
  }

  if (Array.isArray(out.options)) {
    out.options = out.options.map(opt => {
      if (typeof opt !== 'string') return opt;
      const letterMatch = /^([A-D]\)\s*)(.*)$/.exec(opt);
      if (letterMatch) {
        return letterMatch[1] + cleanText(letterMatch[2]);
      }
      return cleanText(opt);
    });
  }

  if (out.explanation) {
    // Avoid "Stated in the document (Section X): ..."
    out.explanation = out.explanation
      .replace(/Stated in the document(?:\s*\([^)]*\))?:\s*/gi, 'Standard procedure: ')
      .replace(/According to page \d+:\s*/gi, 'Standard procedure: ')
      .replace(/As per the document:\s*/gi, 'Verified procedure: ');
  }

  return out;
}

/**
 * Validates fill-in-the-blank question quality.
 * Rejects grammar-only blanks (e.g. "is", "the", "a") and ensures answer is domain-specific.
 */
export function validateFillBlankQuality(q) {
  if (!q || (q.type !== 'fill_blank' && q.type !== 'fill_in_blank')) return { valid: true };
  const ans = String(q.answer || '').trim();
  if (!ans) return { valid: false, reason: 'Empty answer for fill-in-the-blank question' };

  const TRIVIAL_FILL_BLANK_WORDS = new Set([
    'is', 'was', 'are', 'were', 'be', 'been', 'being',
    'a', 'an', 'the', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'onto',
    'to', 'with', 'within', 'without', 'and', 'or', 'but', 'nor', 'so', 'yet',
    'that', 'this', 'these', 'those', 'it', 'its', 'they', 'them', 'their',
    'can', 'could', 'shall', 'should', 'will', 'would', 'may', 'might', 'must',
    'do', 'does', 'did', 'have', 'has', 'had', 'then', 'than', 'also', 'just'
  ]);

  const lower = ans.toLowerCase();
  if (TRIVIAL_FILL_BLANK_WORDS.has(lower)) {
    return { valid: false, reason: `Answer "${ans}" is a trivial grammar/stop word` };
  }

  const words = lower.split(/\s+/).filter(Boolean);
  if (words.every(w => TRIVIAL_FILL_BLANK_WORDS.has(w))) {
    return { valid: false, reason: `Answer "${ans}" contains only trivial words` };
  }

  if (words.length > 6) {
    return { valid: false, reason: `Answer is too lengthy (${words.length} words) for an unambiguous blank` };
  }

  return { valid: true };
}

export default {
  ManualQuestionExample,
  QuestionTypePattern,
  DifficultyProfile,
  JobRoleStyleProfile,
  buildStyleProfileFromQuestions,
  sanitizeDocumentReferences,
  validateFillBlankQuality,
};
