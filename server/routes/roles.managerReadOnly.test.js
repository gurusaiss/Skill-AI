import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';

// Authenticate is replaced by a header-driven stub; requireRole/requirePermission stay real.
vi.mock('../middleware/auth.js', async (orig) => {
  const actual = await orig();
  return {
    ...actual,
    authenticate: (req, res, next) => {
      const role = req.headers['x-test-role'];
      if (!role) return res.status(401).json({ success: false, data: null, error: 'no auth' });
      req.user = { userId: 'u1', id: 'u1', role, primaryRole: role, accesses: [], companyId: 'c1', permissions: [] };
      next();
    },
    requirePermission: () => (req, res, next) => next(),
  };
});

const store = () => new Proxy({}, { get: (_t, name) => (name === 'then' ? undefined : vi.fn(async () => (name === 'getAll' || name === 'getByCompany' ? [] : null))) });
vi.mock('../services/DataStore.js', () => ({
  RoleLibrary: store(), EmployeeChecklists: store(), Assessments: store(), GeneratedContent: store(),
  QuestionBankVersions: store(), QuestionBankArchives: store(), EmployeeAssessmentAssignments: store(),
}));
vi.mock('../services/UserStore.js', () => ({ default: new Proxy({}, { get: () => vi.fn(async () => null) }) }));
vi.mock('../services/GenerationJobs.js', () => ({ default: new Proxy({}, { get: () => vi.fn(() => null) }) }));
vi.mock('../services/GeminiService.js', () => ({ default: {} }));
vi.mock('../services/AssessmentGenerator.js', () => ({
  generateQuestionsFromJD: vi.fn(), validateQuestionBank: vi.fn(), generateQuestionsFromFiles: vi.fn(),
  assessSourceQuality: vi.fn(), MIN_SOURCE_CHARS: 0,
}));

let server, base, router;
beforeAll(async () => {
  router = (await import('./roles.js')).default;
  const app = express();
  app.use(express.json());
  app.use('/api/roles', router);
  await new Promise(r => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}/api/roles`;
});
afterAll(() => new Promise(r => server.close(r)));

const call = (method, path, role) =>
  fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(role ? { 'x-test-role': role } : {}) }, body: method === 'GET' ? undefined : '{}' });

const MUTATIONS = [
  ['POST', '/'], ['PUT', '/r1'], ['DELETE', '/r1'], ['POST', '/import'], ['POST', '/parse-jd'],
  ['POST', '/r1/generate-overview'], ['PUT', '/r1/document-text'], ['DELETE', '/r1/documents/f1'],
  ['PUT', '/r1/questions'], ['POST', '/r1/questions'], ['DELETE', '/r1/questions/q1'],
  ['POST', '/r1/questions/q1/lock'], ['POST', '/r1/questions/q1/unlock'],
  ['POST', '/r1/regenerate-questions'], ['POST', '/r1/new-generation'], ['POST', '/r1/generate-assessment'],
  ['POST', '/bulk-generate-assessments'], ['POST', '/r1/versions/v1/approve'],
  ['POST', '/r1/lock'], ['POST', '/r1/approve-assessment'],
];

describe('Role Library is view-only for managers', () => {
  it.each(MUTATIONS)('manager gets 403 on %s %s', async (method, path) => {
    const res = await call(method, path, 'manager');
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body).toMatchObject({ success: false, data: null });
    expect(typeof body.error).toBe('string');
  });

  it('manager can still read (list, detail, versions, generation-status)', async () => {
    for (const path of ['/', '/r1', '/r1/versions', '/r1/generation-status']) {
      const res = await call('GET', path, 'manager');
      expect(res.status, path).not.toBe(403);
      expect(res.status, path).not.toBe(401);
    }
  });

  it('admin is not blocked by the manager gate on mutating routes', async () => {
    for (const [method, path] of [['PUT', '/r1/questions'], ['POST', '/r1/lock'], ['POST', '/r1/generate-overview'], ['DELETE', '/r1/documents/f1']]) {
      const res = await call(method, path, 'admin');
      expect(res.status, `${method} ${path}`).not.toBe(403);
      expect(res.status, `${method} ${path}`).not.toBe(401);
    }
  });

  it('unauthenticated requests are rejected', async () => {
    expect((await call('PUT', '/r1/questions')).status).toBe(401);
  });
});
