import { describe, it, expect } from 'vitest';
import { generateExtractiveQuestions, buildDocumentModel } from './ExtractiveQuestionGenerator.js';
import { chunkDensity, segment, simhash, hamming, BM25, contentTokens } from './TextRanking.js';

function makeDoc(n = 14) {
  const out = ['Accounts Payable Procedure', 'Version 2.1 | Confidential | Page 1 of 9', ''];
  const roles = ['Payables Analyst', 'Finance Manager', 'Procurement Officer', 'Treasury Controller'];
  const systems = ['Payment Gateway', 'Vendor Portal', 'ERP Ledger', 'Invoice Capture Tool'];
  for (let i = 1; i <= n; i++) {
    out.push(`${i}. Validation Rules for ${systems[i % 4]}`, '');
    out.push(`The ${roles[i % 4]} must verify the vendor invoice against the purchase order number before releasing payment in the ${systems[(i + 1) % 4]}. ` +
      `Any invoice above ${i * 1000 + 500} USD requires approval from the ${roles[(i + 1) % 4]} within ${i + 2} business days.`);
    out.push(`If the tax field is empty on batch ${i}, the record is rejected and returned with error code E-${100 + i}. ` +
      `A credit memo ${i} is the document that records the agreed amount and reason for adjustment in the ledger.`);
    out.push(`Step 1: Open the ${systems[i % 4]} and locate the invoice ${i}.`, `Step 2: Check the supplier tax number and the bank reference ${i}.`, `Step 3: Submit the approval request to the ${roles[i % 4]} for review.`);
    out.push(`Priority ${i} - respond within ${i * 4} hours`, `Priority ${i + 20} - respond within ${i * 6} hours`, '');
  }
  return out.join('\n');
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

describe('ExtractiveQuestionGenerator', () => {
  const text = makeDoc();
  const qs = generateExtractiveQuestions(text, { count: 30, typeCounts: { mcq: 26, fill_blank: 2, subjective: 2 }, seed: 'seed-1' });

  it('produces questions of the app shape', () => {
    expect(qs.length).toBeGreaterThanOrEqual(20);
    for (const q of qs) {
      expect(['mcq', 'fill_blank', 'subjective']).toContain(q.type);
      expect(['easy', 'medium', 'hard']).toContain(q.difficulty);
      expect(q.answer).toBeTruthy();
      expect(q.generatedBy).toBe('extractive');
    }
  });

  it('every question carries a verbatim quote that is in the source (passes verifyQuoteGrounded)', () => {
    const src = norm(text);
    for (const q of qs) {
      expect(q.sourceQuote.split(/\s+/).length).toBeGreaterThanOrEqual(4);
      expect(src.includes(norm(q.sourceQuote))).toBe(true);
    }
  });

  it('MCQs have 4 unique "A) ..." options and the answer letter points at an option', () => {
    const mcqs = qs.filter(q => q.type === 'mcq');
    expect(mcqs.length).toBeGreaterThan(10);
    const sets = new Set();
    for (const q of mcqs) {
      expect(q.options).toHaveLength(4);
      q.options.forEach((o, i) => expect(o.startsWith('ABCD'[i] + ') ')).toBe(true));
      expect(new Set(q.options.map(o => o.slice(3).toLowerCase())).size).toBe(4);
      expect(['A', 'B', 'C', 'D']).toContain(q.answer);
      sets.add(q.options.map(o => o.slice(3).toLowerCase()).sort().join('|'));
    }
    expect(sets.size).toBe(mcqs.length); // no two MCQs share an option set
  });

  it('cloze answers are present in the quote and not leaked in the stem', () => {
    for (const q of qs.filter(q => q.extractiveKind === 'cloze')) {
      const ans = q.type === 'mcq' ? q.options['ABCD'.indexOf(q.answer)].slice(3) : q.answer;
      expect(norm(q.sourceQuote)).toContain(norm(ans));
      expect(q.question).toContain('______');
    }
  });

  it('spreads answers over letters', () => {
    const letters = new Set(qs.filter(q => q.type === 'mcq').map(q => q.answer));
    expect(letters.size).toBeGreaterThanOrEqual(3);
  });

  it('is deterministic for the same seed and differs for another', () => {
    const again = generateExtractiveQuestions(text, { count: 30, typeCounts: { mcq: 26, fill_blank: 2, subjective: 2 }, seed: 'seed-1' });
    expect(JSON.stringify(again)).toBe(JSON.stringify(qs));
    const other = generateExtractiveQuestions(text, { count: 30, typeCounts: { mcq: 26, fill_blank: 2, subjective: 2 }, seed: 'seed-2' });
    expect(JSON.stringify(other)).not.toBe(JSON.stringify(qs));
  });

  it('never asks about metadata lines and honours exclude()', () => {
    for (const q of qs) expect(/page \d|confidential|version \d/i.test(q.question)).toBe(false);
    const none = generateExtractiveQuestions(text, { count: 10, exclude: () => true });
    expect(none).toHaveLength(0);
  });

  it('returns nothing for text with no usable sentences', () => {
    expect(generateExtractiveQuestions('Hi.', { count: 5 })).toEqual([]);
    expect(buildDocumentModel('').usable).toHaveLength(0);
  });
});

describe('TextRanking', () => {
  it('ranks an information-dense chunk above boilerplate', () => {
    const rich = 'The approver must release payments above 5,000 USD within 48 hours. If error code E-104 appears, escalate to Tier 2 through the Payment Gateway.';
    const fluff = 'This document is confidential. Copyright 2024. Page 3 of 12. All rights reserved. Table of contents.';
    expect(chunkDensity(rich).info).toBeGreaterThan(chunkDensity(fluff).info);
    expect(chunkDensity(fluff).info).toBe(0);
  });
  it('segments sentences with offsets, steps and headings', () => {
    const t = '1. Scope of Work\n\nDr. Smith said so. The limit is 3.5 hours.\nStep 1: Do it now please\n';
    const { sentences, headings } = segment(t);
    expect(headings[0].text).toMatch(/Scope of Work/);
    for (const s of sentences) expect(norm(t)).toContain(norm(s.text));
    expect(sentences.some(s => s.kind === 'step')).toBe(true);
  });
  it('simhash groups near-duplicates and BM25 ranks relevant docs first', () => {
    const a = simhash(contentTokens('the payment gateway rejects invoices with an empty tax field today'));
    const b = simhash(contentTokens('the payment gateway rejects invoices with an empty tax field'));
    const c = simhash(contentTokens('warehouse pallets are labelled at the dock door before putaway'));
    expect(hamming(a, b)).toBeLessThan(hamming(a, c));
    const bm = new BM25([contentTokens('warehouse pallet dock'), contentTokens('invoice tax payment gateway'), contentTokens('lunch menu')]);
    expect(bm.rank(contentTokens('tax invoice'), 3)[0].i).toBe(1);
  });
});
