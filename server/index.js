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

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataPath = join(__dirname, 'data');

// Load .env from project root (one file, that's all)
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

const app = express();
const PORT = process.env.PORT || 3001;
const geminiEnabled = !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 10);
const groqEnabled   = !!(process.env.GROQ_API_KEY   && process.env.GROQ_API_KEY.length   > 10);

// Middleware
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({ 
  origin: allowedOrigins.length > 2 ? allowedOrigins : '*',
  credentials: true 
}));
app.use(express.json({ limit: '2mb' }));

// ── Health check ────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    data: {
      status: 'ok',
      gemini: geminiEnabled ? 'enabled' : 'disabled',
      groq: groqEnabled ? 'enabled (fallback)' : 'disabled',
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      agents: ['GoalAgent','DecomposeAgent','DiagnosticAgent','ScoringAgent','CurriculumAgent','EvaluatorAgent','AdaptorAgent','MarketAgent','SimulationAgent'],
      port: PORT,
      uptime: Math.round(process.uptime()) + 's',
      timestamp: new Date().toISOString()
    }
  });
});

// Routes
app.use('/api/goal', goalRouter);
app.use('/api/diagnostic', diagnosticRouter);
app.use('/api/session', sessionRouter);
app.use('/api/report', reportRouter);
app.use('/api/simulation', simulationRouter);
app.use('/api/market', marketRouter);
app.use('/api/demo', demoRouter);
app.use('/api/interview', interviewRouter);

// Global error handler
app.use((err, req, res, _next) => {
  console.error('[error]', err.message);
  res.status(500).json({ success: false, data: null, error: err.message || 'Internal server error' });
});

const server = app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════╗
║       SkillForge AI Server v2        ║
╠══════════════════════════════════════╣
║  Port:   ${PORT}                         ║
║  Gemini: ${geminiEnabled ? '✅ ON  (gemini-2.0-flash)  ' : '❌ OFF (rule-based fallback)'}  ║
║  Env:    ${process.env.NODE_ENV || 'development'}                    ║
╚══════════════════════════════════════╝`);
});

// Export for Vercel serverless
export default app;
export { server };
