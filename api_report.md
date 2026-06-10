# SkillForge AI — LLM API Cost & Usage Report

> **Date:** June 2026 | **Project:** SkillForge AI | **Environment:** Production (Render + Vercel)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current API Configuration](#2-current-api-configuration)
3. [All LLM Calls — Detailed Breakdown](#3-all-llm-calls--detailed-breakdown)
4. [Token Usage Per Functionality](#4-token-usage-per-functionality)
5. [Cost Calculations](#5-cost-calculations)
6. [LLM Provider Comparison](#6-llm-provider-comparison)
7. [Model Comparison](#7-model-comparison)
8. [Best Strategy for Low Cost + High Performance](#8-best-strategy-for-low-cost--high-performance)
9. [Recommended Architecture](#9-recommended-architecture)
10. [Immediate Actions](#10-immediate-actions)

---

## 1. Executive Summary

| Metric | Value |
|--------|-------|
| Primary LLM | **Gemini 2.0 Flash** (Google AI) |
| Fallback LLM | **llama-3.3-70b-versatile** (Groq) |
| Total LLM call types | **13 distinct functions** |
| Estimated cost per 100 active users/day | **~$0.30–$0.45/day** |
| Estimated monthly cost (100 users) | **~$9–$14/month** |
| Estimated monthly cost (1,000 users) | **~$90–$140/month** |
| Free tier available | **Yes — Gemini & Groq both have free tiers** |

**Bottom line:** The current Gemini 2.0 Flash setup is already near-optimal for cost. The main savings opportunity is adding result caching and using smaller models for simpler tasks.

---

## 2. Current API Configuration

### Active API Keys

| Key | Provider | Model | Status |
|-----|----------|-------|--------|
| `GEMINI_API_KEY` | Google AI Studio | `gemini-2.0-flash` | ✅ Active (Primary) |
| `GROQ_API_KEY` | Groq Cloud | `llama-3.3-70b-versatile` | ✅ Active (Fallback) |
| `OPENAI_API_KEY` | OpenAI | GPT-4o-mini | ⚠️ Configured but unused in main flow |

### Failover Strategy

```
User Action
    ↓
Gemini 2.0 Flash (Primary)
    ↓ [on failure / 429 quota]
Groq llama-3.3-70b (Fallback)
    ↓ [on all LLM failure]
Rule-based / Template fallback
    ↓ [always succeeds]
Response returned
```

### Key Parameters

| Setting | JSON Calls | Text Calls |
|---------|-----------|------------|
| Max output tokens | 2,048 | 1,024 |
| Temperature | 0.7 | 0.8 |
| Timeout | 30s | 20s |

---

## 3. All LLM Calls — Detailed Breakdown

### Call #1 — Skill Decomposition
| Property | Detail |
|----------|--------|
| **File** | `server/agent/SkillDecomposer.js` |
| **Function** | `decomposeWithLLM(goalText, jobDescriptionText)` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User submits a new learning goal |
| **Frequency** | Once per new goal (low frequency) |
| **Input tokens** | ~1,500–2,000 |
| **Output tokens** | ~500–800 |
| **Purpose** | Converts user goal into domain-specific skill tree (4–6 skills) |
| **Fallback** | Keyword-based domain detection |

---

### Call #2 — Diagnostic Quiz Generation
| Property | Detail |
|----------|--------|
| **File** | `server/agent/QuizGenerator.js` |
| **Function** | `generateWithLLM(skillTree)` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | After skill decomposition, once per goal |
| **Frequency** | Once per new goal |
| **Input tokens** | ~1,200–1,800 |
| **Output tokens** | ~400–600 |
| **Purpose** | Creates 5-question MCQ diagnostic test |
| **Fallback** | Static question bank → template generator |

---

### Call #3 — Session Evaluation (Scoring)
| Property | Detail |
|----------|--------|
| **File** | `server/agent/Evaluator.js` |
| **Function** | `evaluateWithLLM(challenge, userResponse, context)` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User submits response to a challenge |
| **Frequency** | Per session completion (1–5x per active user per day) |
| **Input tokens** | ~1,500–2,500 |
| **Output tokens** | ~300–500 |
| **Purpose** | Score open-ended answers (0–100), generate grade + feedback |
| **Fallback** | Keyword-matching scorer |

---

### Call #4 — Challenge Generation
| Property | Detail |
|----------|--------|
| **File** | `server/agent/ChallengeEngine.js` |
| **Function** | `generateWithLLM(planDay, session)` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User requests daily learning challenge |
| **Frequency** | Once per learning day per user |
| **Input tokens** | ~1,200–1,800 |
| **Output tokens** | ~600–900 |
| **Purpose** | Generates domain-specific practical challenge + warmup MCQ |
| **Fallback** | Static knowledge bank → template |

---

### Call #5 — Progress Report Generation
| Property | Detail |
|----------|--------|
| **File** | `server/agent/ReportGenerator.js` |
| **Function** | `generateNarrativeWithLLM(session)` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User requests learning progress report |
| **Frequency** | On-demand (occasional) |
| **Input tokens** | ~1,200–1,600 |
| **Output tokens** | ~400–600 |
| **Purpose** | AI-personalized narrative: strengths, milestones, next steps |
| **Fallback** | Template-based narrative |

---

### Call #6 — Autonomous Daily Brief
| Property | Detail |
|----------|--------|
| **File** | `server/agent/AutonomousScheduler.js` |
| **Function** | `_buildBrief(userId, data)` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | Background scheduler — every 6 hours |
| **Frequency** | Up to 10 users per cycle × 4 cycles/day = 40 calls/day max |
| **Input tokens** | ~200–400 |
| **Output tokens** | ~100–200 |
| **Purpose** | 2-sentence motivational insight per active learner |
| **Fallback** | Rule-based templates (streak-based messages) |

---

### Call #7 — Interview Question Generation
| Property | Detail |
|----------|--------|
| **File** | `server/agent/InterviewAgent.js` |
| **Function** | `generateQuestions({ role, skills, difficulty, count })` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User starts interview simulation |
| **Frequency** | Once per interview session |
| **Input tokens** | ~600–900 |
| **Output tokens** | ~400–600 |
| **Purpose** | Generate 5+ role-specific interview questions with follow-ups |
| **Fallback** | Static domain question bank |

---

### Call #8 — Interview Answer Evaluation
| Property | Detail |
|----------|--------|
| **File** | `server/agent/InterviewAgent.js` |
| **Function** | `evaluateAnswer({ question, answer, role })` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User submits each interview answer |
| **Frequency** | 5–10 calls per interview session |
| **Input tokens** | ~800–1,200 |
| **Output tokens** | ~300–400 |
| **Purpose** | Score + grade each answer, decide follow-up |
| **Fallback** | Keyword scoring |

---

### Call #9 — Interview Final Report
| Property | Detail |
|----------|--------|
| **File** | `server/agent/InterviewAgent.js` |
| **Function** | `generateReport(questions, role)` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | Interview session completed |
| **Frequency** | Once per completed interview |
| **Input tokens** | ~1,200–2,000 |
| **Output tokens** | ~500–800 |
| **Purpose** | Overall score, readiness level, improvement roadmap |
| **Fallback** | Computed metrics report |

---

### Call #10 — Market Intelligence
| Property | Detail |
|----------|--------|
| **File** | `server/agent/MarketAgent.js` |
| **Function** | `_getWithLLM({ domain, goal, skills })` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User checks career market data |
| **Frequency** | On-demand (infrequent) |
| **Input tokens** | ~600–900 |
| **Output tokens** | ~400–600 |
| **Purpose** | Salary, job demand, trending skills, companies |
| **Fallback** | 8-domain hardcoded snapshot |

---

### Call #11 — Assessment Generation (JD → Questions)
| Property | Detail |
|----------|--------|
| **File** | `server/routes/assessment.js` |
| **Function** | `generateQuestionsFromJD(...)` |
| **API** | **Groq first** → Gemini fallback |
| **Model** | `llama-3.3-70b-versatile` (Groq) / `gemini-2.0-flash` |
| **Trigger** | Admin creates assessment for employees |
| **Frequency** | Per employee per assessment creation |
| **Input tokens** | ~2,000–4,000 |
| **Output tokens** | ~1,000–2,000 |
| **Purpose** | Parse JD, generate 2–30 unique questions per employee |
| **Fallback** | Deterministic role-based question bank |

---

### Call #12 — Session Quiz Generation
| Property | Detail |
|----------|--------|
| **File** | `server/routes/session.js` |
| **Function** | `POST /api/session/quiz` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User completes learning session |
| **Frequency** | Per completed session |
| **Input tokens** | ~1,000–1,500 |
| **Output tokens** | ~600–800 |
| **Purpose** | 10-question quiz (6 MCQ + 2 fill-blank + 2 subjective) |
| **Fallback** | Template-based 10-question generator |

---

### Call #13 — Study Notes Generation
| Property | Detail |
|----------|--------|
| **File** | `server/routes/session.js` |
| **Function** | `POST /api/session/notes` |
| **API** | Gemini 2.0 Flash |
| **Trigger** | User requests study notes |
| **Frequency** | Per topic studied (on-demand) |
| **Input tokens** | ~1,000–1,500 |
| **Output tokens** | ~600–800 |
| **Purpose** | Structured notes: definition, examples, tips, recap |
| **Fallback** | Comprehensive template notes |

---

## 4. Token Usage Per Functionality

### Per Single User Action — Token Cost

| Feature | Input Tokens | Output Tokens | Total Tokens | Cost (Gemini 2.0 Flash) |
|---------|-------------|---------------|--------------|------------------------|
| New Learning Goal | 2,700–3,800 | 900–1,400 | 3,600–5,200 | **$0.0004** |
| Daily Challenge | 1,200–1,800 | 600–900 | 1,800–2,700 | **$0.0001** |
| Submit Response (eval) | 1,500–2,500 | 300–500 | 1,800–3,000 | **$0.0002** |
| Session Quiz | 1,000–1,500 | 600–800 | 1,600–2,300 | **$0.0002** |
| Study Notes | 1,000–1,500 | 600–800 | 1,600–2,300 | **$0.0002** |
| Progress Report | 1,200–1,600 | 400–600 | 1,600–2,200 | **$0.0002** |
| Interview Session (full) | 8,000–14,000 | 3,800–6,200 | 11,800–20,200 | **$0.0015** |
| Market Intelligence | 600–900 | 400–600 | 1,000–1,500 | **$0.0001** |
| Tutor Chat (10 msgs) | 3,000–10,000 | 2,000–4,000 | 5,000–14,000 | **$0.0007** |
| Assessment Creation (20 employees, 10 Q each) | 40,000–80,000 | 20,000–40,000 | 60,000–120,000 | **$0.008** |

### Daily Projections by User Volume

| Users/Day | Daily Token Usage (est.) | Daily Cost | Monthly Cost |
|-----------|--------------------------|------------|--------------|
| 10 | ~500,000 tokens | ~$0.03 | ~$0.90 |
| 50 | ~2,500,000 tokens | ~$0.15 | ~$4.50 |
| 100 | ~5,000,000 tokens | ~$0.30 | ~$9.00 |
| 500 | ~25,000,000 tokens | ~$1.50 | ~$45.00 |
| 1,000 | ~50,000,000 tokens | ~$3.00 | ~$90.00 |
| 5,000 | ~250,000,000 tokens | ~$15.00 | ~$450.00 |

> Assumptions: avg 2 sessions/day, 5 chat messages, 1 challenge, 1 quiz, 0.1 interviews per user per day

### Free Tier Thresholds

| Provider | Free Limit | SkillForge Equivalent |
|----------|-----------|----------------------|
| Gemini 2.0 Flash (Free) | 1,000 RPD (requests/day), 1M TPM | Supports ~15–20 active users/day free |
| Groq (Free) | 14,400 RPD, 500,000 TPD | Assessment generation for ~50 employees free/day |

---

## 5. Cost Calculations

### Gemini 2.0 Flash Pricing (June 2026)

| Token Type | Price |
|-----------|-------|
| Input | $0.075 per 1M tokens |
| Output | $0.30 per 1M tokens |

### Scenario A — Startup (100 users, 30% daily active)

| Feature | Daily Calls | Input Tokens | Output Tokens | Daily Cost |
|---------|------------|-------------|---------------|------------|
| Skill Decompose | 5 | 8,750 | 3,250 | $0.0007 |
| Quiz Generate | 5 | 7,500 | 2,500 | $0.0006 |
| Session Evaluate | 30 | 60,000 | 12,000 | $0.0082 |
| Challenge Gen | 30 | 45,000 | 22,500 | $0.0101 |
| Progress Reports | 10 | 14,000 | 5,000 | $0.0020 |
| Scheduler Brief | 10 | 3,000 | 1,500 | $0.0007 |
| Interview Sessions | 5 | 50,000 | 23,500 | $0.0108 |
| Market Intel | 10 | 7,500 | 5,000 | $0.0015 |
| Assessments (JD) | 20 | 60,000 | 30,000 | $0.0135 |
| Session Quiz | 30 | 37,500 | 21,000 | $0.0091 |
| Study Notes | 20 | 25,000 | 14,000 | $0.0060 |
| Tutor Chat | 50 msgs | 32,500 | 15,000 | $0.0069 |
| **TOTAL/DAY** | | **~350,000** | **~155,000** | **~$0.070** |
| **TOTAL/MONTH** | | | | **~$2.10** |

### Scenario B — Growth (1,000 users, 30% daily active)

| | Daily | Monthly |
|--|-------|---------|
| Estimated cost | ~$0.70 | **~$21** |

### Scenario C — Scale (10,000 users, 20% daily active)

| | Daily | Monthly |
|--|-------|---------|
| Estimated cost | ~$4.20 | **~$126** |

### Assessment Generation Cost Breakdown

> This is the most token-intensive operation (2,000–4,000 input tokens per employee):

| Employees per Assessment | Questions Each | Gemini Cost | Groq Cost (if used) |
|--------------------------|---------------|-------------|---------------------|
| 10 | 10 | $0.003 | $0.002 |
| 50 | 10 | $0.015 | $0.008 |
| 100 | 10 | $0.030 | $0.016 |
| 50 | 30 (max) | $0.025 | $0.014 |

---

## 6. LLM Provider Comparison

### Pricing Table (Per 1M Tokens — June 2026)

| Provider | Model | Input $/1M | Output $/1M | Total (est. avg) | Speed | JSON Quality |
|----------|-------|-----------|------------|-----------------|-------|-------------|
| **Google** | gemini-2.0-flash | $0.075 | $0.30 | **$0.19** | ⚡ Very Fast | ⭐⭐⭐⭐⭐ |
| **Google** | gemini-1.5-flash | $0.075 | $0.30 | **$0.19** | ⚡ Very Fast | ⭐⭐⭐⭐⭐ |
| **Google** | gemini-1.5-flash-8b | $0.0375 | $0.15 | **$0.09** | ⚡⚡ Fastest | ⭐⭐⭐⭐ |
| **Google** | gemini-2.5-pro | $1.25 | $10.00 | **$5.63** | 🐢 Slow | ⭐⭐⭐⭐⭐ |
| **Groq** | llama-3.3-70b-versatile | $0.59 | $0.79 | **$0.69** | ⚡⚡ Fastest | ⭐⭐⭐⭐ |
| **Groq** | llama-3.1-8b-instant | $0.05 | $0.08 | **$0.07** | ⚡⚡ Fastest | ⭐⭐⭐ |
| **Groq** | gemma2-9b-it | Free | Free | **$0.00** | ⚡ Fast | ⭐⭐⭐ |
| **OpenAI** | gpt-4o-mini | $0.15 | $0.60 | **$0.38** | ⚡ Fast | ⭐⭐⭐⭐⭐ |
| **OpenAI** | gpt-4o | $2.50 | $10.00 | **$6.25** | 🐢 Slow | ⭐⭐⭐⭐⭐ |
| **OpenAI** | gpt-3.5-turbo | $0.50 | $1.50 | **$1.00** | ⚡ Fast | ⭐⭐⭐⭐ |
| **Anthropic** | claude-3-haiku | $0.25 | $1.25 | **$0.75** | ⚡ Fast | ⭐⭐⭐⭐⭐ |
| **Anthropic** | claude-3.5-haiku | $0.80 | $4.00 | **$2.40** | ⚡ Fast | ⭐⭐⭐⭐⭐ |
| **Anthropic** | claude-3.5-sonnet | $3.00 | $15.00 | **$9.00** | Medium | ⭐⭐⭐⭐⭐ |
| **Mistral** | mistral-small | $0.10 | $0.30 | **$0.20** | ⚡ Fast | ⭐⭐⭐⭐ |
| **Together AI** | llama-3.1-8b | $0.018 | $0.018 | **$0.018** | ⚡ Fast | ⭐⭐⭐ |

### Provider Strengths for SkillForge AI Use Cases

| Use Case | Best Provider | Reason |
|----------|--------------|--------|
| Structured JSON output | Google Gemini | Native JSON mode, very reliable |
| Fast chat responses | Groq + any llama | Fastest inference globally |
| Complex reasoning | Google Gemini 2.0 Flash | Best reasoning/cost ratio |
| Cost-free fallback | Groq (free tier) | 14,400 requests/day free |
| Assessment generation | Groq llama-3.3-70b | High token limit, cheap |
| Simple scoring | Groq llama-3.1-8b | Near-free, fast enough |

---

## 7. Model Comparison

### Head-to-Head: Best Models for SkillForge AI Tasks

| Feature | gemini-2.0-flash ✅ | gemini-1.5-flash-8b | llama-3.1-8b (Groq) | gpt-4o-mini |
|---------|---------------------|---------------------|---------------------|-------------|
| JSON generation | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| Long context (JD parsing) | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Educational content quality | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Answer evaluation accuracy | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Speed | ⚡⚡⚡⚡ | ⚡⚡⚡⚡⚡ | ⚡⚡⚡⚡⚡ | ⚡⚡⚡ |
| Cost | 💰💰 cheap | 💰 cheapest | 💰 near-free | 💰💰 cheap |
| Free tier | ✅ 1,000 req/day | ✅ | ✅ 14,400 req/day | ❌ |
| Context window | 1M tokens | 1M tokens | 128K tokens | 128K tokens |
| **Overall SkillForge fit** | **★★★★★** | **★★★★** | **★★★** | **★★★★** |

### Winner Analysis

| Rank | Model | Provider | Monthly Cost (100 users) | Best For |
|------|-------|----------|--------------------------|----------|
| 🥇 1st | **gemini-2.0-flash** | Google | ~$2–9 | Everything — JSON, eval, generation |
| 🥈 2nd | **llama-3.1-8b-instant** | Groq | ~FREE | Simple tasks, chat, scoring |
| 🥉 3rd | **gemini-1.5-flash-8b** | Google | ~$1–4 | Simple tasks, scheduler briefs |
| 4th | **gpt-4o-mini** | OpenAI | ~$4–18 | JSON if Gemini unavailable |
| 5th | **llama-3.3-70b** | Groq | ~$3–12 | Complex assessment generation |

---

## 8. Best Strategy for Low Cost + High Performance

### Tiered Model Strategy (Recommended)

```
┌─────────────────────────────────────────────────────────┐
│  TIER 1 — Complex / High Quality (Gemini 2.0 Flash)     │
│  • Skill decomposition                                   │
│  • Assessment generation from JD                        │
│  • Interview question generation & evaluation           │
│  • Evaluating open-ended session responses              │
│  • Progress report narrative                            │
│  Cost: $0.075/$0.30 per 1M tokens                       │
├─────────────────────────────────────────────────────────┤
│  TIER 2 — Medium Tasks (Groq llama-3.1-8b OR gemini)   │
│  • Session quiz generation                              │
│  • Study notes                                          │
│  • Challenge generation                                 │
│  • Market intelligence                                  │
│  Cost: ~$0.05/$0.08 per 1M tokens (Groq)               │
├─────────────────────────────────────────────────────────┤
│  TIER 3 — Simple / High Frequency (Groq llama-3.1-8b)  │
│  • Tutor chat responses                                 │
│  • Motivational scheduler briefs                        │
│  • Simple answer scoring                                │
│  Cost: Near-free on Groq free tier                      │
└─────────────────────────────────────────────────────────┘
```

### Cost Savings Opportunities

| Optimization | Estimated Savings | Effort |
|-------------|------------------|--------|
| Cache assessment questions per JD (same JD → same questions) | 40–60% on assessment costs | Low |
| Use llama-3.1-8b for tutor chat (currently Gemini) | 80% on tutor chat costs | Low |
| Use llama-3.1-8b for scheduler briefs | 95% on brief costs | Low |
| Cache market intelligence per domain (expires 24h) | 70% on market intel | Low |
| Reduce tutor chat history to 3 turns (from 5) | 20% on chat costs | Low |
| Cache quiz templates per skill (expires 7 days) | 50% on quiz costs | Medium |

### Projected Savings with Optimizations

| Scenario | Current Cost/Month | Optimized Cost/Month | Savings |
|----------|--------------------|----------------------|---------|
| 100 users | ~$9 | ~$3 | **67%** |
| 1,000 users | ~$90 | ~$28 | **69%** |
| 5,000 users | ~$450 | ~$135 | **70%** |

---

## 9. Recommended Architecture

### Immediate (No Code Changes)

1. **Switch tutor chat to Groq llama-3.1-8b** — Same quality for short responses, near-free
2. **Switch scheduler briefs to Groq llama-3.1-8b** — 2-sentence outputs don't need 70B model
3. **Enable Gemini free tier monitoring** — Stay under 1,000 req/day for low-traffic periods

### Short Term (1–2 weeks)

```javascript
// server/services/GeminiService.js — Add model routing
const MODEL_TIERS = {
  // Tier 1: Complex tasks → Gemini 2.0 Flash
  complex: 'gemini-2.0-flash',
  // Tier 2: Medium tasks → Gemini 1.5 Flash 8B (half the cost)
  medium: 'gemini-1.5-flash-8b',
  // Tier 3: Simple / chat → Groq llama-3.1-8b (near-free)
  simple: 'groq:llama-3.1-8b-instant',
};
```

4. **Add Redis/memory cache** for:
   - Assessment questions per JD hash (TTL: 7 days)
   - Market intelligence per domain (TTL: 24 hours)
   - Quiz templates per skill (TTL: 24 hours)

### Long Term (1 month+)

5. **Use Gemini 2.5 Flash** (when stable) — Same price, better reasoning
6. **Implement token budgets** per user per day to cap costs
7. **Add usage analytics** dashboard using `GeminiService.callCount` + `groqCallCount`

---

## 10. Immediate Actions

### Priority 1 — Do Now (Zero cost, instant savings)

- [ ] Change `AutonomousScheduler.js` to use Groq `llama-3.1-8b-instant` instead of Gemini
- [ ] Change `tutor.js` chat to use Groq `llama-3.1-8b-instant` for responses
- [ ] Set `GEMINI_MODEL=gemini-2.0-flash` (confirm in `.env` — already set)
- [ ] Verify Groq free tier is active at `console.groq.com`
- [ ] Verify Gemini free tier at `aistudio.google.com` (1,000 req/day free)

### Priority 2 — This Week

- [ ] Add in-memory LRU cache for market intelligence (domain → result, TTL 24h)
- [ ] Add JD hash caching for assessment generation (same JD = cached questions)
- [ ] Reduce tutor chat history from 5 to 3 turns (20% token reduction)
- [ ] Add logging: log `callCount`, `groqCallCount` to console on `/api/health`

### Priority 3 — This Month

- [ ] Add per-company token usage tracking (store in `companies` record)
- [ ] Expose usage stats on Super Admin dashboard
- [ ] Implement daily token budget per company (configurable by plan tier)
- [ ] Evaluate `gemini-1.5-flash-8b` for medium-tier tasks (50% cheaper than 2.0-flash)

---

## Summary — Best Choice for SkillForge AI

| Criteria | Winner | Reason |
|----------|--------|--------|
| **Lowest cost** | Groq llama-3.1-8b | Near-free, 14,400 req/day free |
| **Best performance** | Gemini 2.0 Flash | Best JSON, reasoning, context |
| **Best balance (recommended)** | **Gemini 2.0 Flash + Groq fallback** | Already implemented ✅ |
| **Best free option** | Gemini 2.0 Flash free tier + Groq free | Up to ~30 active users/day free |
| **Best for scale (1K+ users)** | Gemini 2.0 Flash | $90/month at 1K users — very low |
| **Best for assessment generation** | Groq llama-3.3-70b | High token limit, low cost |
| **Best for chat/tutor** | Groq llama-3.1-8b | Fastest, cheapest, good quality |

> **Current setup is already excellent.** With the tutor chat + scheduler brief switch to Groq llama-3.1-8b and result caching added, total billing can be reduced by **60–70%** with no quality loss.

---

*Report generated for SkillForge AI — June 2026*
*API pricing subject to change — verify at: [aistudio.google.com/pricing](https://aistudio.google.com) | [console.groq.com](https://console.groq.com) | [platform.openai.com/pricing](https://platform.openai.com/pricing)*
