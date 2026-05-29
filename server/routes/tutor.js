import express from 'express';
import geminiService from '../services/GeminiService.js';

const router = express.Router();

// Keyword-based fallback responses
function ruleBased(message) {
  const msg = message.toLowerCase();

  if (msg.includes('example') || msg.includes('show me')) {
    return "Great question! A practical example helps cement understanding. Could you share the specific concept you'd like me to illustrate? I'll tailor the example to your current topic.";
  }
  if (msg.includes('why') && (msg.includes('important') || msg.includes('matter'))) {
    return "Understanding the 'why' is crucial for deep learning. This concept is foundational because it connects theory to real-world problem-solving — mastering it unlocks higher-level skills in the field.";
  }
  if (msg.includes('explain') || msg.includes('what is') || msg.includes('what are')) {
    return "I'd love to explain that! This concept is a core building block in the field. At its heart, it's about creating structured, reusable solutions to common problems — which is why professionals rely on it daily.";
  }
  if (msg.includes('how') && (msg.includes('work') || msg.includes('use') || msg.includes('do'))) {
    return "Here's how to think about it: start with the fundamentals, then layer in practical usage. The key is consistent practice — try applying it in small projects to build real muscle memory.";
  }
  if (msg.includes('difficult') || msg.includes('hard') || msg.includes('confus') || msg.includes('stuck')) {
    return "It's completely normal to find this challenging! Break it into smaller pieces and focus on one part at a time. Would you like me to walk through a specific aspect that's confusing you?";
  }
  if (msg.includes('roadmap') || msg.includes('next') || msg.includes('plan')) {
    return "For your learning plan, I'd recommend progressing from fundamentals to applied projects. Focus on your current skill gaps first, then branch into adjacent areas. Consistency beats intensity — 30 minutes daily compounds fast.";
  }
  if (msg.includes('career') || msg.includes('job') || msg.includes('hire') || msg.includes('interview')) {
    return "Career growth in tech hinges on demonstrated skills and strong fundamentals. Build a portfolio of projects, practice explaining your work clearly, and keep leveling up on the skills most in-demand for your target role.";
  }
  if (msg.includes('hello') || msg.includes('hi') || msg.includes('hey')) {
    return "Hi there! I'm your AI Tutor, here to help you learn and grow. What would you like to explore today?";
  }

  return "That's a great question! I'm here to help you understand concepts clearly and apply them effectively. Could you give me a bit more context so I can give you the most useful answer?";
}

/**
 * POST /api/tutor/chat
 * Body: { message: string, context: string, history: [{role, content}] }
 */
router.post('/chat', async (req, res) => {
  try {
    const { message, context = '/', history = [] } = req.body;

    if (!message || typeof message !== 'string' || !message.trim()) {
      return res.status(400).json({ success: false, error: 'message is required', data: null });
    }

    const systemPrompt = `You are SkillForge AI's friendly learning tutor. You help students understand technical concepts, give clear examples, and motivate learners. Be concise (2-3 sentences max unless asked for more). If the student asks for an example, a list, or detailed explanation, you may go longer — but stay focused and practical. Always be encouraging. Context: user is on page: ${context}.`;

    // Build the full prompt including conversation history
    let prompt = '';
    const recentHistory = history.slice(-5);

    if (recentHistory.length > 0) {
      prompt += 'Previous conversation:\n';
      for (const turn of recentHistory) {
        const label = turn.role === 'user' ? 'Student' : 'Tutor';
        prompt += `${label}: ${turn.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `Student: ${message.trim()}\nTutor:`;

    // Try AI generation
    const aiReply = await geminiService.generateText(prompt, systemPrompt);

    if (aiReply && aiReply.trim()) {
      return res.json({ success: true, data: { reply: aiReply.trim() } });
    }

    // Fallback to rule-based
    const fallback = ruleBased(message);
    return res.json({ success: true, data: { reply: fallback } });

  } catch (err) {
    console.error('[tutor] Chat error:', err.message);
    const fallback = ruleBased(req.body?.message || '');
    return res.json({ success: true, data: { reply: fallback } });
  }
});

export default router;
