import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import GeminiService from '../services/GeminiService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

class ChallengeEngine {
  constructor() {
    this.challenges = JSON.parse(readFileSync(join(__dirname, '../knowledge/challenges.json'), 'utf-8'));
  }

  // ── Gemini-powered: domain-specific challenge + MCQ warm-up ─────────────
  async generateWithLLM(planDay, session) {
    const goal = session?.goal?.goalText || planDay.skillName;
    const domain = session?.goal?.domainLabel || planDay.skillId;
    const topic = planDay.topic || planDay.skillName;
    const skillName = planDay.skillName || planDay.skillId;
    const sessionType = planDay.sessionType || 'practice';
    const recentWeaknesses = session?.sessions?.slice(-3).flatMap(s => s.weaknesses || []).slice(0, 3) || [];

    const prompt = `You are creating a learning session for someone who wants to: "${goal}"
Domain: ${domain}
Current skill: ${skillName}
Today's topic: ${topic}
Session type: ${sessionType}
${recentWeaknesses.length ? `Recent weak spots to address: ${recentWeaknesses.join(', ')}` : ''}

Return ONLY valid JSON:
{
  "id": "ch_${planDay.skillId}_day${planDay.day}",
  "title": "Specific, engaging challenge title about ${topic}",
  "description": "2-3 sentence real-world scenario. Name actual ${domain} tools/techniques/materials. Example: 'You are working on a client's formal dress and need to apply darts to the bodice...'",
  "type": "${sessionType}",
  "conceptSummary": {
    "title": "Short concept title (2-5 words) for ${topic}",
    "definition": "Clear 1-2 sentence definition of ${topic} in the context of ${domain}",
    "keyPoints": [
      "Key point 1 — a foundational fact about ${topic}",
      "Key point 2 — how it is applied in ${domain}",
      "Key point 3 — a common mistake or misconception",
      "Key point 4 — why mastering this matters"
    ],
    "example": "A concrete real-world example showing ${topic} in action in ${domain}",
    "proTip": "One actionable pro tip that experts use when dealing with ${topic}"
  },
  "hints": [
    "Domain-specific hint 1 about ${topic}",
    "Domain-specific hint 2",
    "Domain-specific hint 3"
  ],
  "evaluation_criteria": [
    "specific criterion 1 for ${topic}",
    "specific criterion 2",
    "specific criterion 3",
    "specific criterion 4"
  ],
  "model_solution": "2-3 sentences describing what an expert ${domain} response looks like for ${topic}.",
  "warmupQuestion": {
    "question": "A specific MCQ question about ${topic} in ${domain}?",
    "options": [
      "A) correct or plausible option",
      "B) plausible but wrong option",
      "C) plausible but wrong option",
      "D) clearly wrong option"
    ],
    "correct": "A) correct or plausible option",
    "explanation": "Why this answer is correct."
  }
}

IMPORTANT:
- Everything must be 100% specific to "${domain}" — NOT generic
- Use real ${domain} terminology (e.g. for tailoring: seam ripper, grain line, basting stitch, ease)
- The warmupQuestion must have EXACTLY 4 options labeled A) B) C) D)
- No generic phrases like "core concept" or "fundamental principle"
- conceptSummary must be beginner-friendly, clear, and domain-specific`;

    try {
      const result = await GeminiService.generateJSON(prompt,
        `You are an expert ${domain} instructor. Generate domain-specific, practical content. Return only valid JSON.`);

      if (result?.title && result?.description) {
        console.log(`[ChallengeEngine] Gemini challenge for Day ${planDay.day}: "${result.title}"`);
        return { ...result, source: 'llm' };
      }
    } catch (err) {
      console.error('[ChallengeEngine] Gemini error:', err.message);
    }
    return null;
  }

  personalizeChallenge(challenge, planDay, session) {
    const roleContext = session?.goal?.profile?.targetRole ? ` for your ${session.goal.profile.targetRole} path` : '';
    const weakSignal = session?.sessions?.length
      ? session.sessions.slice(-3).flatMap((entry) => entry.weaknesses || []).slice(0, 2).join(' ')
      : '';

    return {
      ...challenge,
      source: 'static',
      title: `${challenge.title}${roleContext}`,
      description: `${challenge.description} Focus especially on ${planDay.topic}.${weakSignal ? ` Recent weak spots: ${weakSignal}.` : ''}`,
      hints: [
        ...(challenge.hints || []),
        `Tie your answer back to ${planDay.topic}.`,
        session?.goal?.profile?.detectedTools?.length
          ? `Use examples with ${session.goal.profile.detectedTools.slice(0, 2).join(' and ')} if relevant.`
          : 'Use one practical, real-world example.',
      ].slice(0, 5),
      evaluation_criteria: [...new Set([...(challenge.evaluation_criteria || []), planDay.topic, (planDay.skillName || '').toLowerCase()])],
      model_solution: `${challenge.model_solution} A strong response should feel relevant to ${session?.goal?.profile?.targetRole || planDay.skillName}.`,
    };
  }

  buildDynamicChallenge(planDay, session) {
    const topic = planDay.topic || planDay.skillName;
    const skillName = planDay.skillName || planDay.skillId;
    const goal = session?.goal?.goalText || skillName;
    const role = session?.goal?.profile?.targetRole;
    const roleContext = role ? ` for your ${role} path` : '';
    const domain = session?.goal?.domainLabel || skillName;
    const sessionType = planDay.sessionType || 'practice';

    const recentWeaknesses = session?.sessions
      ?.slice(-3).flatMap((s) => s.weaknesses || []).slice(0, 2) || [];

    const challengeTemplates = {
      concept: {
        title: `Explain ${topic} — ${skillName}${roleContext}`,
        description: `In your own words, explain "${topic}" and how it is used in ${skillName}. Cover: what it is, why it matters, and a concrete real-world scenario where you would apply it.`,
        hints: [
          `Define "${topic}" clearly before diving into examples.`,
          `Think of a real ${domain} scenario where "${topic}" comes up.`,
          `Connect "${topic}" back to the bigger picture of ${skillName}.`,
        ],
      },
      practice: {
        title: `Apply ${topic} in a ${skillName} project${roleContext}`,
        description: `You are working on a ${domain} project that requires ${skillName}. Specifically, you need to handle "${topic}". Describe your step-by-step approach.`,
        hints: [
          `Start by identifying what "${topic}" requires in this context.`,
          `Walk through your approach step-by-step.`,
          `Mention any common mistakes to avoid.`,
        ],
      },
      review: {
        title: `Review & reinforce ${topic}${roleContext}`,
        description: `Review your understanding of "${topic}" in ${skillName} by explaining it clearly. What are the most common mistakes? How do you avoid them?`,
        hints: [
          `Think about what confused you when first learning "${topic}".`,
          `Give at least one practical do/don't example.`,
          `Explain the mental model that makes "${topic}" click.`,
        ],
      },
    };

    const template = challengeTemplates[sessionType] || challengeTemplates.practice;
    const weaknessHint = recentWeaknesses.length
      ? `Pay special attention to: ${recentWeaknesses.join(', ')}.`
      : null;

    return {
      id: planDay.challengeId || `ch_${planDay.skillId}_day${planDay.day}`,
      day_range: [planDay.day, planDay.day],
      type: sessionType,
      source: 'dynamic',
      title: template.title,
      description: `${template.description}${weaknessHint ? ` ${weaknessHint}` : ''}`,
      hints: [...template.hints, ...(weaknessHint ? [weaknessHint] : [])].slice(0, 4),
      evaluation_criteria: [
        `understanding of ${topic}`,
        `practical application in ${skillName}`,
        'clear reasoning and examples',
        'connection to real use cases',
      ],
      model_solution: `A strong response defines "${topic}", shows how it applies in ${skillName} with a concrete example, and explains the reasoning clearly.`,
      conceptSummary: {
        title: topic,
        definition: `${topic} is an important concept in ${skillName} that involves understanding and applying its core principles within ${domain} contexts.`,
        keyPoints: [
          `${topic} is foundational to mastering ${skillName} — it underpins many advanced techniques.`,
          `In ${domain}, ${topic} is commonly applied when working on real-world tasks and projects.`,
          `A common mistake is treating ${topic} as purely theoretical — hands-on practice is essential.`,
          `Mastering ${topic} will directly improve your confidence and output quality in ${domain}.`,
        ],
        example: `In a real ${domain} scenario, you would encounter ${topic} when building or working on a project that requires ${skillName}. Understanding it lets you make better decisions and avoid common pitfalls.`,
        proTip: `Always connect ${topic} to a concrete use case before diving into theory. Asking "where would I use this today?" makes it stick much faster.`,
      },
    };
  }

  // ── Main entry ───────────────────────────────────────────────────────────
  async getChallengeForDay(planDay, session = null) {
    // 1. Try Gemini for domain-specific challenge
    if (GeminiService.isEnabled()) {
      const llmChallenge = await this.generateWithLLM(planDay, session);
      if (llmChallenge) return llmChallenge;
    }

    // 2. Try static knowledge bank
    const options = this.challenges[planDay.skillId] || [];
    const challenge = options.find((entry) => entry.id === planDay.challengeId)
      || options.find((entry) => {
        const [start, end] = entry.day_range || [planDay.day, planDay.day];
        return planDay.day >= start && planDay.day <= end;
      })
      || options[0];

    if (challenge) {
      return this.personalizeChallenge(challenge, planDay, session);
    }

    // 3. Dynamic fallback
    return this.buildDynamicChallenge(planDay, session);
  }
}

export default ChallengeEngine;
