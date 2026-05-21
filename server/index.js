import express from 'express';
import cors from 'cors';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnv } from './config/loadEnv.js';

import goalRouter from './routes/goal.js';
import diagnosticRouter from './routes/diagnostic.js';
import sessionRouter from './routes/session.js';
import reportRouter from './routes/report.js';
import simulationRouter from './routes/simulation.js';
import marketRouter from './routes/market.js';
import demoRouter from './routes/demo.js';
import interviewRouter from './routes/interview.js';
import assessmentRouter from './routes/assessment.js';

// Authentication routes
import authRouter from './routes/auth.js';
import oauthRouter from './routes/oauth.js';
import usersRouter from './routes/users.js';
import assignmentsRouter from './routes/assignments.js';
import modulesRouter from './routes/modules.js';
import auditRouter from './routes/audit.js';

// NEW: Content management routes (packages, skill packages, learning tracks, groups)
import contentRouter from './routes/content.js';
import orgRouter from './routes/organizations.js';
import notificationsRouter from './routes/notifications.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, 'data');

// Load .env from project root
loadEnv(join(__dirname, '..'));

if (!existsSync(dataPath)) {
  mkdirSync(dataPath, { recursive: true });
}

// Load knowledge bank at startup
const knowledgePath = join(__dirname, 'knowledge');
const knowledgeFiles = ['domains.json', 'questions.json', 'challenges.json'];
for (const file of knowledgeFiles) {
  try {
    readFileSync(join(knowledgePath, file), 'utf-8');
  } catch (err) {
    console.error(`[startup] Failed to load knowledge bank file: ${file}`, err.message);
    process.exit(1);
  }
}

// Initialize DB store (Supabase or file-based fallback)
import('./db/store.js').then(async db => {
  try {
    // Pass URL + service-role secret key (sb_secret_…) to initSupabase.
    // The store falls back to process.env.SUPABASESERVICE_ROLE_KEY internally.
    await db.initSupabase(process.env.SUPABASE_URL, process.env.SUPABASESERVICE_ROLE_KEY
                          || process.env.SUPABASE_SECRET_KEY
                          || process.env.SUPABASE_KEY);
    await db.initContentFiles();
    console.log('[DB] Store initialized:', db.supabaseEnabled() ? 'Supabase' : 'File-based');
  } catch (err) {
    console.warn('[DB] Store init warning:', err.message);
  }
}).catch(err => {
  console.warn('[DB] Store import warning:', err.message);
});

const app = express();
const PORT = process.env.PORT || 3001;
const geminiEnabled = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10);
const groqEnabled = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.length > 10);

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins.length > 2 ? allowedOrigins : '*',
  credentials: true,
}));
app.use(express.json({ limit: '2mb' }));

// ── Health check ────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      gemini: geminiEnabled ? 'enabled' : 'disabled',
      groq: groqEnabled ? 'enabled (fallback)' : 'disabled',
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      agents: [
        'GoalAgent', 'DecomposeAgent', 'DiagnosticAgent',
        'ScoringAgent', 'CurriculumAgent', 'EvaluatorAgent',
        'AdaptorAgent', 'MarketAgent', 'SimulationAgent',
      ],
      agentCount: 9,
      port: PORT,
      uptime: Math.round(process.uptime()) + 's',
      timestamp: new Date().toISOString(),
      db: process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'placeholder' ? 'supabase' : 'file',
    },
  });
});

// ── Routes ─────────────────────────────────────────────────────────────────────

// Authentication routes (public)
app.use('/api/auth', authRouter);
app.use('/api/oauth', oauthRouter);

// User management routes (protected)
app.use('/api/users', usersRouter);
app.use('/api/assignments', assignmentsRouter);
app.use('/api/modules', modulesRouter);
app.use('/api/audit', auditRouter);

// Content management routes (protected)
app.use('/api/content', contentRouter);

// Enterprise org structure
app.use('/api/org', orgRouter);
app.use('/api/notifications', notificationsRouter);

// Learning platform routes
app.use('/api/goal', goalRouter);
app.use('/api/diagnostic', diagnosticRouter);
app.use('/api/session', sessionRouter);
app.use('/api/report', reportRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/market', marketRouter);
app.use('/api/demo', demoRouter);
app.use('/api/interview', interviewRouter);
app.use('/api/assessment', assessmentRouter);

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({
    success: false,
    data: null,
    error: err.message || 'Internal server error',
  });
});

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║       SkillForge AI Server v3        ║
╠══════════════════════════════════════╣
║  Port:   ${PORT}                         ║
║  Gemini: ${geminiEnabled ? '✅ ON  (gemini-2.0-flash)  ' : '❌ OFF (rule-based fallback)'}  ║
║  DB:     ${process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'placeholder' ? '📦 Supabase' : '📁 File-based'}               ║
║  Env:    ${process.env.NODE_ENV || 'development'}                    ║
╚══════════════════════════════════════╝`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('\n[shutdown] SIGTERM received, closing server...');
  server.close(() => {
    console.log('[shutdown] Server closed');
    process.exit(0);
  });
});

export default app;
export { server };