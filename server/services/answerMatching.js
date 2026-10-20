/**
 * answerMatching.js - case-insensitive answer parsing for multiple choice
 * (single OR multiple correct options) and alternate accepted text answers.
 *
 * MCQ answers can arrive as:  "B", "b", "B) text", "b) text", "A,C", "a and c",
 * "A) one || C) two" (what the multi-select UI sends), or an array of those.
 * Everything is compared as a SET of option letters, so letter case and the
 * order the employee ticked boxes in never matter.
 */

const LETTER_LIST = /^\s*[A-Da-d](\s*(,|;|&|\/|\band\b)\s*[A-Da-d])*\s*$/i;

/** First option letter of one token ("B) x", "b.", "B"), or ''. Case-insensitive. */
export function optionLetter(token) {
  const m = String(token ?? '').match(/^\s*([A-Da-d])\s*(?:[).:\-]|$)/);
  return m ? m[1].toUpperCase() : '';
}

const bodyOf = (s) => String(s ?? '').replace(/^\s*[A-Da-d]\s*[).:\-]\s*/, '').trim().toLowerCase();

function lettersFromTokens(tokens, options) {
  const out = new Set();
  for (const t of tokens) {
    let l = optionLetter(t);
    if (!l && Array.isArray(options)) {
      // Plain option text (no "A)" label): match it back to its option.
      const want = bodyOf(t);
      const idx = want ? options.findIndex(o => bodyOf(o) === want) : -1;
      if (idx >= 0 && idx < 26) l = String.fromCharCode(65 + idx);
    }
    if (l) out.add(l);
  }
  return out;
}

/** Set of option letters named by a stored or submitted answer. */
export function answerLetters(answer, options) {
  if (Array.isArray(answer)) return lettersFromTokens(answer.map(String), options);
  const s = String(answer ?? '').trim();
  if (!s) return new Set();
  if (LETTER_LIST.test(s)) {
    return new Set(s.toUpperCase().match(/[A-D]/g) || []);
  }
  const parts = s.includes('||') ? s.split('||') : [s];
  return lettersFromTokens(parts, options);
}

/** True when the question's stored answer names more than one correct option. */
export function isMultiAnswer(question) {
  if (!question) return false;
  if (question.multiple === true || question.multiSelect === true) return true;
  return answerLetters(question.answer, question.options).size > 1;
}

/** All-or-nothing: the chosen set must equal the correct set. */
export function isMcqCorrect(userAnswer, question) {
  const correct = answerLetters(question?.answer, question?.options);
  if (correct.size === 0) return false;
  const chosen = answerLetters(userAnswer, question?.options);
  if (chosen.size !== correct.size) return false;
  for (const l of correct) if (!chosen.has(l)) return false;
  return true;
}

/** Accepted alternatives for a text answer: array, or "a || b" / "a | b" separated. */
export function acceptedTextAnswers(answer) {
  if (Array.isArray(answer)) return answer.map(a => String(a ?? '').trim()).filter(Boolean);
  const s = String(answer ?? '');
  if (s.includes('||')) return s.split('||').map(a => a.trim()).filter(Boolean);
  return [s];
}
