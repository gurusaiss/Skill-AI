# SkillForge AI Agent Architecture Guide

## 🧠 Multi-Agent Collaboration System

SkillForge uses a **multi-agent architecture** where specialized AI agents work together to create personalized, adaptive learning experiences. This is not a single AI making all decisions — it's a **team of expert agents** that debate, collaborate, and adapt based on your learning progress.

---

## 🎯 Core Philosophy

**Traditional Learning Platforms**: One-size-fits-all curriculum, no adaptation, no intelligence.

**SkillForge**: 12+ specialized agents that:

- **Debate** before making adaptation decisions (3-agent voting system)
- **Adapt** your learning plan in real-time based on performance
- **Detect** skill drift (when previously mastered skills decline)
- **Generate** domain-specific content for ANY field (not just coding)
- **Collaborate** to provide personalized coaching

---

## 🏗️ Agent Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      SmartAgent                              │
│                  (Orchestrator / Brain)                      │
│  • Coordinates all other agents                             │
│  • Manages learning session lifecycle                       │
│  • Tracks agent decisions and debates                       │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┴──────────┐
        │                     │
        ▼                     ▼
┌──────────────┐      ┌──────────────┐
│ Core Agents  │      │ Advanced     │
│              │      │ Agents       │
└──────────────┘      └──────────────┘
        │                     │
        ├─ SkillDecomposer    ├─ MarketAgent
        ├─ QuizGenerator      ├─ SimulationAgent
        ├─ Evaluator          ├─ InterviewAgent
        ├─ PlanBuilder        └─ ReportGenerator
        ├─ ChallengeEngine
        ├─ Adaptor
        └─ AgentDebate
```
