/**
 * OpenAPI 3.0 specification for SkillForge AI REST API.
 * Served at GET /api/docs and GET /api/docs.json
 */
export const swaggerSpec = {
  openapi: '3.0.3',
  info: {
    title: 'SkillForge AI API',
    version: '3.0.0',
    description: `
## SkillForge AI — Autonomous Multi-Agent Learning Platform

A production-grade REST API powering personalized skill acquisition through **14 specialized AI agents**.

### Key Features
- 🤖 **14 AI Agents**: Goal decomposition → skill trees → adaptive plans → evaluation
- 🗳️ **Agent Debate System**: Three agents vote before major plan changes (transparent AI)
- 📊 **Adaptive Learning**: Real-time difficulty adjustment every 3 sessions
- 🎯 **Skill Drift Detection**: Alerts when mastered skills degrade
- 💼 **Career Digital Twin**: Market-aligned skill trajectory modeling
- 🔄 **Hybrid Resilience**: Gemini 2.0 Flash → Groq fallback → Rule-based fallback

### Authentication
All protected endpoints require a \`Bearer <token>\` header obtained from \`POST /api/auth/login\`.

### Rate Limiting
- Auth endpoints: 5 req/15min per IP
- AI endpoints: 30 req/min per user
- General: 100 req/min per IP
    `,
    contact: {
      name: 'SkillForge AI',
      url: 'https://github.com/gurusaiss/skillforge-ai',
    },
    license: { name: 'MIT' },
  },
  servers: [
    { url: 'http://localhost:3001', description: 'Local development' },
    { url: 'https://api.skillforge.ai', description: 'Production' },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'JWT token from POST /api/auth/login',
      },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: false },
          error: { type: 'string', example: 'Unauthorized' },
          data: { type: 'object', nullable: true },
        },
      },
      Success: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data: { type: 'object' },
          error: { type: 'string', nullable: true },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          email: { type: 'string', format: 'email' },
          name: { type: 'string' },
          role: { type: 'string', enum: ['admin', 'manager', 'employee'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Goal: {
        type: 'object',
        required: ['goal'],
        properties: {
          goal: { type: 'string', example: 'Become a machine learning engineer in 90 days' },
          timeframe: { type: 'string', example: '90 days' },
          level: { type: 'string', enum: ['beginner', 'intermediate', 'advanced'], default: 'beginner' },
        },
      },
      SkillTree: {
        type: 'object',
        properties: {
          domain: { type: 'string' },
          skills: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                level: { type: 'integer', minimum: 1, maximum: 5 },
                prerequisites: { type: 'array', items: { type: 'string' } },
                estimatedHours: { type: 'number' },
              },
            },
          },
          totalDays: { type: 'integer' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
      Session: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string' },
          goalId: { type: 'string' },
          dayNumber: { type: 'integer' },
          topic: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'active', 'completed', 'skipped'] },
          score: { type: 'number', nullable: true },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      AgentDebateResult: {
        type: 'object',
        properties: {
          decision: { type: 'string', enum: ['accelerate', 'maintain', 'review', 'remediate'] },
          votes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                agent: { type: 'string', enum: ['Advocate', 'Critic', 'Analyst'] },
                vote: { type: 'string' },
                confidence: { type: 'number' },
                reasoning: { type: 'string' },
              },
            },
          },
          consensus: { type: 'number', description: 'Weighted confidence score 0-1' },
        },
      },
    },
  },
  security: [{ BearerAuth: [] }],
  paths: {
    '/api/health': {
      get: {
        tags: ['System'],
        summary: 'Health check',
        security: [],
        responses: {
          200: {
            description: 'Server is healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        status: { type: 'string', example: 'ok' },
                        gemini: { type: 'string' },
                        groq: { type: 'string' },
                        agentCount: { type: 'integer', example: 14 },
                        uptime: { type: 'string' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/auth/register': {
      post: {
        tags: ['Authentication'],
        summary: 'Register a new user',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password', 'name'],
                properties: {
                  email: { type: 'string', format: 'email' },
                  password: { type: 'string', minLength: 8 },
                  name: { type: 'string' },
                  role: { type: 'string', enum: ['admin', 'manager', 'employee'], default: 'employee' },
                  orgId: { type: 'string', description: 'Optional organization ID' },
                },
              },
            },
          },
        },
        responses: {
          201: { description: 'User created', content: { 'application/json': { schema: { $ref: '#/components/schemas/Success' } } } },
          409: { description: 'Email already exists', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/auth/login': {
      post: {
        tags: ['Authentication'],
        summary: 'Login and receive JWT',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['email', 'password'],
                properties: {
                  email: { type: 'string', format: 'email', example: 'learner@example.com' },
                  password: { type: 'string', example: 'Password123!' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'JWT token returned',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        token: { type: 'string' },
                        user: { $ref: '#/components/schemas/User' },
                      },
                    },
                  },
                },
              },
            },
          },
          401: { description: 'Invalid credentials', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        },
      },
    },
    '/api/goal': {
      post: {
        tags: ['Learning Engine'],
        summary: 'Submit a learning goal — triggers the full AI agent pipeline',
        description: `
Triggers the **SmartAgent orchestrator** which runs:
1. **GoalAgent** — classifies domain and extracts intent
2. **SkillDecomposer** — builds a skill tree via Gemini 2.0 Flash
3. **DiagnosticAgent** — generates a 10-question baseline quiz
4. **PlanBuilder** — creates a day-by-day curriculum
5. **MarketAgent** — aligns skills with job market demand
        `,
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Goal' },
              example: {
                goal: 'Become a full-stack developer',
                timeframe: '60 days',
                level: 'beginner',
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Goal processed, skill tree and plan returned',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { $ref: '#/components/schemas/Success' },
                    {
                      type: 'object',
                      properties: {
                        data: {
                          type: 'object',
                          properties: {
                            goalId: { type: 'string' },
                            skillTree: { $ref: '#/components/schemas/SkillTree' },
                            diagnosticQuestions: { type: 'array', items: { type: 'object' } },
                            plan: { type: 'array', items: { type: 'object' } },
                            agentTrace: { type: 'array', items: { type: 'object' }, description: 'Full agent reasoning chain' },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    '/api/session': {
      get: {
        tags: ['Sessions'],
        summary: 'List all sessions for the authenticated user',
        responses: {
          200: {
            description: 'Session list',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: { type: 'array', items: { $ref: '#/components/schemas/Session' } },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/session/{id}/complete': {
      post: {
        tags: ['Sessions'],
        summary: 'Complete a session — triggers Evaluator and Adaptor agents',
        description: `
After completion, if this is session **3, 6, 9...** (every 3rd session), the **Adaptor** agent runs:
- If score < 60% for 2+ sessions → triggers **AgentDebate** → inserts review sessions
- If score > 90% for 2+ sessions → triggers **AgentDebate** → accelerates timeline
        `,
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['answers'],
                properties: {
                  answers: { type: 'array', items: { type: 'object' } },
                  timeSpentSeconds: { type: 'integer' },
                },
              },
            },
          },
        },
        responses: {
          200: {
            description: 'Session evaluated',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    success: { type: 'boolean' },
                    data: {
                      type: 'object',
                      properties: {
                        score: { type: 'number' },
                        feedback: { type: 'string' },
                        adaptationTriggered: { type: 'boolean' },
                        agentDebate: { $ref: '#/components/schemas/AgentDebateResult' },
                        nextSession: { $ref: '#/components/schemas/Session' },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/interview/start': {
      post: {
        tags: ['Interview Simulator'],
        summary: 'Start a mock interview session',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  goalId: { type: 'string' },
                  interviewType: { type: 'string', enum: ['technical', 'behavioral', 'system-design', 'mixed'] },
                  difficulty: { type: 'string', enum: ['junior', 'mid', 'senior'] },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Interview started with first question' },
        },
      },
    },
    '/api/simulation/run': {
      post: {
        tags: ['Simulation Lab'],
        summary: 'Run a what-if scenario without affecting actual plan',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  goalId: { type: 'string' },
                  scenario: {
                    type: 'object',
                    properties: {
                      hoursPerDay: { type: 'number', example: 4 },
                      skipSkills: { type: 'array', items: { type: 'string' } },
                      targetDate: { type: 'string', format: 'date' },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'Simulation result with predicted outcomes' },
        },
      },
    },
    '/api/tutor/chat': {
      post: {
        tags: ['AI Tutor'],
        summary: 'Chat with the AI tutor (context-aware)',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string' },
                  sessionId: { type: 'string', description: 'Optional — binds tutor to current session context' },
                  history: { type: 'array', items: { type: 'object' }, description: 'Conversation history for multi-turn context' },
                },
              },
            },
          },
        },
        responses: {
          200: { description: 'AI tutor response' },
        },
      },
    },
  },
  tags: [
    { name: 'System', description: 'Health and status endpoints' },
    { name: 'Authentication', description: 'Register, login, password management' },
    { name: 'Learning Engine', description: 'Goal processing and AI agent pipeline' },
    { name: 'Sessions', description: 'Learning session CRUD and completion' },
    { name: 'Interview Simulator', description: 'AI-powered mock interview system' },
    { name: 'Simulation Lab', description: 'What-if scenario modeling' },
    { name: 'AI Tutor', description: 'Context-aware AI tutoring chat' },
  ],
};
