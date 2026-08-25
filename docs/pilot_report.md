# SKILLFORGE — MASTER PROJECT REPORT (Pilot Edition)

> Interview-ready · Resume-ready · Pitch-ready · Viva-ready
> Repo: `gurusaiss/Skill-AI` · Stack: React 18 + Vite · Express.js (ESM) · Supabase (PostgreSQL) · Groq/Gemini LLMs

---

## 1. Executive Project Overview

| Field | Details |
| --- | --- |
| Project Name | **SkillForge** — AI-powered enterprise talent assessment & upskilling platform |
| Problem Solved | Enterprises can't scale skill assessment/upskilling — manual, generic, disconnected from real job requirements |
| One-Line Elevator Pitch | Autonomous AI that converts a company's own JDs & process documents into role-specific assessments, skill diagnostics, and personalized learning paths — zero manual configuration |
| Target Users | Enterprise HR/L&D teams, admins, managers, employees (B2B multi-company) |
| Main Goal | Replace human-in-the-loop assessment building with document-grounded agentic generation |
| Key Innovation | Document-grounded question generation: every question traces to uploaded company content (not generic question banks) |
| Business Value | Weeks of assessment authoring → minutes; assessments reflect actual company processes; compounding data advantage |
| Technical Complexity | Multi-agent LLM orchestration, chunked document pipelines, dual-write persistence, multi-tenant RBAC, real-time SSE/sockets |
| Unique Selling Points | (1) Doc-grounded generation with validation filter (2) 9-agent autonomous pipeline (3) enterprise-native RBAC from day one (4) per-file generation controls (counts, stakeholder, process-delivery toggles) |

### 30-second interview explanation
"SkillForge is a B2B talent-assessment platform. Admins upload job descriptions and process documents; a multi-agent LLM pipeline generates role-specific assessments grounded strictly in those documents, diagnoses each employee's skill gaps, and builds personalized learning paths. I built the full stack — React frontend, Express backend, Supabase persistence, JWT/RBAC auth, and the LLM generation pipeline with dedup, grounding validation, and chunking for large documents."

### 2-minute detailed explanation
"The core problem: enterprise assessments are generic and manual. SkillForge fixes this with a document-grounded pipeline. Admins upload JDs and SOPs (PDF/DOCX/PPTX/XLSX/ZIP — parsed in-memory with pdf-parse, mammoth, adm-zip). Text is preprocessed to strip headers/footers/metadata, and JDs are section-filtered to keep only responsibilities and skills. Each file gets its own question count and toggles (Stakeholder, Process Delivery). Generation uses Groq's llama-3.3-70b as primary with Gemini 2.0 Flash fallback; large documents are chunked at 80k chars with overlap so every section contributes. A grounding filter rejects any LLM output with zero document vocabulary; multi-layer dedup enforces unique questions/options/answers; deterministic fallback templates guarantee exact counts. Around this sits a full enterprise platform: JWT auth with rotating refresh tokens, four-role RBAC, multi-company scoping, Socket.io realtime, rate limiting, and a 9-agent autonomous learning pipeline (goal decomposition → diagnostics → curriculum → adaptation → market simulation). Deployed on Render (API) + Vercel (frontend) with cold-start resilient clients."

### Non-technical explanation (HR/Recruiter)
"Companies waste weeks writing tests for hiring and training, and the tests are usually generic. SkillForge reads a company's own job descriptions and process manuals and automatically writes accurate tests from them, then figures out what each employee needs to learn and builds them a plan. I built the whole product end-to-end."

---

## 2. Project Timeline & Development Journey

| Phase | What Was Built | Changes Made | Reason |
| --- | --- | --- | --- |
| 1. MVP / Hackathon core | React+Vite SPA, Express API, learning dashboard, AI tutor, diagnostic quiz, demo mode (SSE) | Initial build | Hackathon foundation |
| 2. Agentic layer | 9-agent pipeline (Goal, Decompose, Diagnostic, Scoring, Curriculum, Evaluator, Adaptor, Market, Simulation), ReactChain, SmartAgent | Agent orchestration + Agent Control Room UI | Autonomous learning path generation |
| 3. Enterprise auth | JWT (24h access) + 30-day rotating refresh, OTP verify, Google OAuth, forced password change, token blocklist | Replaced simple auth | Multi-company enterprise readiness |
| 4. RBAC & multi-tenancy | superadmin/admin/manager/employee roles, company scoping, ProtectedRoute + requireRole | Route guards both ends | Enterprise pilot requirement |
| 5. Role Library | Role CRUD, JD upload/parse, bulk CSV/XLS import, question bank per role | Per-file architecture: `jdFiles[]` + `supportingFiles[]` JSONB | Assessments per job role |
| 6. Question generation v1 | `generateQuestionsFromJD` — LLM with retry + fallback templates | Escalating buffer retries, difficulty rebalancing | Guarantee exact counts |
| 7. Count-loss bug fix | Fixed 41/50 generation bug | Removed cross-difficulty borrowing; round-robin interleave | Borrowing corrupted counts + difficulty labels |
| 8. Doc-grounded generation v2 | `generateQuestionsFromDocument` + `generateQuestionsFromFiles` (per-file) | Document-focused prompts, per-file counts, source tagging | Questions ignored uploaded process docs |
| 9. Root-cause overhaul (RC1–RC5) | Grounding filter, banned-phrase prompts, doc-keyword fallbacks | Killed generic "stakeholder management" questions permanently | Pilot user complaint: irrelevant questions |
| 10. Storage optimization | Structured text extraction (mammoth HTML→structured), text-only storage, removed ALL truncation caps | 80k-char chunked generation with 1.5k overlap | "All text of any file must be saved" |
| 11. Security hardening | Auth on tutor/react/agent-control endpoints, auth headers in stray fetches | Pilot audit fixes | Unauthenticated LLM endpoints = quota abuse vector |
| 12. Quality overhaul | textPreprocessor.js (metadata strip, JD section extraction, filename removal), Process Delivery toggle, concise answers, count-input fix | Prompt bans heading/metadata questions | Headers/footers/filenames were becoming questions |
| 13. UX polish | Delete buttons on documents in View modal, stakeholder toggle full labels, docs/ consolidation | Additive endpoint `DELETE /:id/documents/:fileId` | Pilot usability feedback |

---

## 3. Architecture & Technical Design

### High-Level Architecture
- **Frontend**: React 18 + Vite SPA, TailwindCSS, framer-motion, lazy-loaded routes, ErrorBoundary at root
- **Backend**: Express.js (ESM, `"type":"module"`), modular routers per domain
- **Database**: Supabase (PostgreSQL, JSONB columns) + JSON-file fallback via dual-write `DataStore`
- **APIs**: REST (`/api/*`), consistent `{success, data, error}` envelope
- **Auth**: JWT access (24h) + rotating refresh (30d), in-memory blocklist + refresh store, OTP, Google OAuth
- **LLM layer**: Groq `llama-3.3-70b-versatile` (primary), Gemini `gemini-2.0-flash` (fallback), Groq `llama-3.1-8b-instant` for cheap tutor chat; `LLMCache` for dedup
- **Realtime**: Socket.io with JWT-authenticated rooms; SSE for judge demo streaming
- **File processing**: multer memoryStorage (10MB cap) → pdf-parse / mammoth / adm-zip (PPTX) / xlsx → text only stored (no file blobs)
- **Deployment**: Render (backend, free tier + self-ping keep-alive), Vercel (frontend, `VITE_API_URL`)

### Data Flow
`Admin uploads doc → multer (in-memory) → extractTextFromBuffer → textPreprocessor (strip metadata / JD section filter) → stored as text in role JSONB → generateQuestionsFromFiles → per-file chunked LLM calls (Groq→Gemini) → grounding filter → dedup → fallback padding → validateQuestionBank → question bank saved → employee takes assessment → scoring → skill gap diagnosis → curriculum agents → personalized plan`

### Component Breakdown

| Component | Purpose | Tech Used |
| --- | --- | --- |
| `AssessmentGenerator.js` | All question generation, dedup, validation, fallback | Node, Groq/Gemini fetch, custom Jaccard dedup |
| `textPreprocessor.js` | Strip headers/footers/metadata; JD section extraction | Regex pattern banks, section heuristics |
| `roles.js` router | Role Library CRUD, parse-jd, regen, doc delete | Express, multer, adm-zip, mammoth, pdf-parse |
| `DataStore.js` | Dual-write Supabase + JSON fallback | Supabase JS client, fs |
| `AuthContext.jsx` | Token lifecycle, refresh dedup, cold-start retry | React Context, localStorage |
| `RoleLibrary.jsx` | Role UI: FileRow, ViewModal, QuestionBankModal | React, Tailwind |
| Agent suite | Autonomous learning pipeline | 9 specialized agent modules + ReactChain |
| `middleware/auth.js` | authenticate / requireRole / requireSuperAdmin | JWT verify + blocklist check |

### Why these technologies (+tradeoffs)
- **React+Vite**: fast HMR, ESM-native; tradeoff: SPA SEO (irrelevant for B2B app)
- **Express**: minimal, full control; alternative NestJS rejected (hackathon velocity)
- **Supabase**: managed Postgres + instant API; JSON fallback covers outages/local dev; tradeoff: JSONB files array vs normalized tables (chose JSONB for schema agility, per constraint "never alter tables, only add")
- **Groq primary**: near-free, extremely fast 70B inference; Gemini fallback for availability; tradeoff: no fine-tuning, mitigated with heavy prompt engineering + output validation
- **In-memory token stores**: simplicity for pilot; known limitation → Redis for production
- **multer memoryStorage**: no disk writes on Render's ephemeral FS; tradeoff: 10MB cap

---

## 4. Features Deep Dive

| Feature | Purpose | How It Works | Tech | Complexity |
| --- | --- | --- | --- | --- |
| ⭐ Role Library | Central role/JD management | CRUD + per-file JSONB storage + bulk CSV/XLS import | Express, Supabase | Medium |
| 🚀 Doc-grounded question generation | Questions from actual company docs | Per-file chunked LLM calls + grounding filter + dedup + exact-count guarantee | Groq/Gemini, custom pipeline | **High** |
| 🚀 Multi-format text extraction | Any file type → clean text | pdf-parse, mammoth (DOCX→HTML→structured), adm-zip slide XML parsing, xlsx→CSV, recursive ZIP | Node parsers | High |
| 🔥 Text preprocessing | Kill metadata-derived questions | Regex banks strip headers/footers/authors/versions; JD section include/exclude heuristics with fail-safe | Custom regex engine | Medium |
| 🔥 Per-file generation controls | Fine-grained admin control | questionCount + Stakeholder toggle + Process Delivery toggle per file, persisted, respected on regen | React + prompt directives | Medium |
| ⭐ Question bank management | Review/edit/regenerate | QuestionBankModal: edit (marks isManual), delete, add, regen all vs AI-only (preserves manual) | React | Medium |
| 🔥 Zero-duplicate enforcement | Assessment integrity | 70% token-overlap Jaccard dedup + option-set keys + answer keys, validated pre-save | Custom algorithms | Medium |
| 🚀 9-agent autonomous pipeline | Personalized learning | Goal→Decompose→Diagnostic→Scoring→Curriculum→Evaluator→Adaptor→Market→Simulation | Custom agent framework | **High** |
| ⭐ Enterprise auth | Secure multi-tenant access | JWT + rotating refresh + OTP + OAuth + forced password change + blocklist | jsonwebtoken, bcrypt | Medium-High |
| ⭐ RBAC | 4-role access control | Frontend ProtectedRoute + backend requireRole, superadmin bypass, company scoping | Middleware both ends | Medium |
| 🔥 Judge demo mode | Live agentic showcase | SSE streams each agent step in real-time | Server-Sent Events | Medium |
| ⭐ AI Tutor | Learning assistant | Groq 8B fast model + rule-based fallback + 2-min LLM cache | Groq, LLMCache | Low-Medium |
| ⭐ Cold-start resilience | Render free tier UX | Client retries (4x backoff) on init; fetchWithRetry; self-ping keep-alive | Client-side retry logic | Low |

---

## 5. Complete Issue / Debugging / Problem-Solving Report

| # | Issue | Symptoms | Root Cause | Found By | Solution | Prevention | Interview Talking Point |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Generic questions** (biggest) | "What is the purpose of a process?" instead of doc content | 5 stacked causes (RC1–5 below) | Pilot user complaint → systematic audit | Multi-layer fix (below) | Grounding filter as permanent guard | ⭐ Best debugging story — see STAR bank |
| 1a | RC-1: generic fallback default | Fallback questions about "stakeholder communication" | Hardcoded default skills array `['core responsibilities','stakeholder communication',…]` | Code audit | Replaced with doc-keyword extraction | Never hardcode topic defaults | "The bug wasn't in the LLM — it was in our own fallback path" |
| 1b | RC-2: cross-file padding used role skills | Padding questions unrelated to document | Padding pulled `srcSkills` (often empty→RC-1) | Traced padding path | Use `extractDocKeywords(text,12)` | Keyword-grounded padding | Layered fallbacks can silently reintroduce bugs |
| 1c | RC-3: text truncation | Only first 40k chars generated questions | `text.slice(0,40000)` + 8k supporting cap + 12k JD cap + 10k DOC cap | Grep for `.slice(` across pipeline | 80k-char chunking w/ 1.5k overlap at paragraph boundaries, proportional per-chunk targets | No arbitrary caps; chunk instead | "Truncation was hiding in 4 different files" |
| 1d | RC-4: no output validation | Plausible-but-generic LLM output accepted | Trust-the-LLM design | Reasoned about failure mode | `filterDocumentGrounded`: reject questions sharing zero of top-50 doc keywords | Always validate LLM output programmatically | Defense-in-depth for LLM pipelines |
| 1e | RC-5: vague prompts | LLM drifted to corporate tropes | "Generate relevant questions" too soft | Prompt iteration | Explicit STRICTLY BANNED phrase list + mandatory pre-generation extraction steps + self-check | Name failure modes explicitly in prompts | Negative constraints > positive vibes |
| 2 | **41/50 count loss + difficulty corruption** | 50 requested, 41 saved; hard questions labeled easy | Cross-difficulty "borrowing" dropped questions when donors couldn't spare & relabeled difficulty | Count mismatch in saved bank | Removed borrowing entirely; round-robin interleave preserving labels; `validateQuestionBank` gate before save | Validation gate blocks bad saves | Two bugs, one root cause |
| 3 | **Headers/footers/filenames became questions** | Questions about author names, versions, "Invoice_Process.pdf" | Raw extracted text stored verbatim; parsers include metadata | Pilot doc review | `textPreprocessor.js`: 18 metadata regex patterns, JD section filter, `removeFilenameFromText`; prompt rules ban metadata | Preprocess at ingestion, ban at prompt, filter at output | Three-layer defense |
| 4 | **Question count input uneditable** | Backspace instantly reverted to 1 | `onChange` did `Math.max(1, parseInt(val)||1)` per keystroke → empty string→NaN→1 | User bug report | Raw string during editing; clamp on `onBlur` only | Validate on blur, not keystroke | Classic controlled-input trap |
| 5 | **Unauthenticated LLM endpoints** | `/api/tutor/chat`, `/api/react/run`, `/api/agent-control/stats` public | Hackathon speed, never revisited | Pilot security audit | Added `authenticate` middleware; fixed 2 frontend fetches missing Authorization headers | Audit checklist pre-pilot | Security debt compounds silently |
| 6 | **Blank screen during generation** | Question bank empty after role create | Async background generation; UI didn't wait | User report | 3s polling × 20 attempts in QuestionBankModal + "generating" state | Poll or socket-notify async jobs | Async UX needs explicit states |
| 7 | **Render cold-start logouts** | Users bounced to login after idle | 30s cold start → /me timeout → token cleared | Prod observation | 4-retry backoff on init; NEVER clear token on network error (only definitive 401/403); refresh-then-retry on 401 | Distinguish network vs auth failures | Free-tier resilience engineering |
| 8 | **Duplicate options/answers across questions** | Different questions, identical MCQ option sets | LLM template reuse; dedup only checked question text | Bank review | Option-set keys + fill/subjective answer keys added to dedup + validator | Dedup every uniqueness dimension | Uniqueness is multi-dimensional |
| 9 | **PPTX extraction empty on Windows** | Zero text from PPTX | adm-zip uses backslash entry names on Windows; regex expected `/` | Local testing | Normalize entry names before matching; notes-slide fallback | Normalize paths cross-OS | Platform-specific parsing bug |
| 10 | **Fuzzy dedup killed valid fallbacks** | Fallback padding couldn't reach count | Template questions share ~all tokens by design → 70% overlap flagged | Padding loop starvation | Separate `mergeFallbackUnique` (exact-match) for template path; uniqueness via combo index | Match dedup strategy to content type | One dedup doesn't fit all |
| 11 | **Subjective answers too long** | Essay-length model answers, hard to evaluate | No format constraint in prompt | Pilot feedback | Prompt-enforced 2–3 bullets ≤20 words; fill_blank 2–5 words | Output format contracts in prompts | LLM verbosity needs hard constraints |
| 12 | **Regen lost manual edits** | Admin-edited questions wiped on regenerate | Full-replace regen | User expectation | `isManual` flag + 'ai-only' regen mode preserving manual questions | Tag provenance of every record | Data provenance saves users |

---

## 6. Technical Decision Log

| Decision | Why | Alternatives | Tradeoffs |
| --- | --- | --- | --- |
| Groq primary / Gemini fallback | Speed + near-zero cost + availability redundancy | OpenAI, Claude API | No fine-tuning; mitigated via prompts+validation |
| Per-file generation (not merged corpus) | Exact per-file counts, source traceability, toggle isolation | Single merged prompt | More LLM calls; bounded by per-file counts |
| Chunking (80k/1.5k overlap) over truncation | Every section contributes | Truncate / embeddings-RAG | More calls for big docs; RAG deferred (complexity) |
| Text-only storage (no file blobs) | Render ephemeral FS; storage cost; text is what LLM needs | S3 blob storage | Visual/diagram content lost (known gap) |
| JSONB file arrays in role row | Schema agility; constraint: never alter tables | Normalized `role_files` table | Row size growth; acceptable at pilot scale |
| Dual-write DataStore (Supabase+JSON) | Survive outages, zero-config local dev | Supabase only | Consistency risk; JSON is fallback-only |
| JWT + rotating refresh | Stateless scale + revocation window | Server sessions | Blocklist needed for logout; in-memory for now |
| Validate-then-save gate | Never persist a broken bank | Fix-after-save | Regen latency; correctness wins |
| Deterministic fallback templates | Guarantee exact count always | Fail request on LLM shortage | Template questions weaker; keyword-grounded to compensate |
| Frontend+backend role guards (both) | Defense in depth | Backend only | Duplication; UX + security both served |

---

## 7. Optimization & Performance Improvements

| Optimization | Problem | Applied | Result |
| --- | --- | --- | --- |
| LLM cache (tutor) | Rapid-fire duplicate questions burned quota | 2-min hash cache on message+context | Duplicate calls → free |
| Cheap model routing | 70B for trivial tutor chat wasteful | `generateTextFast` → llama-3.1-8b-instant | ~10x cheaper tutor |
| History trimming | Token bloat in chat | Last 3 turns instead of 5 | ~20% token save |
| Escalating retry buffer | Repeated full-size LLM asks | Ask for `needed × (1.4 + 0.3·attempt)` | Fewer retry rounds |
| Route lazy loading | Big initial bundle | React.lazy per page + Suspense | Faster first paint |
| Structured DOCX extraction | mammoth raw text lost tables/lists | convertToHtml → structured text | Better generation grounding |
| Storage optimization | File blobs bloated storage | Text-only persistence | Minimal DB footprint |
| Refresh dedup | Concurrent 401s → refresh stampede | Module-level `_refreshPromise` singleton | One refresh per burst |
| Proportional chunk targets | Uneven question coverage on big docs | Target ∝ chunk length ×1.4 buffer | Even full-document coverage |

---

## 8. Security, Scalability & Production Readiness

### Security Measures
- **AuthN**: bcrypt hashing, JWT 24h access, 30-day rotating refresh, OTP verification, Google OAuth, forced password change on first login, timing-safe login failure handling, account lockout
- **AuthZ**: `authenticate` → `requireRole(...)` → `requireSuperAdmin` middleware chain; company-scoped queries; superadmin bypass; X-Active-Role support
- **Rate limiting**: global 300/min, LLM routes 10/min, login 10/15min, OTP 3/hr
- **Token revocation**: logout blocklists JWT + revokes refresh token
- **Input validation**: multer 10MB cap, extension whitelist, payload validation, JSON envelope errors
- **Secrets**: env vars only (GROQ_API_KEY, GEMINI_API_KEY, JWT secrets, Supabase keys) — never committed; `supabaseinfo.*` gitignored
- **Pilot audit**: closed unauthenticated LLM endpoints; verified every admin route guarded

### Scalability Design
- **10 users (now)**: single Render instance + Supabase — fine
- **1,000 users**: move blocklist/refresh store to Redis; upgrade Render tier (kill cold starts); job queue (BullMQ) for generation; Supabase connection pooling
- **1M users**: horizontal API replicas behind LB (JWT already stateless); normalize JSONB files to tables + read replicas; queue workers for LLM pipeline; CDN for SPA; per-tenant rate limits; observability (Sentry+metrics)

### Production Improvements Needed
Redis-backed token stores · job queue for generation · Sentry/error tracking · e2e tests (Playwright) · SOC2-track logging · S3 for visual-content originals · embeddings-based grounding (upgrade keyword filter)

---

## 9. Deployment & DevOps Summary

| Area | Details |
| --- | --- |
| Hosting | Backend: Render (free tier) · Frontend: Vercel |
| Deployment Process | Git push → auto-deploy both platforms |
| Environment Setup | `VITE_API_URL` (Vercel) → Render URL; API keys/JWT secrets in Render env |
| Docker | Not used (PaaS-native); same-origin fallback supports Docker/Railway |
| CI/CD | Platform auto-deploy on push to `main`; no separate pipeline |
| Monitoring | Render logs + console; self-ping keep-alive |
| Logging | Structured console logging with route/service prefixes `[tag]` |
| Rollback | Git revert + redeploy; Render deploy history |

**Deployment challenges fixed**: cold-start logout bug (retry/backoff, never-clear-on-network-error), CORS/base-URL env layering (`VITE_API_URL` → PROD same-origin → localhost:3001), ephemeral filesystem (drove text-only + memoryStorage design).

---

## 10. Codebase Understanding Guide

### Folder Structure
```
HACKap/
├─ client/src/
│  ├─ pages/ (Landing, Dashboard, Assessment, Diagnostic, Profiling, admin/[RoleLibrary, AdminDashboard, UserManagement…], superadmin/)
│  ├─ components/ (ProtectedRoute, ErrorBoundary, DailyBrief, Navbar…)
│  ├─ contexts/ (AuthContext, NotificationContext)
│  └─ utils/ (api.js, authFetch.js)
├─ server/
│  ├─ routes/ (auth, roles, users, assessment, tutor, react, demo, diagnostic, superadmin, agentcontrol…)
│  ├─ services/ (AssessmentGenerator, DataStore, UserStore, GeminiService, LLMCache, AuthService)
│  ├─ agent/ (SmartAgent, ReactChain, MarketAgent, SimulationAgent + agents)
│  ├─ middleware/auth.js · security/ (tokenBlocklist, refreshTokenStore) · utils/ (parseJDFile, textPreprocessor)
│  └─ index.js
└─ docs/ (all reports/guides/presentations)
```

### Important Functions
| Function | File | Role |
| --- | --- | --- |
| `generateQuestionsFromFiles` | AssessmentGenerator.js | Per-file orchestrator, cross-file dedup, source tagging |
| `generateQuestionsFromDocument` | AssessmentGenerator.js | Chunking + LLM attempts + grounding + fallback |
| `filterDocumentGrounded` | AssessmentGenerator.js | Rejects zero-doc-vocabulary questions |
| `deduplicateQuestions` / `validateQuestionBank` | AssessmentGenerator.js | 70% Jaccard + option/answer keys; pre-save gate |
| `preprocessDocumentText` / `extractJDCoreContent` | textPreprocessor.js | Metadata strip; JD section filter |
| `extractTextFromBuffer` | roles.js | Multi-format extraction dispatcher |
| `buildFileSources` | roles.js | Role → generation source objects |
| `refreshAccessToken` (deduped) | AuthContext.jsx | Silent refresh, single-flight |

### Key APIs
`POST /api/auth/login|register|refresh|logout|verify-otp` · `GET/POST/PUT/DELETE /api/roles[/:id]` · `POST /api/roles/parse-jd?type=jd` · `POST /api/roles/:id/regenerate-questions` · `PUT /api/roles/:id/document-text` · `DELETE /api/roles/:id/documents/:fileId` · `GET/PUT /api/roles/:id/questions` · `POST /api/tutor/chat` (auth) · `POST /api/react/run` (auth) · `GET /api/demo/run` (public SSE)

### Data Shape (role)
`{id, companyId, roleName, department, skills[], jobDescription, jdFiles[{id,name,text,chars,questionCount,stakeholder,processDelivery,ext,uploadedBy,uploadedAt}], supportingFiles[...same], questionBank[{id,type,question,options,answer,difficulty,explanation,skillArea,sourceFile,sourceSection,isManual}], status, updatedAt}`

### Env Vars
`GROQ_API_KEY · GEMINI_API_KEY · GEMINI_MODEL · JWT secrets · SUPABASE_URL/KEY · VITE_API_URL`

### Run Locally
`cd server && npm i && npm start` (:3001) · `cd client && npm i && npm run dev` (Vite; API base falls back to localhost:3001)

---

## 11. Interview Preparation Pack — Top 25 Questions

1. **Q: Walk me through your architecture.** A: SPA (React/Vite) → REST Express API → Supabase Postgres with JSON fallback; JWT+RBAC; LLM layer (Groq primary/Gemini fallback) for generation; agents for learning paths. **Follow-up: why REST not GraphQL?** A: CRUD-shaped domain, small team, simpler caching/rate-limiting per route; GraphQL adds schema overhead without query-flexibility need.
2. **Q: How do you make LLM output reliable?** A: Layered: strict prompts with banned phrases + mandatory extraction steps → grounding filter (doc-keyword intersection) → multi-dimension dedup → validator gate before save → deterministic fallback for count guarantees. **Follow-up: filter false positives?** A: Skips validation when <5 unique keywords (short docs); keyword set is top-50 frequency terms so legit questions nearly always intersect.
3. **Q: Biggest bug?** A: Generic-questions bug — 5 stacked root causes (hardcoded fallback topics, skills-based padding, hidden truncations in 4 files, no output validation, vague prompts). Fixed all five; the filter is the permanent guard. **Follow-up: why so many causes?** A: Fallback layers masked each other — each fix exposed the next layer.
4. **Q: How do you handle large documents?** A: 80k-char chunks, 1.5k overlap, paragraph-boundary splitting, per-chunk question targets proportional to length ×1.4 buffer. **Follow-up: why not RAG/embeddings?** A: Full coverage was the requirement (every section must contribute), not retrieval; embeddings planned for grounding-v2.
5. **Q: Exact question counts — how guaranteed?** A: LLM attempts with escalating ask-buffer → dedup → template fallback with combinatorial (skill×template) uniqueness → trim → validate. Count can never be short.
6. **Q: Dedup approach?** A: Jaccard token overlap >70% on question text + normalized option-set keys + answer keys; exact-match variant for templates (fuzzy would false-positive on shared template tokens).
7. **Q: Auth design?** A: 24h JWT + 30d rotating refresh, single-flight refresh dedup on client, blocklist on logout, OTP + OAuth + forced password change. **Follow-up: refresh token theft?** A: Rotation invalidates old token on use; reuse detection is the next hardening step.
8. **Q: Why Groq?** A: Fastest 70B inference available, effectively free tier, JSON mode; Gemini fallback covers outages. Model choice is one function — swappable.
9. **Q: Multi-tenancy?** A: companyId scoping on every query, role-based middleware, superadmin cross-company. Row-level security in Supabase is the production upgrade.
10. **Q: Cold-start handling?** A: Client init retries 4× with backoff; never clears tokens on network errors (only definitive 401/403); fetchWithRetry wrapper; server self-ping.
11. **Q: How would you scale generation?** A: Queue (BullMQ) + workers, job status via socket/polling (polling already built), horizontal API replicas (stateless JWT), Redis token stores.
12. **Q: File parsing edge cases?** A: PPTX backslash entry names on Windows (normalize), notes-slide fallback, recursive ZIP extraction, DOCX mammoth→OOXML-regex fallback chain.
13. **Q: Why store text, not files?** A: Render ephemeral FS + storage cost + text is the generation input; tradeoff: visual content (diagrams) is a known gap → S3 planned.
14. **Q: State management without Redux?** A: Context (auth/notifications) + local state; server is source of truth; no complex shared client state to justify Redux.
15. **Q: How do toggles affect generation?** A: Per-file booleans → prompt directives (ENABLED allows doc-grounded stakeholder/SLA questions; DISABLED bans category outright); persisted, respected on regen.
16. **Q: Prompt engineering lessons?** A: Negative constraints (banned phrases) beat positive instruction; force pre-generation extraction steps; self-check checklist in prompt; output format contracts (2–5 word fill-blanks, 2–3 bullet subjectives).
17. **Q: Difficulty distribution?** A: 35/45/20 easy/medium/hard planned in-prompt, tier-assigned scenarios (no reuse across tiers), round-robin interleave, validator warns at >20% drift.
18. **Q: What breaks at 1M users?** A: In-memory token stores (Redis), single instance (replicas), JSONB row growth (normalize), synchronous generation (queue), free-tier LLM quotas (paid + batching).
19. **Q: Security audit findings?** A: Unauthenticated LLM endpoints (quota abuse) — added auth middleware + fixed frontend fetches missing headers; verified all admin routes guarded both ends.
20. **Q: Testing strategy?** A: Validator acts as generation contract test; manual pilot testing; honest gap: automated e2e is the top backlog item.
21. **Q: Regeneration semantics?** A: 'all' replaces everything; 'ai-only' preserves `isManual` questions and fills remaining slots — provenance tagging makes this possible.
22. **Q: Why dual-write DataStore?** A: Supabase primary; JSON fallback keeps app alive during outages and enables zero-config local dev. Fallback is ephemeral on Render — documented limitation.
23. **Q: Hardest tradeoff?** A: Deterministic fallback templates: guarantee counts but weaker than LLM output — mitigated by doc-keyword grounding; alternative (failing the request) worse for UX.
24. **Q: How is a question traceable?** A: `sourceFile` + `sourceSection` + `explanation` (which doc rule it tests) + `skillArea` — full provenance chain for audit/debug.
25. **Q: What did you build vs. libraries?** A: Built: generation pipeline, dedup/validation, preprocessor, agent orchestration, dual-write store. Libraries: parsing (pdf-parse/mammoth/adm-zip/xlsx), auth primitives (jsonwebtoken/bcrypt), UI (React/Tailwind).

---

## 12. Resume / Portfolio / LinkedIn Content

### Resume Bullets
- Built **SkillForge**, a multi-tenant AI talent-assessment platform (React 18, Express, Supabase, Groq/Gemini LLMs) generating document-grounded assessments from enterprise JDs & SOPs; deployed to an active enterprise pilot
- Engineered an LLM pipeline with 80k-char chunked generation, keyword-grounding validation, multi-dimensional deduplication, and deterministic fallbacks — guaranteeing exact question counts and zero duplicates
- Diagnosed and eliminated a 5-root-cause "generic output" defect across prompt, fallback, truncation, and validation layers; instituted an output-validation gate preventing regression
- Implemented enterprise auth: rotating refresh tokens, single-flight client refresh, OTP, OAuth, RBAC (4 roles), route-level rate limiting; closed unauthenticated LLM endpoints in a pre-pilot security audit
- Designed multi-format ingestion (PDF/DOCX/PPTX/XLSX/ZIP) with metadata-stripping preprocessing that prevented headers/footers/filenames from contaminating generated assessments

### ATS Description
Full-stack AI platform: React 18, Vite, TailwindCSS, Node.js, Express, PostgreSQL (Supabase), JWT, OAuth2, REST APIs, LLM integration (Groq Llama 3.3 70B, Google Gemini), prompt engineering, multi-agent systems, Socket.io, SSE, rate limiting, RBAC, multi-tenancy, Render, Vercel, Git/GitHub.

### LinkedIn
SkillForge — an AI platform that turns a company's own job descriptions and process documents into role-specific assessments and personalized learning paths. Built the complete product: document ingestion for 6+ formats, a chunked LLM generation pipeline with grounding validation and duplicate elimination, a 9-agent autonomous learning system, and enterprise-grade auth/RBAC. Now in enterprise pilot.

### One-line Impact
Cut enterprise assessment authoring from weeks to minutes with a document-grounded LLM pipeline that guarantees relevance, uniqueness, and exact counts.

---

## 13. Lessons Learned

| Learning | Context | Impact |
| --- | --- | --- |
| LLM output must be validated, never trusted | Generic-questions bug | Grounding filter now permanent |
| Fallback layers hide bugs behind each other | 5 stacked root causes | Audit the whole path, not the first suspect |
| Validate inputs on blur, not per keystroke | Count input bug | Reusable controlled-input pattern |
| Network error ≠ auth failure | Cold-start logouts | Token-handling discipline |
| Negative prompt constraints outperform positive ones | Banned-phrase list | Core prompt-engineering method |
| Match dedup strategy to content type | Fuzzy dedup starved templates | Exact-match path for templates |
| Provenance tags unlock features | isManual → ai-only regen | Tag data origin from day one |
| Security debt from hackathon speed is real | Open LLM endpoints | Pre-pilot audit checklist |
| Cross-OS path handling in parsers | PPTX Windows backslashes | Normalize early |
| Preprocess at ingestion beats cleanup at output | Metadata-derived questions | Three-layer defense design |

---

## 14. Future Improvements

**Immediate**: Redis token stores · generation job queue · Sentry · Playwright e2e · reuse-detection on refresh tokens
**Advanced**: embeddings-based grounding (semantic, not keyword) · image/diagram understanding (store visuals, multimodal LLM) · assessment analytics dashboard · adaptive difficulty (IRT)
**Production-grade**: Supabase RLS · SOC2-track audit logging · SSO/SAML · on-prem deployment option · API versioning
**Scale-up vision**: skill-graph across all tenant assessments (compounding data moat) · marketplace of role templates · integration connectors (Workday/SAP)

---

## 15. Final Ultra-Compressed Revision Sheet (read in 5–10 min)

**Pitch**: AI platform converting company JDs/SOPs → grounded assessments + personalized learning. B2B, multi-tenant, enterprise pilot live.
**Stack**: React18+Vite+Tailwind · Express (ESM) · Supabase PG (+JSON fallback) · Groq 70B→Gemini fallback · JWT+RBAC · Render+Vercel.
**Architecture**: SPA → REST → dual-write store; per-file chunked LLM generation → grounding filter → dedup → validate → save; 9-agent learning pipeline; Socket.io/SSE realtime.
**Core features**: Role Library (per-file counts + Stakeholder + Process-Delivery toggles) · multi-format ingestion + metadata-strip preprocessing · question bank (edit/regen ai-only preserving manual) · enterprise auth (rotating refresh, OTP, OAuth) · judge demo SSE.
**Biggest bug**: generic questions — 5 root causes (fallback defaults, skills padding, hidden truncations, no validation, vague prompts) → fixed all; grounding filter = permanent guard.
**Other key fixes**: 41/50 count loss (removed cross-difficulty borrowing) · metadata→questions (preprocessor + prompt bans) · count input (validate on blur) · cold-start logouts (retry, never clear on network error) · unauthenticated LLM endpoints (audit).
**Decisions**: Groq for speed/cost + Gemini redundancy · per-file generation for traceability · chunking over truncation/RAG · text-only storage (ephemeral FS) · JSONB agility · validate-then-save.
**Scaling answer**: stateless JWT → replicas; Redis token stores; BullMQ generation workers; normalize JSONB; read replicas; CDN.
**Security answer**: bcrypt+JWT+rotating refresh+blocklist · 4-role RBAC both ends · rate limits (global/LLM/login/OTP) · env secrets · pre-pilot audit closed open endpoints.
**Deployment answer**: Render+Vercel auto-deploy on push; cold-start resilient clients; self-ping; env-layered API base URL.
**Standout stories**: 5-root-cause debugging saga · exact-count guarantee engineering · metadata contamination 3-layer defense · single-flight token refresh.

---
---

# DELIVERABLE 1 — Interview Cheat Sheet

| Topic | Must Remember |
| --- | --- |
| Architecture | SPA → REST Express → Supabase (+JSON fallback); stateless JWT; LLM layer isolated in AssessmentGenerator |
| Generation pipeline | per-file → chunk (80k/1.5k) → Groq→Gemini → grounding filter → dedup (Jaccard 70% + option/answer keys) → fallback templates → trim → validate → save |
| APIs | `/api/roles/*` (CRUD, parse-jd, regenerate-questions, document-text, documents/:fileId DELETE, questions) · `/api/auth/*` · `/api/tutor/chat` · `/api/demo/run` (SSE, public) |
| Database | Supabase PG; roles row holds `jdFiles[]/supportingFiles[]/questionBank[]` as JSONB; dual-write JSON fallback |
| Auth | 24h JWT + 30d rotating refresh; single-flight client refresh; blocklist on logout; OTP; Google OAuth; forced pwd change |
| RBAC | superadmin>admin>manager>employee; ProtectedRoute (FE) + requireRole (BE); companyId scoping |
| Deployment | Render API (free, cold-start mitigations) + Vercel SPA (`VITE_API_URL`); auto-deploy on push |
| Security | rate limits 300/min global, 10/min LLM, 10/15min login, 3/hr OTP; pilot audit closed tutor/react/agent-control endpoints |
| Performance | LLM cache, cheap-model routing (8B tutor), history trim, lazy routes, refresh dedup, proportional chunk targets |
| AI components | Groq llama-3.3-70b (JSON mode) primary; Gemini 2.0-flash fallback; 9 learning agents; ReactChain; SSE demo |
| Biggest challenge | Generic-questions: 5 root causes, fixed at prompt/fallback/truncation/validation layers |
| Toggles | Stakeholder + Process Delivery per file → prompt directives; persisted; respected on regen |

---

# DELIVERABLE 2 — Project Knowledge Base (FAQ)

**Why Express over NestJS/Fastify?** Velocity + full control; no DI framework need at this scale; migration path open since routers are modular.
**Why Supabase over raw Postgres/Mongo?** Managed PG + auth-ready + instant REST; relational fits multi-tenant scoping; Mongo rejected — JSONB gives document flexibility inside a relational core.
**Why Groq over OpenAI?** 10–50x cheaper, fastest 70B inference, JSON mode; redundancy via Gemini. Provider-agnostic function boundaries make swapping trivial.
**Biggest challenge?** Making LLM output trustworthy: solved with layered validation (prompt bans → grounding filter → dedup → validator gate → deterministic fallback).
**Biggest mistake?** Trusting LLM relevance without programmatic validation initially; and letting hackathon endpoints ship without auth — both caught and fixed pre-pilot.
**Biggest learning?** In LLM systems, the guard rails ARE the product. Prompts fail silently; only output validation makes quality durable.
**What would you improve?** Redis token stores, generation job queue, embeddings-based grounding, automated e2e tests.
**How would you scale?** Stateless API replication (JWT), Redis for shared token state, BullMQ workers for generation, JSONB→normalized tables with read replicas, CDN, per-tenant quotas.

---

# DELIVERABLE 3 — Technical Story Bank (STAR)

**1. Biggest bug — Generic questions**
S: Pilot enterprise uploaded process docs; assessments contained generic corporate questions ("What is the purpose of a process?") instead of document content.
T: Find the real cause, fix permanently — no patches.
A: Systematic pipeline audit. Found 5 stacked causes: hardcoded generic fallback topics; padding driven by (empty) role skills; hidden truncation in 4 files (40k/12k/10k/8k caps); zero output validation; vague prompts. Fixed each: doc-keyword fallbacks, 80k chunking with overlap, `filterDocumentGrounded` keyword-intersection filter, banned-phrase prompt list with mandatory extraction steps.
R: Questions verifiably grounded (every question intersects doc vocabulary); filter permanently prevents regression; pilot feedback flipped positive.

**2. Biggest optimization — Exact-count guarantee**
S: 50 requested questions produced 41; hard questions relabeled easy.
T: Guarantee exact counts with correct difficulty labels, always.
A: Root-caused "cross-difficulty borrowing" (donor tiers dropped items + relabeled). Removed borrowing; built escalating-buffer LLM retries, combinatorial template fallback (skill×template index — never duplicates), round-robin difficulty interleave, and a `validateQuestionBank` gate blocking bad saves.
R: Count misses: recurring → zero. Validation gate has blocked every malformed bank since.

**3. Biggest challenge — Metadata contamination**
S: Author names, versions, and even filenames were becoming assessment questions.
T: Ensure only learning content generates questions.
A: Three-layer defense: ingestion preprocessing (18 metadata regex patterns, JD section include/exclude with fail-safe, filename stripping) → prompt-level bans on metadata/headings with content-priority rules → output grounding filter.
R: Metadata questions eliminated; JD questions restricted to responsibilities/skills.

**4. Deployment issue — Cold-start logouts**
S: Render free tier sleeps; returning users were dumped to login.
T: Keep sessions across 30s cold starts.
A: Diagnosed /me timeout being treated as auth failure. Rewrote init: 4 retries with backoff, tokens cleared ONLY on definitive 401/403, silent refresh-then-retry, single-flight refresh promise, fetchWithRetry, server self-ping.
R: Cold-start logouts eliminated with zero infra cost.

**5. Production issue — Open LLM endpoints**
S: Pre-pilot audit found tutor/react/agent-control endpoints unauthenticated — quota-drain vector.
T: Close holes without breaking clients.
A: Added authenticate middleware; traced every frontend caller; found two raw fetches missing Authorization headers and fixed them in the same change.
R: Endpoints secured, zero client breakage — taught me to always patch producer and consumers atomically.

**6. Feature implementation — Per-file generation controls**
S: Admins needed different question counts and question-category rules per uploaded document.
T: Per-file counts + Stakeholder + Process Delivery toggles, persisted and respected on regeneration.
A: Extended file JSONB schema (additive), threaded flags through buildFileSources → generator → prompt directives (ENABLED/DISABLED blocks), built toggle UI in three surfaces, persisted via regen endpoint. Fixed the count input trap (validate on blur, not keystroke).
R: Fine-grained admin control; exact per-file counts honored; toggles verifiably change output categories.

---

# DELIVERABLE 4 — 5-Minute Revision Sheet

**Pitch**: SkillForge — AI turns company JDs/SOPs into grounded assessments + personalized learning paths. B2B multi-tenant. Enterprise pilot live.
**Stack**: React18/Vite/Tailwind · Express ESM · Supabase PG + JSON fallback · Groq→Gemini · JWT/RBAC · Render+Vercel.
**Architecture in one line**: SPA → REST → dual-write store; per-file chunked LLM pipeline with grounding filter, dedup, validator gate, deterministic fallback; 9-agent learning system.
**Features**: Role Library (per-file counts/toggles) · 6-format ingestion + metadata stripping · question bank edit/regen (manual preserved) · enterprise auth · SSE demo mode · AI tutor (cached, cheap model).
**Top bugs→fixes**: generic questions (5 root causes → grounding filter) · 41/50 count loss (killed borrowing → validator) · metadata questions (3-layer defense) · count input (blur validation) · cold-start logout (retry + never-clear-on-network-error) · open endpoints (auth audit).
**Metrics-ish**: exact counts guaranteed 100%; dup rate → 0 (validator-enforced); tutor cost ~10x down (8B routing + cache); assessment authoring weeks→minutes.
**Scaling**: JWT stateless → replicas · Redis tokens · BullMQ generation workers · JSONB→tables + replicas · CDN.
**Security**: bcrypt/JWT/rotating refresh/blocklist · 4-role RBAC both ends · rate limits · env secrets · pre-pilot audit.
**Top 3 questions to expect**: "How do you trust LLM output?" (layered validation) · "Biggest bug?" (5-root-cause saga) · "Scale to 1M?" (above).

---

# DELIVERABLE 5 — Knowledge Gap Detection

| Area | Likely Weakness | Study Before Interview | Priority |
| --- | --- | --- | --- |
| JWT internals | Signing algs (HS256 vs RS256), claim structure | jwt.io intro + why rotate refresh tokens | HIGH |
| Postgres/JSONB | Indexing JSONB, when to normalize | GIN indexes, JSONB operators | HIGH |
| Redis | Claimed as scaling answer but not implemented | Redis for sessions/blocklists, TTL patterns | HIGH |
| Message queues | BullMQ named but unused | Queue basics: jobs, workers, retries, idempotency | MEDIUM |
| Embeddings/RAG | Mentioned as future grounding | Cosine similarity, chunk-embed-retrieve flow | MEDIUM |
| Socket.io internals | Used but thin knowledge | Rooms, JWT handshake auth, fallbacks | MEDIUM |
| Testing | No automated tests in project | Jest/Playwright basics; how you'd test the generator | HIGH |
| Docker/K8s | Not used (PaaS) | Dockerfile basics, why containers | LOW-MED |
| IRT/psychometrics | Adaptive difficulty roadmap item | One-paragraph IRT concept | LOW |
| SQL joins/queries | JSONB hid raw SQL practice | Joins, indexes, EXPLAIN | MEDIUM |

---

# DELIVERABLE 6 — Confidence Rating

| Module | Score | Reason |
| --- | --- | --- |
| Question generation pipeline | 9/10 | Deep repeated iteration; own the design end-to-end |
| Text extraction/preprocessing | 9/10 | Built format handlers + preprocessor personally |
| Auth flow (client+server) | 8/10 | Full lifecycle understood; refresh internals worth rehearsing |
| RBAC/multi-tenancy | 8/10 | Clear model; review superadmin bypass edge cases |
| Role Library UI | 8/10 | Built every modal; know state flows |
| Prompt engineering | 9/10 | Battle-tested banned-phrase/self-check patterns |
| Agent pipeline (9 agents) | 6/10 | ⚠️ RISKY: orchestration understood, per-agent internals shallow — rehearse 2–3 agents deeply |
| Supabase/DataStore | 7/10 | Dual-write clear; raw SQL/indexing shallow |
| Socket.io/SSE | 6/10 | ⚠️ Works, but internals thin |
| Deployment/DevOps | 7/10 | Render/Vercel practical; no Docker/CI depth |
| Rate limiting/security middleware | 8/10 | Configured and audited personally |
| Testing | 4/10 | ⚠️ HIGHEST RISK — prepare the "validator-as-contract + honest gap + plan" answer |

---

# DELIVERABLE 7 — Mock Interview

## HR (20)
1. Tell me about yourself → Full-stack engineer; built an AI enterprise assessment platform end-to-end, now in pilot.
2. Why this project? → Real pain (generic assessments) + chance to engineer trustworthy LLM systems.
3. Proudest moment? → 5-root-cause debugging saga ending in a permanent validation guard.
4. A failure? → Shipped unvalidated LLM output initially; learned validation-first design.
5. Handling criticism? → Pilot feedback ("questions irrelevant") → treated as data → systematic audit.
6. Deadline pressure? → Hackathon → pilot pipeline; scoped ruthlessly, additive-only changes.
7. Conflict resolution? → Constraint conflicts (exact counts vs LLM variance) resolved with layered engineering, not compromise.
8. Strength? → Root-cause discipline — never patch symptoms.
9. Weakness? → Test automation lagged features; now scheduled first.
10. Why should we hire you? → I ship complete systems and debug to root cause under real user pressure.
11. Team role? → Owner/driver; documented everything for handoff (docs/ convention).
12. Learning style? → Build → break → audit → systematize.
13. Motivation? → Users trusting output that used to be untrustworthy.
14. 5-year plan? → Senior/staff engineer specializing in AI product infrastructure.
15. Biggest risk taken? → Guaranteeing exact question counts (hard invariant on stochastic systems).
16. Prioritization? → User-facing correctness > security > performance > polish.
17. Feedback given? → N/A solo; simulated via pilot-user loop.
18. Staying current? → Model/provider churn forced provider-agnostic design.
19. Work under ambiguity? → "Make questions relevant" → decomposed into 5 measurable causes.
20. Questions for us? → How do you validate LLM outputs in production here?

## Technical (30) — condensed Q→A
1. JWT vs sessions → stateless scale, no server store; tradeoff: revocation needs blocklist.
2. Refresh rotation → each use issues new pair; old invalidated; limits theft window.
3. bcrypt why → adaptive cost factor, salt built-in; vs SHA: deliberately slow.
4. CORS → browser origin policy; API allows Vercel origin, env-configured.
5. REST idempotency → PUT/DELETE idempotent, POST not; regen is POST (non-idempotent by design).
6. SQL vs NoSQL here → relational tenancy + JSONB flexibility = middle path.
7. JSONB indexing → GIN indexes for containment queries (study this).
8. N+1 problem → avoided: role row carries files/bank inline.
9. Race conditions → concurrent 401 refresh stampede → single-flight promise.
10. Memory leak risks → polling intervals cleared on unmount (pollRef cleanup).
11. Event loop → LLM fetches are I/O; no CPU-blocking work in handlers; chunking keeps payloads bounded.
12. Streams/SSE → demo mode streams agent steps; SSE chosen (one-way, HTTP-native) over WS.
13. Debounce vs throttle → role-search debounced via setTimeout ref.
14. Controlled inputs → count bug: parse-on-keystroke destroyed editing; blur validation.
15. React re-renders → lazy routes, keyed lists, local state isolation.
16. Context vs Redux → server-as-truth, minimal shared client state.
17. Error boundaries → class component at root; catches render crashes.
18. Env var handling → Vite `import.meta.env` (build-time) vs server `process.env` (runtime).
19. Rate limiting algorithm → express-rate-limit windows; per-route budgets.
20. Prompt injection risk → docs are trusted-admin uploads; output validated regardless (defense in depth).
21. LLM temperature → 0.85 for variety; JSON mode for parseability.
22. Token limits → 80k chars ≈ 20k tokens/chunk fits Groq 128k with overhead.
23. Fallback design → provider fallback (Groq→Gemini) + content fallback (templates) — different layers.
24. Jaccard similarity → |A∩B|/|A∪B| on token sets; >0.70 = duplicate.
25. Why not embeddings dedup → keyword Jaccard is free, fast, explainable; embeddings = v2.
26. multer memoryStorage → buffer in RAM, no disk; fits ephemeral FS; 10MB cap.
27. ESM vs CJS → `"type":"module"`; createRequire bridges CJS packages (pdf-parse, mammoth).
28. AbortSignal.timeout → LLM calls bounded at 30s; prevents hung requests.
29. Optimistic vs pessimistic UI → pessimistic for generation (poll until real data).
30. Semantic versioning of APIs → additive-only endpoint policy = de facto backward compatibility.

## Project-specific (20) — condensed
1. Why per-file generation? → traceability + exact per-file counts + toggle isolation.
2. Grounding filter mechanics? → top-50 doc keywords; reject questions intersecting zero; skip if <5 keywords.
3. Chunk overlap why 1.5k? → covers sentences/steps straddling boundaries without heavy duplication.
4. Stakeholder toggle semantics? → No = category banned; Yes = allowed only when doc explicitly supports it.
5. Process Delivery toggle? → same pattern for SLA/KPI/governance category.
6. isManual flag? → provenance; enables ai-only regen preserving human edits.
7. sourceSection? → LLM-reported doc section per question; audit/debug metadata.
8. Why validate before save? → a bad bank corrupts assessments downstream; block at the gate.
9. JD section extraction fail-safe? → if filtered <20% of text survives, revert to full text (never destroy content).
10. Filename removal? → strip first line if it matches the filename pattern.
11. Difficulty split? → 35/45/20; validator warns >20% drift.
12. Type distribution? → 50% MCQ / 25% fill / 25% subjective via type sequence cycling.
13. Regen persistence? → count/toggle edits in regen panel persist to role before generating.
14. Doc delete flow? → DELETE endpoint; jobDescription re-derived when a JD file is removed.
15. Polling design? → 3s × 20 max; clears on success/unmount.
16. Dual-write consistency? → Supabase authoritative; JSON best-effort mirror.
17. Company scoping? → companyId from JWT claim filters every query.
18. Superadmin bypass? → hasRole returns true early; backend requireSuperAdmin separate gate.
19. LLM JSON parse failures? → try/catch → null → next provider → next attempt → template fallback.
20. Why deterministic fallback templates? → count guarantee is a product invariant; combinatorial combos avoid dup rejection.

## Debugging (10)
1. Only 41/50 saved? → count the pipeline stages; found borrowing dropped items → removed + validator.
2. Questions ignore docs? → audit every text path; found truncations + fallback defaults.
3. User logged out randomly? → distinguish network vs 401; retry with backoff.
4. Input can't be edited? → parse-on-keystroke; validate on blur.
5. PPTX yields nothing on Windows? → entry-name backslashes; normalize.
6. Same options across questions? → dedup only checked text; added option-set keys.
7. Fallback loop never finishes? → fuzzy dedup rejects templates; exact-match path.
8. 401 storms after idle? → concurrent refreshes; single-flight promise.
9. Endpoint abused? → no auth; middleware + client header fix atomically.
10. Blank screen post-create? → async generation; poll with capped attempts.

## System Design (10)
1. Design SkillForge at 1M users → replicas + Redis + queues + normalized DB + CDN (rehearse the full flow).
2. Design the generation queue → jobs keyed by role, idempotent workers, status via socket, retry with backoff, DLQ.
3. Multi-region? → read replicas per region; LLM calls region-nearest; token stores replicated Redis.
4. Real-time assessment monitoring? → socket rooms per company; event stream to admin dashboards.
5. Versioned question banks? → immutable bank snapshots; assessments pin a version.
6. Tenant data isolation? → RLS policies keyed on companyId claim; per-tenant encryption keys (advanced).
7. LLM cost controls? → per-tenant budgets, batch windows, cache, small-model routing, output length caps.
8. Assessment anti-cheat? → question pools + randomized selection + per-user seeds (seed already exists).
9. Audit logging? → append-only event table: who/what/when for every bank mutation.
10. Migration JSONB→tables? → dual-read shim, backfill job, cutover flag, rollback path.

---
*Generated 2026-07-14 · SkillForge pilot phase · Repo: gurusaiss/Skill-AI*
