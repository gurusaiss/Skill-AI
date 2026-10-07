import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

process.env.GEN_CACHE = '0';
process.env.GEN_TIME_BUDGET_MS = '6000';
process.env.GEN_TASK_MIN_MS = '3000';
process.env.GROQ_API_KEY = 'fake-groq-key-0000000000';
delete process.env.GEMINI_API_KEY;

const { default: GeminiService } = await import('./GeminiService.js');
const { generateQuestionsFromFiles, generateQuestionsFromJD, validateQuestionBank } = await import('./AssessmentGenerator.js');

const ROLES = ['Order Desk Analyst', 'Credit Controller', 'Stock Planner', 'Returns Coordinator', 'Carrier Liaison', 'Billing Clerk'];
const SYS = ['Warehouse Portal', 'Pricing Engine', 'Label Printer Console', 'Customer Ledger', 'Freight Booking Tool', 'Returns Tracker'];
const THINGS = ['customer purchase order', 'credit application', 'replenishment request', 'return authorisation', 'freight quote', 'invoice dispute'];
const FIELDS = ['delivery address', 'tax number', 'pallet count', 'carrier code', 'cost centre', 'batch reference'];
const TEAMS = ['Dispatch Team', 'Audit Group', 'Treasury Desk', 'Compliance Office', 'Customer Care Hub', 'Planning Cell'];
function doc(n) {
  const out = ['Order Processing Procedure', ''];
  for (let i = 1; i <= n; i++) {
    const r = ROLES[i % 6], r2 = ROLES[(i + 2) % 6], s1 = SYS[i % 6], s2 = SYS[(i + 3) % 6], t = THINGS[i % 6], f = FIELDS[i % 6], tm = TEAMS[i % 6];
    out.push(String(i) + '. ' + ['Approval Thresholds', 'Exception Handling', 'Escalation Path', 'Record Keeping', 'Service Levels', 'Hold Rules'][i % 6] + ' for the ' + s1, '');
    out.push('The ' + r + ' must confirm the ' + t + ' against the ' + f + ' before releasing it from the ' + s1 + '. ' +
      'Any ' + t + ' above ' + (i * 700 + 300) + ' USD requires sign-off from the ' + r2 + ' within ' + (i + 1) + ' business days.');
    out.push('If the ' + f + ' is missing on the ' + t + ', the item is held and error code W-' + (200 + i) + ' is raised to the ' + tm + '.');
    out.push('Step 1: Open the ' + s1 + ' and find the ' + t + '.', 'Step 2: Verify the ' + f + ' in the ' + s2 + ' and note it for the ' + tm + '.', 'Step 3: Send the ' + t + ' to the ' + r2 + ' for review.', '');
  }
  return out.join('\n');
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();

describe('generation engine', () => {
  const hang = vi.spyOn(GeminiService, 'generateQuestionsBatchEx');
  afterAll(() => hang.mockRestore());

  it('finishes within the time budget with the exact count when the LLM never answers', async () => {
    hang.mockImplementation(() => new Promise(() => {})); // provider that hangs forever
    const text = doc(12);
    const t0 = Date.now();
    const qs = await generateQuestionsFromFiles([{ name: 'a.pdf', text, questionCount: 20, sourceType: 'supporting' }, { name: 'b.pdf', text: doc(8), questionCount: 10, sourceType: 'supporting' }], { jobRole: 'Order Desk', seed: 't' });
    expect(Date.now() - t0).toBeLessThan(9000);
    expect(qs).toHaveLength(30);
    expect(qs.filter(q => q.isTemplateFallback)).toHaveLength(0); // document-specific completion, not generic templates
    expect(qs.every(q => q.generatedBy === 'extractive')).toBe(true);
    expect(validateQuestionBank(qs, 30).hardFailures).toEqual([]);
    for (const q of qs.filter(q => q.sourceFile === 'a.pdf')) expect(norm(text)).toContain(norm(q.sourceQuote));
  }, 20000);

  it('accepts grounded LLM output (compact schema), drops ungrounded, and fills the rest locally', async () => {
    const text = doc(10);
    hang.mockImplementation(async (prompt) => {
      const quote = 'Orders above 1000 USD require sign-off from the Regional Manager within 2 business days';
      const real = (text.match(/Any [a-z ]+ above \d+ USD requires sign-off from the [A-Za-z ]+ within \d+ business days/g) || [])[0] || quote;
      return { provider: 'groq:120b', ms: 5, questions: [
        { t: 'mcq', d: 'hard', q: 'An order of that size is placed; who must sign off, and by when?', o: ['Regional Manager within 2 days', 'Dispatch Team immediately', 'Order Desk Analyst same day', 'Warehouse Portal automatically'], a: 'A', k: 'Approval', z: real },
        { t: 'mcq', d: 'hard', q: 'Invented question about warehouse robots?', o: ['a', 'b', 'c', 'd'], a: 'B', k: 'x', z: 'robots must be calibrated every Tuesday morning without exception' },
      ] };
    });
    const qs = await generateQuestionsFromFiles([{ name: 'c.pdf', text, questionCount: 12, sourceType: 'supporting' }], { jobRole: 'Order Desk', seed: 't2' });
    expect(qs).toHaveLength(12);
    expect(qs.some(q => q.generatedBy === 'llm')).toBe(true);
    expect(qs.some(q => /robots/.test(q.question))).toBe(false);
  }, 20000);

  it('JD path returns the exact count and reports progress', async () => {
    hang.mockImplementation(async () => null); // every provider fails
    const events = [];
    const qs = await generateQuestionsFromJD({ jobRole: 'Order Desk Analyst', jobDescription: doc(10), jdSkills: ['orders'], questionCount: 15, questionTypes: Array(15).fill('mcq'), onProgress: (e) => events.push(e) });
    expect(qs).toHaveLength(15);
    expect(events.length).toBeGreaterThan(0);
    expect(events.at(-1).done).toBe(15);
  }, 20000);
});
