import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnv } from './config/loadEnv.js';
import { swaggerSpec } from './swagger.js';

import goalRouter from './routes/goal.js';
import diagnosticRouter from './routes/diagnostic.js';
import sessionRouter from './routes/session.js';
import reportRouter from './routes/report.js';
import simulationRouter from './routes/simulation.js';
import marketRouter from './routes/market.js';
import demoRouter from './routes/demo.js';
import interviewRouter from './routes/interview.js';
import assessmentRouter from './routes/assessment.js';
import tutorRouter from './routes/tutor.js';
import reactRouter from './routes/react.js';
import memoryRouter from './routes/memory.js';

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
import agentControlRouter from './routes/agentcontrol.js';
import autonomousScheduler from './agent/AutonomousScheduler.js';
import superadminRouter from './routes/superadmin.js';
import adminDashboardRouter from './routes/adminDashboard.js';
import approvalsRouter from './routes/approvals.js';
import groupsRouter from './routes/groups.js';
import recommendationsRouter from './routes/recommendations.js';
import { autoSeed } from './utils/autoSeed.js';
import { migrateDB } from './utils/migrateDB.js';
import { migrateDefaultUsersToGSS } from './utils/migrateGSS.js';
import LLMCache from './services/LLMCache.js';
import geminiService from './services/GeminiService.js';

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
    // Check + warn about missing DataStore tables (assessments, companies, etc.)
    await migrateDB();
    await migrateDefaultUsersToGSS();
    // Auto-seed demo accounts if none exist (runs once on first deploy)
    await autoSeed();
  } catch (err) {
    console.warn('[DB] Store init warning:', err.message);
    // Still try to seed even if Supabase init had issues
    try { await autoSeed(); } catch {}
  }
}).catch(err => {
  console.warn('[DB] Store import warning:', err.message);
});

const app = express();
const PORT = process.env.PORT || 3001;

// Trust Render/Vercel/Railway reverse proxy — required for rate-limiter + correct IP
app.set('trust proxy', 1);
const geminiEnabled = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10);
const groqEnabled = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.length > 10);

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://skillforge-swart-mu.vercel.app',          // production frontend
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow any vercel.app preview deploy for this project
    if (origin.endsWith('.vercel.app')) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
// Handle OPTIONS preflight for all routes
app.options('*', cors());
app.use(express.json({ limit: '2mb' }));

// ── API Documentation ────────────────────────────────────────────────────────────
app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
app.get('/api/docs', (_req, res) => {
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>SkillForge AI — API Docs</title>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    SwaggerUIBundle({
      url: '/api/docs.json',
      dom_id: '#swagger-ui',
      presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      layout: 'BaseLayout',
      deepLinking: true,
      defaultModelsExpandDepth: 2,
    });
  </script>
</body>
</html>`);
});

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
      llm: geminiService.getStats(),
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

// Super Admin platform management
app.use('/api/superadmin', superadminRouter);
app.use('/api/admin', adminDashboardRouter);
app.use('/api/approvals', approvalsRouter);
app.use('/api/groups', groupsRouter);

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
app.use('/api/assessments', assessmentRouter);  // plural — matches client calls
app.use('/api/assessment',  assessmentRouter);  // keep singular as alias for back-compat
app.use('/api/tutor', tutorRouter);
app.use('/api/react', reactRouter);
app.use('/api/memory', memoryRouter);
app.use('/api/agent-control', agentControlRouter);
app.use('/api/recommendations', recommendationsRouter);

// ── Autonomous Agent Brief routes ──────────────────────────────────────────
app.get('/api/brief/:userId', (req, res) => {
  const brief = autonomousScheduler.getBrief(req.params.userId);
  if (brief) {
    res.json(brief);
  } else {
    res.json({
      generatedAt: new Date().toISOString(),
      type: 'daily_brief',
      streak: 0,
      completedDays: 0,
      avgScore: 0,
      insight: 'Start your first session today to unlock AI-powered personalized insights!',
      alerts: [],
      recommendation: { action: 'start', msg: 'Complete your first session to activate the AI analysis engine.' },
      nextDay: null,
    });
  }
});
app.get('/api/scheduler/status', (req, res) => res.json(autonomousScheduler.getStatus()));

// ── Serve React frontend in production ────────────────────────────────────────
// The Dockerfile copies client/dist next to server/ so the path resolves to
// /app/client/dist inside the container (and works for local prod builds too).
const clientDist = join(__dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback — all non-API routes return index.html
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(join(clientDist, 'index.html'));
    }
  });
  console.log('[static] Serving React build from', clientDist);
}

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({
    success: false,
    data: null,
    error: err.message || 'Internal server error',
  });
});

const httpServer = createServer(app);

// ── Socket.io — Real-time agent event streaming ───────────────────────────────
export const io = new SocketServer(httpServer, {
  cors: { origin: allowedOrigins.length > 2 ? allowedOrigins : '*', credentials: true },
  transports: ['websocket', 'polling'],
});

io.on('connection', (socket) => {
  const userId = socket.handshake.auth?.userId;
  if (userId) socket.join(`user:${userId}`);

  socket.on('subscribe:session', (sessionId) => socket.join(`session:${sessionId}`));
  socket.on('subscribe:goal', (goalId) => socket.join(`goal:${goalId}`));

  socket.on('disconnect', () => {
    if (userId) socket.leave(`user:${userId}`);
  });
});

// Helper exported so routes can push real-time events
export const emitToUser = (userId, event, data) => io.to(`user:${userId}`).emit(event, data);
export const emitToSession = (sessionId, event, data) => io.to(`session:${sessionId}`).emit(event, data);
export const emitToGoal = (goalId, event, data) => io.to(`goal:${goalId}`).emit(event, data);

const server = httpServer.listen(PORT, () => {
  // Start autonomous background agent
  autonomousScheduler.start();
  console.log(`
╔════════════════════════════════════════╗
║       SkillForge AI Server v3          ║
╠════════════════════════════════════════╣
║  Port:    ${PORT}                           ║
║  Gemini:  ${geminiEnabled ? '✅ ON  (gemini-2.0-flash)' : '❌ OFF (rule-based fallback)'}  ║
║  WS:      ✅ Socket.io enabled          ║
║  Docs:    http://localhost:${PORT}/api/docs ║
║  DB:      ${process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'placeholder' ? '📦 Supabase' : '📁 File-based'}                 ║
║  Env:     ${process.env.NODE_ENV || 'development'}                     ║
╚════════════════════════════════════════╝`);
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