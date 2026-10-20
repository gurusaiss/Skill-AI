import { describe, it, expect } from 'vitest';
import { answerLetters, isMcqCorrect, isMultiAnswer, acceptedTextAnswers, optionLetter } from './answerMatching.js';
import { normalizeQuestionShape } from './QuestionMix.js';

const options = ['A) Alpha', 'B) Beta', 'C) Gamma', 'D) Delta'];

describe('case-insensitive MCQ matching', () => {
  it('accepts lowercase letters and labelled option text against an uppercase answer', () => {
    const q = { answer: 'B', options };
    expect(isMcqCorrect('b', q)).toBe(true);
    expect(isMcqCorrect('B', q)).toBe(true);
    expect(isMcqCorrect('b) beta', q)).toBe(true);
    expect(isMcqCorrect('B) Beta', q)).toBe(true);
    expect(isMcqCorrect('c', q)).toBe(false);
    expect(isMcqCorrect('', q)).toBe(false);
  });

  it('does not read the article "a" at the start of option text as letter A', () => {
    expect(optionLetter('a user can log in')).toBe('');
    expect(optionLetter('a) a user can log in')).toBe('A');
  });

  it('matches plain option text (no label) in any letter case', () => {
    const q = { answer: 'C', options: ['One', 'Two', 'Three', 'Four'] };
    expect(isMcqCorrect('three', q)).toBe(true);
    expect(isMcqCorrect('THREE', q)).toBe(true);
  });
});

describe('multiple correct answers', () => {
  const q = { answer: 'A,C', options };

  it('detects multi-answer questions from several stored formats', () => {
    expect(isMultiAnswer(q)).toBe(true);
    expect(isMultiAnswer({ answer: 'a and c', options })).toBe(true);
    expect(isMultiAnswer({ answer: ['A', 'C'], options })).toBe(true);
    expect(isMultiAnswer({ answer: 'B', options })).toBe(false);
    expect(isMultiAnswer({ answer: 'B', multiple: true, options })).toBe(true);
  });

  it('is all-or-nothing, order- and case-insensitive', () => {
    expect(isMcqCorrect('A) Alpha || C) Gamma', q)).toBe(true);
    expect(isMcqCorrect('C) Gamma || A) Alpha', q)).toBe(true);
    expect(isMcqCorrect('a, c', q)).toBe(true);
    expect(isMcqCorrect('A) Alpha', q)).toBe(false);
    expect(isMcqCorrect('A) Alpha || B) Beta', q)).toBe(false);
    expect(isMcqCorrect('A) Alpha || C) Gamma || D) Delta', q)).toBe(false);
  });

  it('parses letter sets', () => {
    expect([...answerLetters('a;c')].sort()).toEqual(['A', 'C']);
    expect([...answerLetters(['b', 'D'])].sort()).toEqual(['B', 'D']);
  });

  it('normalizeQuestionShape keeps every correct option instead of collapsing to one', () => {
    const out = normalizeQuestionShape({ question: 'Pick all vowels', type: 'mcq', options: ['a', 'b', 'e', 'x'], answer: 'A,C' });
    expect(out.answer).toBe('A,C');
    expect(out.multiple).toBe(true);
    const single = normalizeQuestionShape({ question: 'Pick one', type: 'mcq', options: ['a', 'b'], answer: 'b' });
    expect(single.answer).toBe('B');
    expect(single.multiple).toBeUndefined();
  });
});

describe('alternate text answers', () => {
  it('splits || and arrays', () => {
    expect(acceptedTextAnswers('color || colour')).toEqual(['color', 'colour']);
    expect(acceptedTextAnswers(['SQL', 'sequel'])).toEqual(['SQL', 'sequel']);
    expect(acceptedTextAnswers('plain')).toEqual(['plain']);
  });
});
