# SkillForge AI

[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://reactjs.org)
[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://python.org)
[![Gemini](https://img.shields.io/badge/Gemini-2.0%20Flash-4285F4?logo=google&logoColor=white)](https://aistudio.google.com)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com)
[![FastAPI](https://img.shields.io/badge/FastAPI-RecSys-009688?logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![License](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

> **Multi-tenant B2B SaaS for adaptive corporate training — 9 specialized AI agents + Hybrid SVD Recommendation Engine**

---

## What It Does

SkillForge AI turns a plain-English learning goal into a **fully personalized training program** — curriculum, daily challenges, scoring, tutor chat, interview prep, and market intelligence — all orchestrated by AI agents that adapt every 3 sessions.

**Currently in live pilot at a real company.**

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                 React 18 Frontend (Vercel)               │
│   Dashboard │ Employee Analytics │ Admin Metrics │ Chat  │
└─────────────────┬───────────────────────────────────────┘
                  │ REST + WebSocket
┌─────────────────▼───────────────────────────────────────┐
│              Node.js + Express Backend (Render)          │
│  25 route modules │ JWT auth │ Company isolation (RBAC)  │
│                                                          │
│  ┌─────────────────────────────────────────────────┐    │
│  │           9 AI Agent Orchestration Layer        │    │
│  │  SkillDecomposer → DiagnosticQuiz → PlanBuilder │    │
│  │  ChallengeEngine → Evaluator → ReportGenerator  │    │
│  │  MarketAgent → InterviewAgent → AutonomousAgent  │    │
│  └────────────────┬────────────────────────────────┘    │
│                   │                                      │
│  ┌────────────────▼────────────────────────────────┐    │
│  │           LLM Tier Routing + Cache Layer         │    │
│  │  Tier 1: Gemini 2.0 Flash  (complex/JSON/eval)  │    │
│  │  Tier 2: Groq llama-3.3-70b (medium tasks)      │    │
│  │  Tier 3: Groq llama-3.1-8b-instant (chat/brief) │    │
│  │  LLMCache: 7 TTL layers (2 min to 7 days)       │    │
│  └─────────────────────────────────────────────────┘    │
└──────────┬──────────────────────┬───────────────────────┘
           │                      │
┌──────────▼──────┐    ┌──────────▼─────────────────────┐
│    Supabase     │    │  Python RecSys Engine (FastAPI) │
│   PostgreSQL    │    │  SVD Collaborative Filtering     │
│  Multi-tenant   │    │  TF-IDF Content-Based Filtering  │
│  RLS policies   │    │  Hybrid Scoring + ML Metrics     │
└─────────────────┘    │  POST /recommend | GET /metrics  │
                       └────────────────────────────────┘
```

---

## Key Metrics

| Metric | Value |
|--------|-------|
| LLM API cost reduction | 60-70% via tiered routing + TTL cache |
| Cache layers | 7 (2 min to 7 days) |
| AI agents | 9 specialized agents |
| RecSys algorithm | Hybrid SVD + TF-IDF cosine similarity |
| RecSys evaluation | Precision@5, Recall@5, NDCG@10, Coverage |
| Deployment | Live production pilot |
| Supported domains | Any (medicine, law, coding, cooking, music, etc.) |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, Vite, Tailwind CSS, Recharts, Framer Motion |
| Backend | Node.js 20, Express, Socket.io |
| Recommendation Engine | Python 3.10, FastAPI, scipy SVD, scikit-learn TF-IDF |
| AI / LLM | Gemini 2.0 Flash, Groq LLaMA 3.3-70b, LLaMA 3.1-8b-instant |
| Database | Supabase (PostgreSQL) with RLS, multi-tenant isolation |
| Auth | JWT + RBAC (SuperAdmin to Admin to Manager to Employee) |
| Deployment | Vercel (frontend) + Render (backend) |
| Caching | In-process TTL cache (LLMCache.js) |

---

## 9 AI Agents

| Agent | What It Does |
|-------|-------------|
| **SkillDecomposer** | Takes any goal in plain English and generates domain-specific curriculum (7-day cache) |
| **QuizGenerator** | Creates 5 diagnostic MCQs to measure baseline — domain-aware, never generic (12h cache) |
| **ChallengeEngine** | Builds daily personalized challenges with concept summary, hints, warm-up MCQ (4h cache) |
| **Evaluator** | Scores open-ended responses against evaluation criteria (30-min dedup cache) |
| **PlanBuilder** | Constructs day-by-day learning plan with adaptive difficulty |
| **ReportGenerator** | AI coaching report with narrative, capability statement, next milestone |
| **MarketAgent** | Job market intelligence — demand scores, salary data, skill gaps (24h cache) |
| **InterviewAgent** | Generates role-based interview questions, evaluates answers, final report (24h cache) |
| **AutonomousScheduler** | Background agent every 6h — personalized daily briefs via Groq 8b-instant |

---

## Recommendation Engine

**Algorithm:** Hybrid SVD Collaborative Filtering + TF-IDF Content-Based Filtering

```
Interaction Matrix (users x skills, values = engagement score 0-1)
         |
SVD Decomposition: U, sigma, Vt = svds(matrix, k=50)
         |
Predicted Ratings = U x diag(sigma) x Vt
         |
TF-IDF Skill Vectors + cosine_similarity (sklearn)
         |
Hybrid Score = alpha x CF_score + (1-alpha) x CB_score + demand_boost
             where demand_boost = market_demand_score / 100 x 0.1
```

**Adaptive Weighting:**
- Cold-start users (fewer than 3 interactions): 40% collaborative + 60% content-based
- Active users (3 or more interactions): 70% collaborative + 30% content-based

**Dataset:**
- Source: SkillForge platform user activity (synthetic + real pilot data)
- Features: user_id, skill_id, engagement_score (0-1), interaction_type
- Size: 10,000+ user-session records across 50 skills and 200+ topics
- Train/test split: 80/20 for metric evaluation

**Evaluation Metrics (auto-recalculated every 24h):**

| Metric | Description |
|--------|-------------|
| Precision@5 | Of top 5 recommendations, how many did the user engage with |
| Recall@5 | Of all skills user engaged with, how many appear in top 5 |
| NDCG@10 | Normalized Discounted Cumulative Gain — ranking quality |
| Coverage | Percentage of skill catalog appearing in any recommendation |

**API Endpoints:**
- `POST /recommend` — body: `{ user_id, top_k }` — returns ranked skill list
- `GET /metrics` — latest Precision@5, NDCG@10, Coverage
- `GET /health` — service status

---

## Multi-Tenant Architecture

```
SuperAdmin
    |__ Company A (Admin A)          <- Cannot see Company B data
            |__ Manager A1
            |     |__ Employee 1
            |     |__ Employee 2
            |__ Manager A2
                  |__ Employee 3

Company B (Admin B)                  <- Fully isolated
    |__ ...
```

- JWT token carries companyId — every API query filters by it
- Approval workflow: managers submit requests, admins approve/reject
- Group management, assignment tracking, company module library

---

## Quick Start

### Prerequisites
- Node.js 20+, Python 3.10+
- Supabase account (free tier works)
- Gemini API key (free at aistudio.google.com)
- Groq API key (free at console.groq.com)

### Install
```bash
git clone https://github.com/gurusaiss/Skill-AI.git
cd Skill-AI
npm install
cd client && npm install && cd ..
cd server && npm install && cd ..
```

### Environment Variables
```bash
cp .env.example .env
```

Required:
```
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GEMINI_API_KEY=your_gemini_key
GROQ_API_KEY=your_groq_key
JWT_SECRET=your_jwt_secret
REC_ENGINE_URL=http://localhost:8001
```

### Run (Development)
```bash
# Terminal 1 — Backend
npm run dev:server

# Terminal 2 — Frontend
npm run dev:client

# Terminal 3 — Recommendation Engine
cd rec-engine
pip install -r requirements.txt
uvicorn main:app --reload --port 8001
```

- Frontend: http://localhost:5173
- API: http://localhost:3001
- RecSys docs: http://localhost:8001/docs

### Demo Accounts
```
Admin:    admin@gss.com    / password123
Manager:  manager@gss.com  / password123
Employee: employee@gss.com / password123
```

---

## LLM Cost Optimization

```
Monthly cost at 1,000 active users:
  Before:  ~$90/month
  After:   ~$28/month  (67% reduction)

Strategy:
  1. Tier-3 tasks (chat, briefs) -> Groq llama-3.1-8b-instant (near-free)
  2. 7-layer TTL cache -> eliminates duplicate LLM calls
  3. History trimming (5->3 turns) -> 20% fewer tokens per message
  4. Domain-level market cache (24h) -> 1 call per domain per day
  5. Goal decomposition cache (7d) -> never regenerate same curriculum
```

---

## Project Structure

```
SkillForge AI/
|__ client/                    # React 18 frontend
|   |__ src/
|       |__ pages/
|       |   |__ admin/         # Admin dashboards + metrics
|       |   |__ employee/      # Employee analytics + recommendations
|       |   |__ manager/
|       |__ components/        # 29 shared UI components
|__ server/                    # Node.js Express backend
|   |__ agent/                 # 9 AI agents
|   |__ routes/                # 25 REST route modules
|   |__ services/
|   |   |__ GeminiService.js   # LLM tier routing
|   |   |__ LLMCache.js        # TTL cache (7 layers)
|   |__ middleware/            # Auth, rate limiting
|__ rec-engine/                # Python FastAPI recommendation service
|   |__ main.py                # FastAPI app + endpoints
|   |__ recommender.py         # SVD + TF-IDF hybrid
|   |__ metrics.py             # Precision@K, NDCG, Coverage
|   |__ requirements.txt
|__ docs/                      # API documentation
```

---

## Domain Coverage

SkillForge generates real domain-specific curricula — not generic placeholders:

| Goal | Domain | Example Skills |
|------|--------|----------------|
| "Become a doctor" | Medicine | Human Anatomy, Pharmacology, Clinical Diagnosis |
| "Learn to code" | Full Stack | React, Node.js, PostgreSQL, Docker |
| "Get into law" | Law | Constitutional Law, Contract Law, Legal Drafting |
| "Learn guitar" | Music | Music Theory, Chord Shapes, Scales, Performance |
| "Master machine learning" | ML | PyTorch, Transformers, CUDA, MLOps |

---

## License

MIT — see [LICENSE](./LICENSE)
