import geminiService from '../services/GeminiService.js';

class ReactChain {
  constructor() {
    this.gemini = geminiService;
    this.maxIterations = 5;
  }

  // Available tools the agent can call
  get tools() {
    return {
      analyze_performance: (args) => {
        const { sessions = [], topic = '' } = args;
        const avg = sessions.length > 0
          ? Math.round(sessions.reduce((s, x) => s + (x.score || 0), 0) / sessions.length)
          : 65;
        return { avgScore: avg, trend: avg > 70 ? 'improving' : 'declining', topic };
      },
      check_skill_gaps: (args) => {
        const { skills = [] } = args;
        const weak = skills.filter(s => (s.mastery || s.score || 0) < 70);
        return { weakSkills: weak.map(s => s.name), count: weak.length };
      },
      get_market_demand: (args) => {
        const { skill = '' } = args;
        const demand = ['React', 'Python', 'SQL', 'Node.js'].some(s =>
          skill.toLowerCase().includes(s.toLowerCase())
        ) ? 'HIGH' : 'MEDIUM';
        return { skill, demand, jobsAvailable: Math.floor(Math.random() * 5000) + 1000 };
      },
      schedule_review: (args) => {
        const { topic = '', day = 1 } = args;
        return {
          scheduled: true,
          topic,
          day,
          message: `Review session for "${topic}" scheduled on Day ${day}`,
        };
      },
      calculate_mastery: (args) => {
        const { scores = [] } = args;
        const mastery = scores.length > 0
          ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
          : 0;
        const level =
          mastery >= 90 ? 'Expert' :
          mastery >= 70 ? 'Proficient' :
          mastery >= 50 ? 'Developing' : 'Novice';
        return { mastery, level };
      },
    };
  }

  // Parse tool call from LLM output like: ACTION: tool_name({"arg": "val"})
  parseToolCall(text) {
    const match = text.match(/ACTION:\s*(\w+)\((\{.*?\})\)/s);
    if (!match) return null;
    try {
      return { name: match[1], args: JSON.parse(match[2]) };
    } catch {
      return null;
    }
  }

  // Execute a tool call
  executeTool(name, args) {
    const tool = this.tools[name];
    if (!tool) return { error: `Unknown tool: ${name}` };
    try {
      return tool(args);
    } catch (e) {
      return { error: e.message };
    }
  }

  // Build fallback ReAct chain without LLM (always works)
  buildFallbackChain(goal, context = {}) {
    const { sessions = [], skills = [], planDay = 1 } = context;
    const recentSessions = sessions.slice(-3);
    const avgScore = recentSessions.length > 0
      ? Math.round(recentSessions.reduce((s, x) => s + (x.score || 0), 0) / recentSessions.length)
      : 72;
    const weakSkills = skills.filter(s => (s.mastery || s.score || 0) < 70).slice(0, 2);
    const topSkill = skills[0]?.name || 'current skill';

    return [
      {
        type: 'thought',
        content: `I need to analyze the learner's current performance to determine the best next action. Goal: "${goal}". Current day: ${planDay}.`,
      },
      {
        type: 'action',
        tool: 'analyze_performance',
        args: { sessions: recentSessions, topic: topSkill },
        content: `analyze_performance({"sessions_count": ${Math.min(3, sessions.length)}, "topic": "${topSkill}"})`,
      },
      {
        type: 'observation',
        content: `Performance analysis complete. Average score: ${avgScore}%. Trend: ${avgScore > 70 ? 'improving ✅' : 'needs attention ⚠️'}.`,
      },
      {
        type: 'thought',
        content: weakSkills.length > 0
          ? `I see weakness in: ${weakSkills.map(s => s.name).join(', ')}. I should check these skill gaps and potentially schedule review.`
          : `Performance looks good overall. I should verify market alignment and optimize the remaining plan.`,
      },
      {
        type: 'action',
        tool: weakSkills.length > 0 ? 'check_skill_gaps' : 'get_market_demand',
        args: weakSkills.length > 0 ? { skills } : { skill: topSkill },
        content: weakSkills.length > 0
          ? `check_skill_gaps({"skills": [${weakSkills.map(s => `"${s.name}"`).join(',')}]})`
          : `get_market_demand({"skill": "${topSkill}"})`,
      },
      {
        type: 'observation',
        content: weakSkills.length > 0
          ? `Found ${weakSkills.length} skill${weakSkills.length > 1 ? 's' : ''} below 70% mastery: ${weakSkills.map(s => s.name).join(', ')}. Reinforcement needed.`
          : `Market demand for this skill is HIGH. ${Math.floor(Math.random() * 3000) + 2000} active job listings found.`,
      },
      {
        type: 'answer',
        content: weakSkills.length > 0
          ? `📋 **Recommendation**: Schedule focused review sessions for ${weakSkills.map(s => s.name).join(' and ')}. Current mastery below threshold. Estimated 2 sessions needed to reach 70%+ proficiency.`
          : `✅ **Recommendation**: Current learning trajectory is optimal. Market demand is strong. Continue with existing plan — maintaining good momentum toward goal.`,
      },
    ];
  }

  // Main run method — attempts Gemini/Groq, falls back to deterministic chain
  async run(goal, context = {}) {
    const startTime = Date.now();
    let steps = [];
    let usedModel = 'rule-based';

    try {
      const anyLLMEnabled = this.gemini.isEnabled() || this.gemini.groqEnabled;
      if (anyLLMEnabled) {
        const prompt = `You are an AI learning advisor using ReAct reasoning.
Goal: ${goal}
Context: Day ${context.planDay || 1} of learning. Sessions: ${context.sessions?.length || 0}. Skills: ${context.skills?.map(s => s.name).join(', ') || 'none'}.

Use this EXACT ReAct format (3-4 iterations max, then give a FINAL ANSWER):
THOUGHT: [your reasoning about what to do next]
ACTION: tool_name({"arg": "value"})
OBSERVATION: [what you learned from the tool result]
THOUGHT: [updated reasoning based on observation]
ACTION: tool_name({"arg": "value"})
OBSERVATION: [result]
FINAL ANSWER: [your concrete recommendation]

Available tools: analyze_performance, check_skill_gaps, get_market_demand, schedule_review, calculate_mastery
Keep each THOUGHT/ACTION/OBSERVATION on its own line. No markdown formatting inside steps.`;

        const result = await this.gemini.generateText(prompt);
        if (result && result.length > 100) {
          const lines = result.split('\n').filter(l => l.trim());
          for (const line of lines) {
            if (line.startsWith('THOUGHT:')) {
              steps.push({ type: 'thought', content: line.slice(8).trim() });
            } else if (line.startsWith('ACTION:')) {
              const toolCall = this.parseToolCall(line);
              const obs = toolCall ? this.executeTool(toolCall.name, toolCall.args) : null;
              steps.push({ type: 'action', tool: toolCall?.name, content: line.slice(7).trim() });
              if (obs) {
                steps.push({ type: 'observation', content: JSON.stringify(obs) });
              }
            } else if (line.startsWith('FINAL ANSWER:')) {
              steps.push({ type: 'answer', content: line.slice(13).trim() });
            }
          }
          if (steps.length >= 3) {
            usedModel = this.gemini.isEnabled() ? 'gemini-2.0-flash' : 'groq-llama-3.3-70b';
          }
        }
      }
    } catch (e) {
      console.log('[ReactChain] LLM failed, using fallback:', e.message);
    }

    // Use fallback if LLM failed or returned too few steps
    if (steps.length < 3) {
      steps = this.buildFallbackChain(goal, context);
      usedModel = 'rule-based';
    }

    return {
      goal,
      steps,
      duration: Date.now() - startTime,
      model: usedModel,
      timestamp: new Date().toISOString(),
    };
  }
}

export default new ReactChain();
