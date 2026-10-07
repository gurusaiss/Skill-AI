// Force IPv4 DNS resolution — Render free tier has no IPv6 outbound routing
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

import express from 'express';
import cors from 'cors';
import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { readFileSync, existsSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { loadEnv } from './config/loadEnv.js';
import { swaggerSpec } from './swagger.js';

import AuthService from './services/AuthService.js';
import { authenticate, requireRole } from './middleware/auth.js';
import { requestTiming, getPerformanceSummary } from './middleware/requestTiming.js';
import { MANAGER_TIER_ROLES } from './services/roleCapability.js';

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
import { startReminderSweep } from './services/ReminderSweep.js';
import superadminRouter from './routes/superadmin.js';
import adminDashboardRouter from './routes/adminDashboard.js';
import approvalsRouter from './routes/approvals.js';
import groupsRouter from './routes/groups.js';
import recommendationsRouter from './routes/recommendations.js';
import rolesRouter from './routes/roles.js';
import permissionsRouter from './routes/permissions.js';
import settingsRouter from './routes/settings.js';
import emailService from './services/EmailService.js';
import oauthService from './services/OAuthService.js';
import { autoSeed } from './utils/autoSeed.js';
import { migrateDB } from './utils/migrateDB.js';
import { migrateDefaultUsersToGSS } from './utils/migrateGSS.js';
import LLMCache from './services/LLMCache.js';
import geminiService from './services/GeminiService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
import { DATA_DIR as dataPath } from './config/dataDir.js';

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
    // Sync any modules stranded in the ephemeral JSON file into Supabase
    await db.syncFileModulesToSupabase();
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
const geminiEnabled = geminiService.isEnabled();
const groqEnabled = !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY.length > 10);

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'https://skillforge-swart-mu.vercel.app',          // production frontend
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_URL,
].filter(Boolean);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false,        // frontend Vite app manages its own CSP
  crossOriginEmbedderPolicy: false,    // needed for Socket.io compatibility
  // Enforce HTTPS in production (1 year max-age, includes subdomains)
  strictTransportSecurity: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true }
    : false,
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
}));

// Request timing (Server-Timing header, slow-request log, rolling aggregate for
// /api/health). Mounted BEFORE compression so it counts bytes on the wire.
app.use('/api', requestTiming);

// Compress all JSON/text responses — reduces payload 70-85%
app.use(compression());

// Global API rate limit — 300 req/min per IP (5 req/sec avg)
const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',   // never limit health checks
  handler: (_req, res) => res.status(429).json({ success: false, error: 'Too many requests — please slow down.' }),
});
app.use('/api/', globalLimiter);

// The heavy-LLM rate limiter (10 req/min/IP) is applied directly to the
// specific generation routes inside goal.js and assessment.js instead of
// blanket-mounted per-router here — see middleware/rateLimiters.js for why:
// the previous per-router mount also throttled high-frequency, zero-LLM
// routes (checking assignments, opening/submitting an assessment, loading a
// dashboard), which is a real outage risk for any office where many
// employees share one outbound IP.

// Global request timeout — 90s hard ceiling (prevents hung connections under load)
app.use((req, res, next) => {
  res.setTimeout(90000, () => {
    if (!res.headersSent) res.status(503).json({ success: false, error: 'Request timeout — server is under load, please retry.' });
  });
  next();
});

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Render health checks)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    // Allow preview deploys for THIS project only — not all .vercel.app subdomains
    if (origin.endsWith('.vercel.app') && origin.toLowerCase().includes('skillforge')) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  // X-Active-Role was missing here. Any request carrying it (i.e. every
  // request made after a user has EVER used "Switch to X View", since
  // active_role persists in localStorage across sessions) triggers a browser
  // CORS preflight that this server then rejects — the browser never even
  // shows the real response, it fails at the network layer as a bare
  // "Failed to fetch". That is invisible to curl/server-side testing (no
  // browser enforces CORS), which is why this was never caught by direct API
  // checks: every one of them succeeds because they don't preflight.
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Active-Role'],
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
      model: geminiService.resolvedModel,
      geminiKeys: geminiService.geminiKeys.length,
      cerebras: geminiService.cerebrasEnabled ? 'enabled' : 'disabled',
      openrouter: geminiService.openRouterEnabled ? 'enabled' : 'disabled',
      // Which build is actually running. APP_COMMIT is set at image build time
      // (see Dockerfile); startedAt changes on every restart, so after a deploy
      // a new startedAt proves the server restarted.
      build: {
        commit: process.env.APP_COMMIT || 'unknown',
        startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString(),
      },
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
      performance: getPerformanceSummary(),
      llm: geminiService.getStats(),
      integrations: {
        supabase: process.env.SUPABASE_URL && process.env.SUPABASE_URL !== 'placeholder',
        llm: geminiEnabled || groqEnabled,
        googleOAuth: oauthService.isGoogleConfigured(),
        smtp: emailService.isEnabled(),
      },
    },
  });
});

// ── DB health endpoint (admin use — requires authentication) ─────────────────
app.get('/api/health/db', authenticate, requireRole('admin', 'superadmin'), async (req, res) => {
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASESERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_KEY;
    if (!url || !key) return res.json({ success: true, data: { mode: 'file-only', tables: [] } });
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const CRITICAL = ['assessments', 'assessment_submissions', 'assessment_reports', 'pending_modules', 'module_assignments', 'user_jd_profiles', 'users', 'assignments', 'modules'];
    const status = await Promise.all(CRITICAL.map(async t => {
      const { error } = await sb.from(t).select('id').limit(1);
      return { table: t, exists: !error, error: error?.message };
    }));
    const missing = status.filter(s => !s.exists).map(s => s.table);
    res.json({ success: true, data: { tables: status, missing, healthy: missing.length === 0 } });
  } catch (e) {
    res.status(500).json({ success: false, error: e.message });
  }
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
app.use('/api/roles', rolesRouter);
app.use('/api/permissions', permissionsRouter);
app.use('/api/settings', settingsRouter);

// ── Autonomous Agent Brief routes (authenticated — own data only) ───────────
app.get('/api/brief/:userId', authenticate, (req, res) => {
  const { userId } = req.params;
  // Users can only read their own brief; admins/managers can read any
  const isSelf = req.user.userId === userId;
  const isPrivileged = req.user.role === 'admin' || req.user.role === 'superadmin' || MANAGER_TIER_ROLES.includes(req.user.role);
  if (!isSelf && !isPrivileged) {
    return res.status(403).json({ success: false, error: 'Access denied' });
  }
  const brief = autonomousScheduler.getBrief(userId);
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
app.get('/api/scheduler/status', authenticate, requireRole('admin', 'superadmin'), (req, res) => res.json(autonomousScheduler.getStatus()));

// ── Serve React frontend in production ────────────────────────────────────────
// The Dockerfile copies client/dist next to server/ so the path resolves to
// /app/client/dist inside the container (and works for local prod builds too).
const clientDist = join(__dirname, '..', 'client', 'dist');
if (existsSync(clientDist)) {
  // Vite emits content-hashed files under /assets: safe to cache for a year.
  // Everything else (index.html, favicon...) must be revalidated so a deploy is
  // picked up immediately.
  app.use(express.static(clientDist, {
    index: false,
    setHeaders: (res, filePath) => {
      const normalized = filePath.split('\\').join('/');
      if (normalized.includes('/assets/')) {
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      } else {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));
  // SPA fallback — non-API, non-file routes return index.html. A request for a
  // missing file (has an extension, e.g. a stale /assets/x.js after a deploy)
  // must be a real 404, not index.html served as 200 (which the browser would
  // then try to execute as JavaScript and cache under the asset URL).
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    if (/\.[a-zA-Z0-9]{1,8}$/.test(req.path)) {
      return res.status(404).type('text/plain').send('Not found');
    }
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(clientDist, 'index.html'));
  });
  console.log('[static] Serving React build from', clientDist);
}

// Global error handler — never leak internal details (stack, DB errors) for 5xx
app.use((err, req, res, _next) => {
  const status = err.status || err.statusCode || 500;
  console.error(`[error] ${req.method} ${req.path} → ${status}:`, err.message);
  if (status >= 500) console.error(err.stack);
  if (res.headersSent) return;
  res.status(status).json({
    success: false,
    data: null,
    // 5xx: opaque message to client; 4xx: pass the message through (validation errors etc.)
    error: status >= 500 ? 'Internal server error' : (err.message || 'An error occurred'),
  });
});

const httpServer = createServer(app);

// ── Socket.io — Real-time agent event streaming ───────────────────────────────
export const io = new SocketServer(httpServer, {
  cors: { origin: allowedOrigins.length > 2 ? allowedOrigins : '*', credentials: true },
  transports: ['websocket', 'polling'],
  pingTimeout:  20000,   // 20s — drop dead connections faster
  pingInterval: 25000,   // 25s — keep-alive heartbeat
  maxHttpBufferSize: 1e6, // 1MB max message size — prevents memory bombs
  connectTimeout: 10000,  // 10s to complete handshake
});

// Verify JWT on every Socket.io connection — prevents clients from joining
// arbitrary user rooms by spoofing the userId in the handshake auth payload.
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (token) {
    const decoded = AuthService.verifyJWT(token);
    if (decoded) {
      socket.authenticatedUserId = decoded.userId;
    }
    // Invalid/expired token — still allow connection but without authenticated room
  }
  next();
});

io.on('connection', (socket) => {
  // Use only server-verified userId, never the client-supplied one
  const userId = socket.authenticatedUserId;
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

  // Start the assessment deadline-reminder sweep (hourly, all environments —
  // this is a real feature, not a keep-alive hack, so it isn't gated to
  // production the way the Render keep-alive ping below is).
  startReminderSweep();

  // Keep-alive ping — prevents Render free tier from spinning down (spins down after 15 min idle).
  // Pings own health endpoint every 14 minutes. Only runs in production to avoid noise locally.
  if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
    const PING_INTERVAL_MS = 14 * 60 * 1000;
    setInterval(() => {
      fetch(`http://localhost:${PORT}/api/health`)
        .then(() => console.log('[keep-alive] ✅ Ping OK'))
        .catch(err => console.warn('[keep-alive] ⚠️  Ping failed:', err.message));
    }, PING_INTERVAL_MS);
    console.log('[keep-alive] Self-ping enabled (14 min interval)');
  }

  console.log(`
╔════════════════════════════════════════╗
║       SkillForge AI Server v3          ║
╠════════════════════════════════════════╣
║  Port:    ${PORT}                           ║
║  Gemini:  ${geminiEnabled ? `✅ ON  (${geminiService.resolvedModel}, ${geminiService.geminiKeys.length} key${geminiService.geminiKeys.length === 1 ? '' : 's'})` : '❌ OFF (rule-based fallback)'}  ║
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