import { describe, it, expect } from 'vitest';
import {
  sanitizeDocumentReferences,
  validateFillBlankQuality,
  buildStyleProfileFromQuestions,
} from './QuestionStyleLearning.js';

describe('QuestionStyleLearning - Reference Sanitization & Quality Gates', () => {
  it('strips "According to the document" and page numbers from questions', () => {
    const rawQ = {
      type: 'mcq',
      question: 'According to page 1 of the document, what is the procedure for validating a transaction?',
      options: ['A) Step 1', 'B) Step 2', 'C) Step 3', 'D) Step 4'],
      explanation: 'According to page 1: Step 1 is mandatory.',
    };

    const sanitized = sanitizeDocumentReferences(rawQ);
    expect(sanitized.question).not.toMatch(/according to/i);
    expect(sanitized.question).not.toMatch(/page 1/i);
    expect(sanitized.question).toBe('What is the procedure for validating a transaction?');
    expect(sanitized.explanation).toBe('Standard procedure: Step 1 is mandatory.');
  });

  it('rejects trivial grammar fill-in-the-blank questions', () => {
    const grammarQ1 = {
      type: 'fill_blank',
      question: 'Delhi ____ capital of India.',
      answer: 'is',
    };
    expect(validateFillBlankQuality(grammarQ1).valid).toBe(false);

    const grammarQ2 = {
      type: 'fill_blank',
      question: 'Associates must review ____ transaction log.',
      answer: 'the',
    };
    expect(validateFillBlankQuality(grammarQ2).valid).toBe(false);

    const meaningfulQ = {
      type: 'fill_blank',
      question: 'Before closing a transaction, the associate must verify the customer\'s ______ against the approved record.',
      answer: 'identity',
    };
    expect(validateFillBlankQuality(meaningfulQ).valid).toBe(true);
  });

  it('learns question-writing style from manual questions without altering source grounding', () => {
    const manualQuestions = [
      {
        id: 'mq1',
        isManual: true,
        type: 'mcq',
        question: 'When a customer requests an immediate wire transfer exceeding the threshold, which manager approval is required?',
        difficulty: 'medium',
        options: ['A) Branch Manager', 'B) Regional Risk Officer', 'C) Compliance Lead', 'D) Teller Lead'],
        answer: 'B',
      },
      {
        id: 'mq2',
        isManual: true,
        type: 'mcq',
        question: 'Given an anomalous debit pattern on a newly verified account, what is the first containment action to execute?',
        difficulty: 'hard',
        options: ['A) Freeze account', 'B) Call customer', 'C) Escalate to AML', 'D) Log ticket'],
        answer: 'A',
      },
    ];

    const profile = buildStyleProfileFromQuestions('Financial Operations Associate', manualQuestions, 'role_fin_ops');
    expect(profile.hasCustomStyle).toBe(true);
    expect(profile.sampleCount).toBe(2);
    expect(profile.typePatterns.mcq.scenarioRatio).toBe(100);

    const promptInstructions = profile.toPromptInstructions();
    expect(promptInstructions).toContain('ORGANIZATIONAL STYLE GUIDELINES');
    expect(promptInstructions).toContain('CRITICAL: Use this style guidance for framing and structure ONLY');
  });
});
