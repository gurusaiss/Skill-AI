const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = 'LAYOUT_WIDE'; // 13.3" x 7.5"
pres.title = 'SkillForge – HackAP Hackathon Pitch';
pres.author = 'AI4AP';

// ── COLOR PALETTE ──────────────────────────────────────────────────
const C = {
  bg:       '0F172A',
  bg2:      '1E293B',
  bg3:      '162032',
  border:   '334155',
  indigo:   '6366F1',
  emerald:  '10B981',
  amber:    'F59E0B',
  red:      'EF4444',
  t1:       'F1F5F9',
  t2:       '94A3B8',
  t3:       '475569',
  white:    'FFFFFF',
};

// ── HELPERS ────────────────────────────────────────────────────────
function addFooter(slide) {
  // HackAP badge bottom-left
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0.18, y: 7.1, w: 1.1, h: 0.28,
    fill: { color: C.bg2 }, line: { color: C.border, width: 1 }
  });
  slide.addText('HackAP', {
    x: 0.18, y: 7.1, w: 1.1, h: 0.28,
    fontSize: 7.5, color: C.t3, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  // Footer center text
  slide.addText('AI4AP  |  HackAP Hackathon – Agentic AI', {
    x: 3.5, y: 7.14, w: 6.3, h: 0.22,
    fontSize: 7, color: C.t3, align: 'center', valign: 'middle', margin: 0
  });

  // SF circle bottom-right
  slide.addShape(pres.shapes.OVAL, {
    x: 12.72, y: 7.08, w: 0.36, h: 0.36,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 1 }
  });
  slide.addText('SF', {
    x: 12.72, y: 7.08, w: 0.36, h: 0.36,
    fontSize: 7, color: C.white, bold: true, align: 'center', valign: 'middle', margin: 0
  });
}

function pill(slide, text, x, y, w, h, textColor, borderColor, fillColor) {
  slide.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x, y, w, h,
    fill: { color: fillColor || C.bg2 },
    line: { color: borderColor, width: 1 },
    rectRadius: 0.08
  });
  slide.addText(text, {
    x, y, w, h,
    fontSize: 8.5, color: textColor, bold: true, align: 'center', valign: 'middle', margin: 0
  });
}

function sectionTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.35, y: 0.22, w: 12, h: 0.5,
    fontSize: 26, color: C.t1, bold: true, align: 'left', valign: 'middle', fontFace: 'Calibri', margin: 0
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.35, y: 0.72, w: 12, h: 0.28,
      fontSize: 11.5, color: C.t2, align: 'left', valign: 'middle', fontFace: 'Calibri', margin: 0
    });
  }
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 1 — HERO
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  // Subtle top accent bar
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.3, h: 0.04,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 0 }
  });

  // Problem badge pill
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 3.4, y: 1.2, w: 6.5, h: 0.38,
    fill: { color: C.bg2 }, line: { color: C.indigo, width: 1 }, rectRadius: 0.08
  });
  s.addText('Problem 5: Autonomous Skill Acquisition Agent', {
    x: 3.4, y: 1.2, w: 6.5, h: 0.38,
    fontSize: 9.5, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  // SkillForge title
  s.addText('SkillForge', {
    x: 1, y: 1.75, w: 11.3, h: 1.4,
    fontSize: 64, color: C.t1, bold: true, align: 'center', valign: 'middle', fontFace: 'Calibri', margin: 0
  });

  // Accent line (simulated gradient using two rects)
  s.addShape(pres.shapes.RECTANGLE, {
    x: 4.05, y: 3.2, w: 2.6, h: 0.06,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 0 }
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 6.65, y: 3.2, w: 2.6, h: 0.06,
    fill: { color: C.emerald }, line: { color: C.emerald, width: 0 }
  });

  // Tagline
  s.addText('The Autonomous AI Agent That Builds Careers.', {
    x: 1, y: 3.35, w: 11.3, h: 0.45,
    fontSize: 18, color: C.t2, italic: true, align: 'center', valign: 'middle', fontFace: 'Calibri', margin: 0
  });

  // 3 stat pills
  const pills = [
    { text: '9 AI Agents', color: C.indigo, x: 3.15 },
    { text: 'Real-Time Adaptation', color: C.emerald, x: 5.45 },
    { text: 'Frontier-Level Autonomy', color: C.amber, x: 8.2 },
  ];
  pills.forEach(p => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: p.x, y: 3.98, w: 2.1, h: 0.38,
      fill: { color: C.bg2 }, line: { color: p.color, width: 1.2 }, rectRadius: 0.08
    });
    s.addText(p.text, {
      x: p.x, y: 3.98, w: 2.1, h: 0.38,
      fontSize: 9, color: p.color, bold: true, align: 'center', valign: 'middle', margin: 0
    });
  });

  // Team AI4AP
  s.addText('Team AI4AP', {
    x: 1, y: 4.55, w: 11.3, h: 0.3,
    fontSize: 10, color: C.t3, align: 'center', valign: 'middle', margin: 0
  });

  // Bottom accent bar
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 7.46, w: 13.3, h: 0.04,
    fill: { color: C.emerald }, line: { color: C.emerald, width: 0 }
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 2 — THE PROBLEM
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'The Problem', 'Why self-learning fails at scale');

  const cards = [
    { x: 0.3,  color: C.red,    icon: 'FRAGMENTED', title: 'No Clear Path',       body: 'Learners waste months on unstructured content with zero progress tracking or personalization.', stat: '73% of learners abandon online courses' },
    { x: 4.65, color: C.amber,  icon: 'STATIC',     title: 'Zero Adaptability',   body: "Courses don't adjust to skill gaps, learning speed, or evolving market demands.",              stat: 'Skills become obsolete every 18 months' },
    { x: 9.0,  color: C.indigo, icon: 'BLIND',      title: 'No Feedback Loop',    body: 'No real-time evaluation, no mentor guidance, no measurable skill validation.',                 stat: "87% can't prove skills to employers" },
  ];

  cards.forEach(c => {
    // Card body
    s.addShape(pres.shapes.RECTANGLE, {
      x: c.x, y: 1.15, w: 4.0, h: 5.3,
      fill: { color: C.bg2 }, line: { color: c.color, width: 1 }
    });
    // Icon header band
    s.addShape(pres.shapes.RECTANGLE, {
      x: c.x, y: 1.15, w: 4.0, h: 0.9,
      fill: { color: c.color, transparency: 82 }, line: { color: c.color, width: 0 }
    });
    // Left border accent
    s.addShape(pres.shapes.RECTANGLE, {
      x: c.x, y: 1.15, w: 0.06, h: 5.3,
      fill: { color: c.color }, line: { color: c.color, width: 0 }
    });
    // Icon label
    s.addText(c.icon, {
      x: c.x + 0.1, y: 1.18, w: 3.8, h: 0.84,
      fontSize: 11, color: c.color, bold: true, align: 'center', valign: 'middle', charSpacing: 3, margin: 0
    });
    // Title
    s.addText(c.title, {
      x: c.x + 0.18, y: 2.18, w: 3.65, h: 0.45,
      fontSize: 15, color: C.t1, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    // Body
    s.addText(c.body, {
      x: c.x + 0.18, y: 2.72, w: 3.65, h: 1.5,
      fontSize: 9.5, color: C.t2, align: 'left', valign: 'top', margin: 0
    });
    // Stat separator line
    s.addShape(pres.shapes.LINE, {
      x: c.x + 0.18, y: 5.55, w: 3.65, h: 0,
      line: { color: c.color, width: 0.5, transparency: 60 }
    });
    // Stat text
    s.addText(c.stat, {
      x: c.x + 0.18, y: 5.65, w: 3.65, h: 0.65,
      fontSize: 8.5, color: c.color, italic: true, align: 'left', valign: 'top', margin: 0
    });
  });

  // Bottom statement
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.3, y: 6.57, w: 12.7, h: 0.42,
    fill: { color: C.bg2 }, line: { color: C.border, width: 1 }
  });
  s.addText('The workforce is changing faster than people can learn. Traditional platforms are spectators.', {
    x: 0.3, y: 6.57, w: 12.7, h: 0.42,
    fontSize: 11, color: C.t1, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 3 — THE SOLUTION
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'The Solution', 'One autonomous platform. End-to-end skill mastery.');

  // Solution statement box
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.15, w: 12.3, h: 1.6,
    fill: { color: C.bg2 }, line: { color: C.indigo, width: 2 }
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.5, y: 1.15, w: 0.07, h: 1.6,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 0 }
  });
  s.addText('SkillForge identifies your goal, maps your gaps, builds your path,\nteaches you, tests you, adapts in real-time, and proves your mastery—entirely autonomously.', {
    x: 0.75, y: 1.18, w: 11.9, h: 1.54,
    fontSize: 14.5, color: C.t1, bold: true, align: 'center', valign: 'middle', fontFace: 'Calibri', margin: 4
  });

  // Gradient separator line
  s.addShape(pres.shapes.RECTANGLE, {
    x: 2.5, y: 2.95, w: 4.15, h: 0.05,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 0 }
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 6.65, y: 2.95, w: 4.15, h: 0.05,
    fill: { color: C.emerald }, line: { color: C.emerald, width: 0 }
  });

  // 4 feature blocks
  const features = [
    { icon: 'ANALYZE', label: 'Goal & Gap Detection',       color: C.indigo,  x: 1.0  },
    { icon: 'BUILD',   label: 'Adaptive Learning Path',     color: C.emerald, x: 4.15 },
    { icon: 'TEACH',   label: 'Practice & Evaluation',      color: C.amber,   x: 7.3  },
    { icon: 'PROVE',   label: 'Skill Verification & Portfolio', color: C.indigo, x: 10.45 },
  ];

  features.forEach((f, i) => {
    // Circle
    s.addShape(pres.shapes.OVAL, {
      x: f.x + 0.45, y: 3.2, w: 1.3, h: 1.3,
      fill: { color: f.color, transparency: 80 }, line: { color: f.color, width: 1.5 }
    });
    s.addText(f.icon, {
      x: f.x + 0.45, y: 3.2, w: 1.3, h: 1.3,
      fontSize: 9, color: f.color, bold: true, align: 'center', valign: 'middle', charSpacing: 1.5, margin: 0
    });
    // Label
    s.addText(f.label, {
      x: f.x, y: 4.62, w: 2.2, h: 0.6,
      fontSize: 9.5, color: C.t2, align: 'center', valign: 'top', margin: 0
    });
    // Arrow between blocks
    if (i < 3) {
      s.addShape(pres.shapes.LINE, {
        x: f.x + 2.18, y: 3.85, w: 0.5, h: 0,
        line: { color: C.t3, width: 1.5 }
      });
      // Arrowhead triangle (approximate)
      s.addShape(pres.shapes.RECTANGLE, {
        x: f.x + 2.62, y: 3.82, w: 0.1, h: 0.07,
        fill: { color: C.t3 }, line: { color: C.t3, width: 0 }
      });
    }
  });

  // Feature number badges
  features.forEach((f, i) => {
    s.addShape(pres.shapes.OVAL, {
      x: f.x + 0.85, y: 3.15, w: 0.42, h: 0.42,
      fill: { color: f.color }, line: { color: f.color, width: 0 }
    });
    s.addText(String(i + 1), {
      x: f.x + 0.85, y: 3.15, w: 0.42, h: 0.42,
      fontSize: 8, color: C.white, bold: true, align: 'center', valign: 'middle', margin: 0
    });
  });

  // Connecting platform label
  s.addText('End-to-End Autonomous Pipeline', {
    x: 2.5, y: 5.35, w: 8.3, h: 0.35,
    fontSize: 10, color: C.t3, italic: true, align: 'center', valign: 'middle', margin: 0
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 4 — MULTI-AGENT ARCHITECTURE
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Multi-Agent Architecture', '9 specialized autonomous agents — each with a distinct role, memory, and reasoning chain');

  // Right panel
  s.addShape(pres.shapes.RECTANGLE, {
    x: 10.15, y: 1.1, w: 3.0, h: 5.85,
    fill: { color: C.bg2 }, line: { color: C.border, width: 1 }
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 10.15, y: 1.1, w: 3.0, h: 0.38,
    fill: { color: C.indigo, transparency: 75 }, line: { color: C.indigo, width: 0 }
  });
  s.addText('Architecture Principles', {
    x: 10.2, y: 1.1, w: 2.9, h: 0.38,
    fontSize: 9.5, color: C.t2, bold: true, align: 'left', valign: 'middle', margin: 6
  });

  const principles = [
    'Blackboard shared memory pattern',
    'Parallel agent execution',
    'LLM-first with rule-based fallback',
    'Open/Closed — new agents = zero refactoring',
    'Persistent short + long-term context',
  ];
  principles.forEach((p, i) => {
    s.addShape(pres.shapes.OVAL, {
      x: 10.3, y: 1.68 + i * 0.64, w: 0.12, h: 0.12,
      fill: { color: C.emerald }, line: { color: C.emerald, width: 0 }
    });
    s.addText(p, {
      x: 10.5, y: 1.58 + i * 0.64, w: 2.5, h: 0.4,
      fontSize: 8.5, color: C.t2, align: 'left', valign: 'middle', margin: 0
    });
  });

  // Hub center
  const cx = 4.9, cy = 3.8, r = 1.95;
  s.addShape(pres.shapes.OVAL, {
    x: cx - 0.72, y: cy - 0.52, w: 1.44, h: 1.04,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 2 }
  });
  s.addText([
    { text: 'SmartAgent', options: { breakLine: true } },
    { text: 'Orchestrator' }
  ], {
    x: cx - 0.72, y: cy - 0.52, w: 1.44, h: 1.04,
    fontSize: 9.5, color: C.white, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  // 8 agent nodes around hub
  const nodes = [
    { angle: 90,   color: C.indigo,  name: 'GoalAgent',        desc: 'Goal decomposition & target mapping' },
    { angle: 45,   color: C.emerald, name: 'DiagnosticAgent',   desc: 'Skill gap assessment & scoring' },
    { angle: 0,    color: C.amber,   name: 'CurriculumAgent',   desc: 'Adaptive learning path builder' },
    { angle: -45,  color: C.indigo,  name: 'EvaluatorAgent',    desc: 'Session scoring & performance' },
    { angle: -90,  color: C.red,     name: 'AdaptorAgent',      desc: 'Real-time path recalibration' },
    { angle: -135, color: C.emerald, name: 'MarketAgent',       desc: 'Live market intelligence & trends' },
    { angle: 180,  color: C.amber,   name: 'SimulationAgent',   desc: 'Career what-if scenario modeling' },
    { angle: 135,  color: C.indigo,  name: 'ScoringAgent',      desc: 'Multi-dimensional mastery scoring' },
  ];

  nodes.forEach(n => {
    const rad = (n.angle * Math.PI) / 180;
    const nx = cx + r * Math.cos(rad);
    const ny = cy - r * Math.sin(rad);
    const nw = 1.65, nh = 0.72;

    // Line from center to node edge (approximate)
    const lx1 = cx + 0.72 * Math.cos(rad);
    const ly1 = cy - 0.52 * Math.sin(rad);
    const lx2 = nx - (nw / 2) * Math.cos(rad);
    const ly2 = ny + (nh / 2) * Math.sin(rad);
    s.addShape(pres.shapes.LINE, {
      x: Math.min(lx1, lx2), y: Math.min(ly1, ly2),
      w: Math.abs(lx2 - lx1) || 0.01,
      h: Math.abs(ly2 - ly1) || 0.01,
      line: { color: C.border, width: 1 }
    });

    // Node box
    s.addShape(pres.shapes.RECTANGLE, {
      x: nx - nw / 2, y: ny - nh / 2, w: nw, h: nh,
      fill: { color: C.bg2 }, line: { color: n.color, width: 1.5 }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: nx - nw / 2, y: ny - nh / 2, w: nw, h: 0.04,
      fill: { color: n.color }, line: { color: n.color, width: 0 }
    });
    s.addText(n.name, {
      x: nx - nw / 2 + 0.06, y: ny - nh / 2 + 0.05, w: nw - 0.1, h: 0.3,
      fontSize: 9, color: n.color, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(n.desc, {
      x: nx - nw / 2 + 0.06, y: ny - nh / 2 + 0.36, w: nw - 0.1, h: 0.3,
      fontSize: 7, color: C.t2, align: 'left', valign: 'middle', margin: 0
    });
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 5 — ORCHESTRATION FLOW
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'How Agents Collaborate', 'Autonomous multi-step execution pipeline — from goal to mastery');

  const stages = [
    { num: '01', title: 'Goal Intake',         agent: 'GoalAgent',       color: C.indigo,  body: 'User states career goal. Agent decomposes into skills, milestones, timelines.' },
    { num: '02', title: 'Diagnostic',          agent: 'DiagnosticAgent', color: C.emerald, body: '10-question adaptive assessment. Scores 6 dimensions. Maps skill gaps precisely.' },
    { num: '03', title: 'Path Build',          agent: 'CurriculumAgent', color: C.amber,   body: 'AI generates 30-day personalized roadmap. Daily challenges calibrated to level.' },
    { num: '04', title: 'Practice Loop',       agent: 'EvaluatorAgent',  color: C.indigo,  body: 'Timed challenges. Multi-criteria scoring. Instant feedback. Session memory.' },
    { num: '05', title: 'Adapt & Recalibrate', agent: 'AdaptorAgent',    color: C.red,     body: 'Detects plateau or regression. Rebuilds path. Triggers AgentDebate for plan changes.' },
    { num: '06', title: 'Verify & Report',     agent: 'ScoringAgent',    color: C.emerald, body: 'Final mastery score. Career readiness report. Portfolio evidence generated.' },
  ];

  const sw = 1.98, sh = 4.0, sy = 1.15;
  stages.forEach((st, i) => {
    const sx = 0.28 + i * (sw + 0.14);

    // Card
    s.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: sy, w: sw, h: sh,
      fill: { color: C.bg2 }, line: { color: C.border, width: 1 }
    });
    // Top color bar
    s.addShape(pres.shapes.RECTANGLE, {
      x: sx, y: sy, w: sw, h: 0.1,
      fill: { color: st.color }, line: { color: st.color, width: 0 }
    });
    // Step number
    s.addText(st.num, {
      x: sx + 0.08, y: sy + 0.14, w: 0.5, h: 0.3,
      fontSize: 11, color: st.color, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    // Title
    s.addText(st.title, {
      x: sx + 0.08, y: sy + 0.44, w: sw - 0.16, h: 0.42,
      fontSize: 11.5, color: C.t1, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    // Agent pill
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: sx + 0.08, y: sy + 0.9, w: sw - 0.16, h: 0.28,
      fill: { color: st.color, transparency: 82 }, line: { color: st.color, width: 1 }, rectRadius: 0.06
    });
    s.addText(st.agent, {
      x: sx + 0.08, y: sy + 0.9, w: sw - 0.16, h: 0.28,
      fontSize: 7.5, color: st.color, bold: true, align: 'center', valign: 'middle', margin: 0
    });
    // Body text
    s.addText(st.body, {
      x: sx + 0.1, y: sy + 1.28, w: sw - 0.2, h: 2.55,
      fontSize: 8, color: C.t2, align: 'left', valign: 'top', margin: 0
    });

    // Arrow between stages
    if (i < 5) {
      s.addShape(pres.shapes.LINE, {
        x: sx + sw, y: sy + sh / 2,
        w: 0.14, h: 0,
        line: { color: C.indigo, width: 1.5 }
      });
    }
  });

  // Stats row
  s.addShape(pres.shapes.LINE, {
    x: 0.28, y: 5.35, w: 12.74, h: 0,
    line: { color: C.border, width: 0.75 }
  });

  const stats = [
    { val: '< 90 seconds', lbl: 'Full pipeline execution', color: C.indigo, x: 1.5 },
    { val: 'Zero manual steps', lbl: 'After goal input', color: C.emerald, x: 5.4 },
    { val: 'Continuous loop', lbl: 'Until mastery achieved', color: C.amber, x: 9.1 },
  ];
  stats.forEach(st => {
    s.addText(st.val, {
      x: st.x, y: 5.48, w: 3.2, h: 0.38,
      fontSize: 12.5, color: st.color, bold: true, align: 'center', valign: 'middle', margin: 0
    });
    s.addText(st.lbl, {
      x: st.x, y: 5.85, w: 3.2, h: 0.28,
      fontSize: 8.5, color: C.t3, align: 'center', valign: 'middle', margin: 0
    });
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 6 — AUTONOMY PROOF POINTS
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Frontier-Level Agentic Behavior', 'Beyond prompt-response — true autonomous execution');

  // Column headers
  s.addText('What SkillForge Does', {
    x: 0.3, y: 1.12, w: 6.0, h: 0.32,
    fontSize: 10.5, color: C.emerald, bold: true, align: 'left', valign: 'middle', margin: 0
  });
  s.addShape(pres.shapes.LINE, {
    x: 0.3, y: 1.43, w: 5.8, h: 0, line: { color: C.emerald, width: 1 }
  });

  s.addText('Why This Is Agentic (Not Just AI)', {
    x: 6.85, y: 1.12, w: 6.1, h: 0.32,
    fontSize: 10.5, color: C.indigo, bold: true, align: 'left', valign: 'middle', margin: 0
  });
  s.addShape(pres.shapes.LINE, {
    x: 6.85, y: 1.43, w: 6.1, h: 0, line: { color: C.indigo, width: 1 }
  });

  // Vertical divider
  s.addShape(pres.shapes.LINE, {
    x: 6.65, y: 1.1, w: 0, h: 5.55, line: { color: C.border, width: 1 }
  });

  const leftCards = [
    { title: 'Persistent Memory',     body: 'Remembers every session, score, struggle, and breakthrough across days.',                          color: C.emerald },
    { title: 'AgentDebate Protocol',  body: '3 agents (Advocate, Critic, Analyst) vote before any learning path modification.',                  color: C.amber   },
    { title: 'Failure Recovery',      body: 'Gemini quota hit? Auto-switches to Groq. Agent error? Graceful fallback with rule-based logic.',    color: C.red     },
  ];
  const rightCards = [
    { title: 'Context-Aware State Machine', body: 'Not a chatbot with history. A stateful agent that evolves its own mental model of the user.',                                     color: C.indigo },
    { title: 'Multi-Agent Consensus',       body: 'Decisions are not single-model outputs. They are weighted, contested, and verified internally.',                                 color: C.indigo },
    { title: 'Adaptive Resilience',         body: 'System degrades gracefully — never stops. Retries, reroutes, and self-heals.',                                              color: C.indigo },
  ];

  const cardH = 1.45;
  leftCards.forEach((c, i) => {
    const cy = 1.58 + i * (cardH + 0.14);
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.3, y: cy, w: 6.2, h: cardH,
      fill: { color: C.bg2 }, line: { color: c.color, width: 0 }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.3, y: cy, w: 0.07, h: cardH,
      fill: { color: c.color }, line: { color: c.color, width: 0 }
    });
    s.addText(c.title, {
      x: 0.5, y: cy + 0.12, w: 5.85, h: 0.35,
      fontSize: 11, color: C.t1, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(c.body, {
      x: 0.5, y: cy + 0.5, w: 5.85, h: 0.82,
      fontSize: 8.5, color: C.t2, align: 'left', valign: 'top', margin: 0
    });
  });

  rightCards.forEach((c, i) => {
    const cy = 1.58 + i * (cardH + 0.14);
    s.addShape(pres.shapes.RECTANGLE, {
      x: 6.85, y: cy, w: 6.1, h: cardH,
      fill: { color: C.bg2 }, line: { color: c.color, width: 0 }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 6.85, y: cy, w: 0.07, h: cardH,
      fill: { color: c.color }, line: { color: c.color, width: 0 }
    });
    s.addText(c.title, {
      x: 7.05, y: cy + 0.12, w: 5.75, h: 0.35,
      fontSize: 11, color: C.t1, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(c.body, {
      x: 7.05, y: cy + 0.5, w: 5.75, h: 0.82,
      fontSize: 8.5, color: C.t2, align: 'left', valign: 'top', margin: 0
    });
  });

  // Bottom banner
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.3, y: 6.42, w: 12.7, h: 0.45,
    fill: { color: C.indigo, transparency: 88 }, line: { color: C.indigo, width: 1.5 }
  });
  s.addText('Score 10 Target:  Autonomy ✓  Evolution ✓  Multi-Agent Intelligence ✓  Frontier Execution ✓', {
    x: 0.3, y: 6.42, w: 12.7, h: 0.45,
    fontSize: 10.5, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 7 — LIVE PRODUCT DASHBOARD
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Live Product', 'A real deployed system — not a prototype');

  // Dashboard wireframe (left 60%)
  const dw = 7.6, dh = 5.5, dx = 0.3, dy = 1.1;
  s.addShape(pres.shapes.RECTANGLE, {
    x: dx, y: dy, w: dw, h: dh,
    fill: { color: C.bg2 }, line: { color: C.border, width: 1.5 }
  });
  // Top bar
  s.addShape(pres.shapes.RECTANGLE, {
    x: dx, y: dy, w: dw, h: 0.38,
    fill: { color: C.bg3 }, line: { color: C.border, width: 0 }
  });
  // Three window dots
  [C.red, C.amber, C.emerald].forEach((c, i) => {
    s.addShape(pres.shapes.OVAL, {
      x: dx + 0.18 + i * 0.28, y: dy + 0.12, w: 0.16, h: 0.16,
      fill: { color: c }, line: { color: c, width: 0 }
    });
  });
  s.addText('SkillForge Dashboard', {
    x: dx + 1.5, y: dy + 0.02, w: dw - 1.8, h: 0.35,
    fontSize: 8.5, color: C.t3, align: 'left', valign: 'middle', margin: 0
  });

  // 4 KPI mini-cards 2x2
  const kpis = [
    { val: 'Day 12 / 30', lbl: 'Current Day',      color: C.indigo  },
    { val: 'Score 78%',   lbl: 'Avg Performance',  color: C.emerald },
    { val: '3 Skills',    lbl: 'In Progress',       color: C.amber   },
    { val: '94%',         lbl: 'Path Completion',   color: C.indigo  },
  ];
  kpis.forEach((k, i) => {
    const kx = dx + 0.22 + (i % 2) * 3.62;
    const ky = dy + 0.52 + Math.floor(i / 2) * 0.92;
    s.addShape(pres.shapes.RECTANGLE, {
      x: kx, y: ky, w: 3.3, h: 0.76,
      fill: { color: C.bg }, line: { color: k.color, width: 1, transparency: 40 }
    });
    s.addText(k.val, {
      x: kx + 0.1, y: ky + 0.04, w: 3.1, h: 0.38,
      fontSize: 14, color: k.color, bold: true, align: 'center', valign: 'middle', margin: 0
    });
    s.addText(k.lbl, {
      x: kx + 0.1, y: ky + 0.42, w: 3.1, h: 0.28,
      fontSize: 7.5, color: C.t3, align: 'center', valign: 'middle', margin: 0
    });
  });

  // Mini bar chart
  const barData = [0.55, 0.72, 0.60, 0.83, 0.78];
  const bx = dx + 0.22, by = dy + 2.42, bw = 6.8, bh = 1.55;
  s.addShape(pres.shapes.RECTANGLE, {
    x: bx, y: by, w: bw, h: bh,
    fill: { color: C.bg }, line: { color: C.border, width: 0.5 }
  });
  const barW = 0.9;
  barData.forEach((v, i) => {
    const hh = v * (bh - 0.3);
    s.addShape(pres.shapes.RECTANGLE, {
      x: bx + 0.3 + i * 1.28, y: by + bh - 0.15 - hh, w: barW, h: hh,
      fill: { color: C.indigo, transparency: 35 }, line: { color: C.indigo, width: 0 }
    });
  });
  s.addText('30-Day Progress Trend', {
    x: bx, y: by + bh + 0.05, w: bw, h: 0.25,
    fontSize: 7.5, color: C.t3, align: 'center', valign: 'middle', margin: 0
  });

  // Frontier modules row
  const fcolors = [C.emerald, C.indigo, C.amber, C.indigo];
  fcolors.forEach((c, i) => {
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: dx + 0.3 + i * 1.82, y: dy + dh - 0.48, w: 1.55, h: 0.32,
      fill: { color: c, transparency: 82 }, line: { color: c, width: 1 }, rectRadius: 0.05
    });
  });

  // Right panel callouts
  const features = [
    { dot: C.indigo,  title: 'Autonomous Dashboard',  desc: 'Agent decisions visualized in real-time' },
    { dot: C.emerald, title: 'Career Digital Twin',   desc: 'SVG radar chart of your skill profile' },
    { dot: C.amber,   title: 'Simulation Lab',        desc: 'What-if career scenario modeling' },
    { dot: C.red,     title: 'Explainability Console',desc: 'Full agent reasoning chain' },
    { dot: C.indigo,  title: 'Live Demo Mode',        desc: 'Watch 9 agents execute via SSE streaming' },
    { dot: C.emerald, title: 'Market Intelligence',   desc: 'Live industry demand signals' },
  ];

  features.forEach((f, i) => {
    const fy = 1.25 + i * 0.72;
    s.addShape(pres.shapes.OVAL, {
      x: 8.22, y: fy + 0.08, w: 0.18, h: 0.18,
      fill: { color: f.dot }, line: { color: f.dot, width: 0 }
    });
    s.addText(f.title, {
      x: 8.52, y: fy, w: 4.48, h: 0.3,
      fontSize: 10, color: C.t1, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(f.desc, {
      x: 8.52, y: fy + 0.3, w: 4.48, h: 0.28,
      fontSize: 8, color: C.t2, align: 'left', valign: 'middle', margin: 0
    });
  });

  // Deployed badge
  s.addShape(pres.shapes.RECTANGLE, {
    x: 8.1, y: 6.42, w: 4.9, h: 0.4,
    fill: { color: C.emerald, transparency: 88 }, line: { color: C.emerald, width: 1 }
  });
  s.addText('✓  Deployed on Vercel — Live & Running', {
    x: 8.1, y: 6.42, w: 4.9, h: 0.4,
    fontSize: 9.5, color: C.emerald, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 8 — EXPLAINABILITY CONSOLE
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Explainability Console', 'Every agent decision is transparent, traceable, and human-readable');

  // Console frame
  const cfw = 9.5, cfh = 5.7, cfx = 0.28, cfy = 1.1;
  s.addShape(pres.shapes.RECTANGLE, {
    x: cfx, y: cfy, w: cfw, h: cfh,
    fill: { color: '0D1117' }, line: { color: C.border, width: 1.5 }
  });
  // Top bar
  s.addShape(pres.shapes.RECTANGLE, {
    x: cfx, y: cfy, w: cfw, h: 0.36,
    fill: { color: C.bg2 }, line: { color: C.border, width: 0 }
  });
  [C.red, C.amber, C.emerald].forEach((c, i) => {
    s.addShape(pres.shapes.OVAL, {
      x: cfx + 0.18 + i * 0.28, y: cfy + 0.1, w: 0.16, h: 0.16,
      fill: { color: c }, line: { color: c, width: 0 }
    });
  });
  s.addText('SkillForge Explainability Console — Agent Decision Log', {
    x: cfx + 1.2, y: cfy + 0.03, w: cfw - 1.4, h: 0.3,
    fontSize: 8, color: C.t3, align: 'left', valign: 'middle', margin: 0
  });

  // 3 decision cards
  const dcards = [
    {
      color: C.indigo,  agent: 'CurriculumAgent', ts: 'Day 12, 14:32:01', conf: '94% confident', confColor: C.emerald,
      decision: 'Skipped Module 4 (Arrays). Promoted user to Module 6 (Trees).',
      reasoning: 'User scored 91% on arrays across 3 sessions. Velocity +18%. Diminishing returns detected. Efficiency gain: 4 days.',
      evidence:  'Sessions [12,11,10] → scores [91,88,93]. Threshold: 85%. Action: advance.'
    },
    {
      color: C.amber,   agent: 'AdaptorAgent',    ts: 'Day 8, 09:17:44',  conf: '87% confident', confColor: C.amber,
      decision: 'Triggered AgentDebate — learning path recalibration.',
      reasoning: '3 consecutive sessions below 60%. Plateau pattern detected. Advocate, Critic, Analyst voted 2-1 to simplify module before advancing.',
      evidence:  'Debate: Advocate(simplify)=0.7, Critic(push)=0.3, Analyst(simplify)=0.8. Weighted: simplify.'
    },
    {
      color: C.emerald, agent: 'MarketAgent',     ts: 'Day 1, 10:00:00',  conf: '92% confident', confColor: C.emerald,
      decision: 'Added TypeScript to learning path. Deprioritized jQuery.',
      reasoning: 'Market scan: TypeScript demand +340% YoY in Full-Stack domain. jQuery in top-3 declining. Goal alignment +23%.',
      evidence:  'Source: MarketAgent live scan. Domain: Full-Stack. Snapshot: 2024-Q4.'
    },
  ];

  const cardH = 1.6;
  dcards.forEach((d, i) => {
    const cy = cfy + 0.48 + i * (cardH + 0.14);
    const cx2 = cfx + 0.18;
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx2, y: cy, w: cfw - 0.36, h: cardH,
      fill: { color: C.bg2 }, line: { color: C.border, width: 0 }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx2, y: cy, w: 0.06, h: cardH,
      fill: { color: d.color }, line: { color: d.color, width: 0 }
    });
    // Header row
    s.addText(d.agent, {
      x: cx2 + 0.15, y: cy + 0.06, w: 1.5, h: 0.26,
      fontSize: 8.5, color: d.color, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(d.ts, {
      x: cx2 + 1.75, y: cy + 0.06, w: 2.5, h: 0.26,
      fontSize: 7.5, color: C.t3, align: 'left', valign: 'middle', margin: 0
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: cx2 + 4.6, y: cy + 0.08, w: 1.5, h: 0.22,
      fill: { color: d.confColor, transparency: 82 }, line: { color: d.confColor, width: 0.75 }
    });
    s.addText(d.conf, {
      x: cx2 + 4.6, y: cy + 0.08, w: 1.5, h: 0.22,
      fontSize: 7, color: d.confColor, align: 'center', valign: 'middle', margin: 0
    });
    // Decision
    s.addText('DECISION:  ', {
      x: cx2 + 0.15, y: cy + 0.38, w: 1.0, h: 0.24,
      fontSize: 7.5, color: C.amber, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(d.decision, {
      x: cx2 + 1.15, y: cy + 0.38, w: 7.8, h: 0.24,
      fontSize: 8.5, color: C.t1, align: 'left', valign: 'middle', margin: 0
    });
    // Reasoning
    s.addText('REASONING:  ', {
      x: cx2 + 0.15, y: cy + 0.68, w: 1.2, h: 0.24,
      fontSize: 7, color: C.t2, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(d.reasoning, {
      x: cx2 + 1.3, y: cy + 0.68, w: 7.65, h: 0.34,
      fontSize: 7.5, color: C.t2, align: 'left', valign: 'top', margin: 0
    });
    // Evidence
    s.addText('EVIDENCE:  ', {
      x: cx2 + 0.15, y: cy + 1.1, w: 1.1, h: 0.22,
      fontSize: 6.5, color: C.t3, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(d.evidence, {
      x: cx2 + 1.2, y: cy + 1.1, w: 7.7, h: 0.38,
      fontSize: 7, color: C.t3, align: 'left', valign: 'top', margin: 0
    });
  });

  // Right panel
  s.addShape(pres.shapes.RECTANGLE, {
    x: 10.02, y: 1.1, w: 3.06, h: 5.7,
    fill: { color: C.bg2 }, line: { color: C.border, width: 1 }
  });
  s.addText('Transparency Features', {
    x: 10.1, y: 1.18, w: 2.85, h: 0.35,
    fontSize: 9.5, color: C.t2, bold: true, align: 'left', valign: 'middle', margin: 4
  });
  const tFeatures = ['Decision type tagging', 'Confidence scoring', 'Evidence citation', 'Agent attribution', 'Full audit trail', 'Human override option'];
  tFeatures.forEach((f, i) => {
    s.addShape(pres.shapes.OVAL, {
      x: 10.2, y: 1.72 + i * 0.68, w: 0.14, h: 0.14,
      fill: { color: C.emerald }, line: { color: C.emerald, width: 0 }
    });
    s.addText(f, {
      x: 10.42, y: 1.62 + i * 0.68, w: 2.55, h: 0.38,
      fontSize: 9, color: C.t2, align: 'left', valign: 'middle', margin: 0
    });
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 9 — TECHNICAL STACK
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Technical Stack', 'Production-grade infrastructure — built for scale');

  const layers = [
    { label: 'FRONTEND',    color: C.indigo,  tag: 'Vercel CDN',           text: 'React 18 + Vite  ·  TailwindCSS  ·  React Router  ·  Custom SVG Charts  ·  SSE EventSource Client' },
    { label: 'BACKEND',     color: C.emerald, tag: 'Node.js + Express',    text: 'Node.js + Express  ·  REST API  ·  SSE Streaming  ·  CORS  ·  Modular Route Architecture (7 routers)' },
    { label: 'AI / LLM',    color: C.amber,   tag: 'Dual-LLM Resilience',  text: 'Gemini 2.0 Flash (Primary)  ·  Groq LLaMA-3.3-70B (Fallback)  ·  Structured JSON generation  ·  Auto-retry + failover' },
    { label: 'AGENT LAYER', color: C.indigo,  tag: '9 Agents',             text: '9 Specialized Agents  ·  SmartAgent Orchestrator  ·  Blackboard Pattern  ·  AgentDebate (3-agent voting)  ·  Parallel execution' },
    { label: 'DATA / KB',   color: C.red,     tag: 'Stateful + Persistent',text: 'JSON Knowledge Bank (Domains · Questions · Challenges)  ·  File-based session persistence  ·  LRU-style context management' },
  ];

  const lh = 0.78, ly0 = 1.15;
  layers.forEach((l, i) => {
    const ly = ly0 + i * (lh + 0.1);
    // Layer bg
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.3, y: ly, w: 12.7, h: lh,
      fill: { color: l.color, transparency: 90 }, line: { color: l.color, width: 1 }
    });
    // Left label band
    s.addShape(pres.shapes.RECTANGLE, {
      x: 0.3, y: ly, w: 1.28, h: lh,
      fill: { color: l.color, transparency: 65 }, line: { color: l.color, width: 0 }
    });
    s.addText(l.label, {
      x: 0.3, y: ly, w: 1.28, h: lh,
      fontSize: 8.5, color: C.white, bold: true, align: 'center', valign: 'middle', charSpacing: 1, margin: 0
    });
    // Main text
    s.addText(l.text, {
      x: 1.72, y: ly, w: 9.7, h: lh,
      fontSize: 10, color: C.t1, align: 'left', valign: 'middle', margin: 6
    });
    // Right tag
    s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
      x: 11.55, y: ly + 0.18, w: 1.35, h: 0.42,
      fill: { color: l.color, transparency: 75 }, line: { color: l.color, width: 1 }, rectRadius: 0.06
    });
    s.addText(l.tag, {
      x: 11.55, y: ly + 0.18, w: 1.35, h: 0.42,
      fontSize: 7, color: l.color, bold: true, align: 'center', valign: 'middle', margin: 0
    });
  });

  // 3 stat callouts
  const callouts = [
    { val: '< 90s',          lbl: 'Full pipeline',               x: 1.5  },
    { val: '99.9%',          lbl: 'Uptime (Vercel)',              x: 5.4  },
    { val: '2 LLM Providers',lbl: 'Zero single point of failure', x: 8.8  },
  ];
  callouts.forEach(c => {
    s.addText(c.val, {
      x: c.x, y: 5.85, w: 3.5, h: 0.48,
      fontSize: 18, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0
    });
    s.addText(c.lbl, {
      x: c.x, y: 6.32, w: 3.5, h: 0.3,
      fontSize: 8.5, color: C.t3, align: 'center', valign: 'middle', margin: 0
    });
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 10 — SUCCESS CRITERIA MATRIX
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Judging Criteria — SkillForge Fulfillment', 'Every success criterion met. Every requirement implemented.');

  const rows = [
    ['Agentic Behavior',  '9 autonomous agents, SmartAgent orchestrator, no human steps after goal entry'],
    ['Practicality',      'Live deployed platform — real users, real skills, real career paths'],
    ['Adaptability',      'AdaptorAgent + AgentDebate recalibrates path on every session result'],
    ['Reliability',       'Gemini → Groq fallback. Rule-based fallback if both fail. Zero hard crashes.'],
    ['Explainability',    'Dedicated Explainability Console — every decision logged with reasoning + evidence'],
    ['Efficiency',        'Parallel agent execution. 90-second full pipeline. Minimal compute waste.'],
    ['Innovation',        'Career Digital Twin, Simulation Lab, AgentDebate, What-If career modeling'],
    ['Impactful',         'Addresses $366B workforce upskilling market. Measurable mastery scores.'],
  ];

  const tableData = [
    [
      { text: 'Success Criterion', options: { bold: true, color: C.white, fill: { color: C.indigo }, fontSize: 10, align: 'center' } },
      { text: 'SkillForge Implementation', options: { bold: true, color: C.white, fill: { color: C.indigo }, fontSize: 10, align: 'center' } },
      { text: 'Status', options: { bold: true, color: C.white, fill: { color: C.indigo }, fontSize: 10, align: 'center' } },
    ],
    ...rows.map((r, i) => [
      { text: r[0], options: { bold: true, color: C.t1, fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 9.5 } },
      { text: r[1], options: { color: C.t2, fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 8.5 } },
      { text: '✓ DONE', options: { bold: true, color: C.emerald, fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 9, align: 'center' } },
    ])
  ];

  s.addTable(tableData, {
    x: 0.3, y: 1.1, w: 12.7,
    colW: [2.2, 9.1, 1.4],
    border: { pt: 0.5, color: C.border },
    rowH: 0.56,
  });

  // Score projection
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.3, y: 5.95, w: 12.7, h: 0.75,
    fill: { color: C.indigo, transparency: 88 }, line: { color: C.indigo, width: 1.5 }
  });
  s.addText('Target Score:  47–50 / 50    |    Architecture: 19/20  ·  Solution: 14/15  ·  UX: 7/8  ·  Innovation: 7/7', {
    x: 0.3, y: 5.95, w: 12.7, h: 0.75,
    fontSize: 12, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 11 — MARKET OPPORTUNITY
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Market Opportunity', 'Workforce upskilling is the defining challenge of the AI era');

  // Concentric circles (left half)
  const circleCX = 3.2, circleCY = 4.0;
  // Outer circle — TAM
  s.addShape(pres.shapes.OVAL, {
    x: circleCX - 2.75, y: circleCY - 2.55, w: 5.5, h: 5.1,
    fill: { color: C.indigo, transparency: 90 }, line: { color: C.indigo, width: 1.5, transparency: 40 }
  });
  s.addText('TAM', { x: circleCX - 2.5, y: 1.38, w: 5.0, h: 0.3, fontSize: 9, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0 });
  s.addText('$366B', { x: circleCX - 2.5, y: 1.7, w: 5.0, h: 0.7, fontSize: 30, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0 });
  s.addText('Global EdTech Market', { x: circleCX - 2.5, y: 2.4, w: 5.0, h: 0.28, fontSize: 8.5, color: C.t2, align: 'center', valign: 'middle', margin: 0 });

  // Middle circle — SAM
  s.addShape(pres.shapes.OVAL, {
    x: circleCX - 1.85, y: circleCY - 1.45, w: 3.7, h: 2.9,
    fill: { color: C.emerald, transparency: 86 }, line: { color: C.emerald, width: 1.5, transparency: 40 }
  });
  s.addText('SAM', { x: circleCX - 1.7, y: 3.15, w: 3.4, h: 0.26, fontSize: 8.5, color: C.emerald, bold: true, align: 'center', valign: 'middle', margin: 0 });
  s.addText('$89B', { x: circleCX - 1.7, y: 3.4, w: 3.4, h: 0.55, fontSize: 22, color: C.emerald, bold: true, align: 'center', valign: 'middle', margin: 0 });
  s.addText('Online Skills Platforms', { x: circleCX - 1.7, y: 3.95, w: 3.4, h: 0.26, fontSize: 8, color: C.t2, align: 'center', valign: 'middle', margin: 0 });

  // Inner circle — SOM
  s.addShape(pres.shapes.OVAL, {
    x: circleCX - 1.0, y: circleCY + 0.1, w: 2.0, h: 1.5,
    fill: { color: C.amber, transparency: 75 }, line: { color: C.amber, width: 2 }
  });
  s.addText('SOM', { x: circleCX - 0.9, y: 4.18, w: 1.8, h: 0.22, fontSize: 7.5, color: C.amber, bold: true, align: 'center', valign: 'middle', margin: 0 });
  s.addText('$4.2B', { x: circleCX - 0.9, y: 4.4, w: 1.8, h: 0.42, fontSize: 16, color: C.amber, bold: true, align: 'center', valign: 'middle', margin: 0 });
  s.addText('Agentic AI Learning', { x: circleCX - 1.2, y: 4.82, w: 2.4, h: 0.26, fontSize: 7.5, color: C.t2, align: 'center', valign: 'middle', margin: 0 });

  // 3 insight cards (right)
  const insights = [
    { val: '87M Jobs',      desc: 'will require reskilling by 2027 — World Economic Forum',    color: C.indigo  },
    { val: '340% Growth',   desc: 'in demand for AI-augmented learning tools (2023–2025)', color: C.emerald },
    { val: '18 Months',     desc: 'average half-life of a technical skill in fast-moving domains', color: C.amber },
  ];
  insights.forEach((ins, i) => {
    const iy = 1.3 + i * 1.8;
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.1, y: iy, w: 6.0, h: 1.55,
      fill: { color: C.bg2 }, line: { color: ins.color, width: 0 }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: 7.1, y: iy, w: 0.07, h: 1.55,
      fill: { color: ins.color }, line: { color: ins.color, width: 0 }
    });
    s.addText(ins.val, {
      x: 7.28, y: iy + 0.18, w: 5.7, h: 0.55,
      fontSize: 20, color: ins.color, bold: true, align: 'left', valign: 'middle', margin: 0
    });
    s.addText(ins.desc, {
      x: 7.28, y: iy + 0.78, w: 5.7, h: 0.6,
      fontSize: 9.5, color: C.t2, align: 'left', valign: 'top', margin: 0
    });
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 12 — COMPETITIVE DIFFERENTIATION
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Why SkillForge Wins', 'Not another course platform — a career intelligence operating system');

  const features = [
    'Autonomous Goal Decomposition',
    'Multi-Agent Architecture (9 agents)',
    'Real-Time Path Adaptation',
    'Explainability Console',
    'Career Digital Twin + Simulation',
  ];

  // Table
  const headerRow = [
    { text: 'Feature',              options: { bold: true, color: C.t2,   fill: { color: C.bg2 }, fontSize: 9.5, align: 'left'   } },
    { text: 'Coursera / Udemy',     options: { bold: true, color: C.t2,   fill: { color: C.bg2 }, fontSize: 9.5, align: 'center' } },
    { text: 'ChatGPT / Claude',     options: { bold: true, color: C.t2,   fill: { color: C.bg2 }, fontSize: 9.5, align: 'center' } },
    { text: 'Generic AI Tutor',     options: { bold: true, color: C.t2,   fill: { color: C.bg2 }, fontSize: 9.5, align: 'center' } },
    { text: 'SkillForge',           options: { bold: true, color: C.white, fill: { color: C.indigo }, fontSize: 10, align: 'center' } },
  ];

  const partialRow = features.findIndex(f => f === 'Real-Time Path Adaptation');

  const dataRows = features.map((f, i) => [
    { text: f,   options: { bold: true, color: C.t1,    fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 9.5 } },
    { text: '✗', options: { bold: true, color: C.red,    fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 14, align: 'center' } },
    { text: '✗', options: { bold: true, color: C.red,    fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 14, align: 'center' } },
    i === partialRow
      ? { text: '~', options: { bold: true, color: C.amber,  fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 14, align: 'center' } }
      : { text: '✗', options: { bold: true, color: C.red,    fill: { color: i % 2 === 0 ? C.bg2 : C.bg3 }, fontSize: 14, align: 'center' } },
    { text: '✓', options: { bold: true, color: C.emerald, fill: { color: C.emerald, transparency: 88 }, fontSize: 16, align: 'center' } },
  ]);

  s.addTable([headerRow, ...dataRows], {
    x: 0.3, y: 1.1, w: 12.7,
    colW: [4.4, 2.1, 2.1, 2.1, 2.0],
    border: { pt: 0.75, color: C.border },
    rowH: 0.72,
  });

  // Bottom banner
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0.3, y: 5.75, w: 12.7, h: 0.85,
    fill: { color: C.emerald, transparency: 90 }, line: { color: C.emerald, width: 1.5 }
  });
  s.addText('SkillForge is the only platform that combines autonomous multi-agent AI, adaptive curriculum,\nreal-time market intelligence, and full decision explainability in one system.', {
    x: 0.3, y: 5.75, w: 12.7, h: 0.85,
    fontSize: 10.5, color: C.emerald, italic: true, align: 'center', valign: 'middle', margin: 0
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 13 — ROADMAP
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  sectionTitle(s, 'Roadmap', 'From hackathon prototype to production platform');

  // Timeline line
  const tlY = 2.95;
  s.addShape(pres.shapes.LINE, {
    x: 0.5, y: tlY, w: 12.3, h: 0, line: { color: C.border, width: 2 }
  });

  const phases = [
    {
      x: 0.6, label: 'NOW', labelColor: C.white, circleFill: C.indigo, circleStroke: C.indigo,
      title: 'Hackathon MVP', titleColor: C.indigo,
      items: ['9 autonomous agents live', 'Full adaptive pipeline', 'Vercel deployed', 'Explainability console', 'Career Digital Twin'],
    },
    {
      x: 3.8, label: 'Q3 2025', labelColor: C.t2, circleFill: C.bg2, circleStroke: C.indigo,
      title: 'Platform Expansion', titleColor: C.emerald,
      items: ['Voice-driven goal input', 'GitHub portfolio integration', 'Multi-language support', 'Mobile app (React Native)'],
    },
    {
      x: 7.0, label: 'Q4 2025', labelColor: C.t2, circleFill: C.bg2, circleStroke: C.amber,
      title: 'Enterprise & Integrations', titleColor: C.amber,
      items: ['B2B HR platform APIs', 'Employer skill verification', 'Team learning dashboards', 'LMS integrations'],
    },
    {
      x: 10.2, label: '2026', labelColor: C.t2, circleFill: C.bg2, circleStroke: C.emerald,
      title: 'Autonomous Career OS', titleColor: C.emerald,
      items: ['Fully autonomous career agent', 'Predictive market realignment', 'Cross-domain skill transfer', 'Global workforce intelligence'],
    },
  ];

  phases.forEach(p => {
    const titleColor = p.titleColor;
    const borderColor = p.circleStroke;
    const cardW = 2.8;

    // Timeline circle
    s.addShape(pres.shapes.OVAL, {
      x: p.x + cardW / 2 - 0.32, y: tlY - 0.32, w: 0.64, h: 0.64,
      fill: { color: p.circleFill }, line: { color: p.circleStroke, width: 2 }
    });
    s.addText(p.label, {
      x: p.x + cardW / 2 - 0.32, y: tlY - 0.32, w: 0.64, h: 0.64,
      fontSize: 6.5, color: p.labelColor, bold: true, align: 'center', valign: 'middle', margin: 0
    });

    // Vertical connector line
    s.addShape(pres.shapes.LINE, {
      x: p.x + cardW / 2, y: tlY + 0.32, w: 0, h: 0.52,
      line: { color: borderColor, width: 1 }
    });

    // Phase card
    const cardY = tlY + 0.84;
    s.addShape(pres.shapes.RECTANGLE, {
      x: p.x, y: cardY, w: cardW, h: 3.55,
      fill: { color: C.bg2 }, line: { color: borderColor, width: 1 }
    });
    s.addShape(pres.shapes.RECTANGLE, {
      x: p.x, y: cardY, w: cardW, h: 0.06,
      fill: { color: borderColor }, line: { color: borderColor, width: 0 }
    });
    s.addText(p.title, {
      x: p.x + 0.12, y: cardY + 0.12, w: cardW - 0.24, h: 0.42,
      fontSize: 11, color: titleColor, bold: true, align: 'left', valign: 'middle', margin: 0
    });

    p.items.forEach((item, ii) => {
      s.addShape(pres.shapes.OVAL, {
        x: p.x + 0.15, y: cardY + 0.72 + ii * 0.6, w: 0.1, h: 0.1,
        fill: { color: borderColor }, line: { color: borderColor, width: 0 }
      });
      s.addText(item, {
        x: p.x + 0.35, y: cardY + 0.62 + ii * 0.6, w: cardW - 0.48, h: 0.45,
        fontSize: 8.5, color: C.t2, align: 'left', valign: 'middle', margin: 0
      });
    });
  });

  addFooter(s);
}

// ══════════════════════════════════════════════════════════════════
// SLIDE 14 — THANK YOU
// ══════════════════════════════════════════════════════════════════
{
  const s = pres.addSlide();
  s.background = { color: C.bg };

  // Top accent
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: 13.3, h: 0.04,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 0 }
  });

  // Team badge
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, {
    x: 5.45, y: 0.9, w: 2.4, h: 0.38,
    fill: { color: C.indigo, transparency: 82 }, line: { color: C.indigo, width: 1 }, rectRadius: 0.08
  });
  s.addText('Team AI4AP', {
    x: 5.45, y: 0.9, w: 2.4, h: 0.38,
    fontSize: 10, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0
  });

  // SkillForge
  s.addText('SkillForge', {
    x: 1, y: 1.4, w: 11.3, h: 1.5,
    fontSize: 60, color: C.t1, bold: true, align: 'center', valign: 'middle', fontFace: 'Calibri', margin: 0
  });

  // Accent line
  s.addShape(pres.shapes.RECTANGLE, {
    x: 4.05, y: 2.98, w: 2.6, h: 0.06,
    fill: { color: C.indigo }, line: { color: C.indigo, width: 0 }
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: 6.65, y: 2.98, w: 2.6, h: 0.06,
    fill: { color: C.emerald }, line: { color: C.emerald, width: 0 }
  });

  // Tagline
  s.addText('The future of work demands agents, not apps.', {
    x: 1, y: 3.1, w: 11.3, h: 0.5,
    fontSize: 17, color: C.t2, italic: true, align: 'center', valign: 'middle', fontFace: 'Calibri', margin: 0
  });

  // 3 stats
  const stats = [
    { val: '9',     lbl: 'Autonomous Agents',   x: 2.1  },
    { val: '50/50', lbl: 'Scoring Criteria Met', x: 5.4  },
    { val: 'Live',  lbl: 'Deployed & Running',   x: 9.0  },
  ];

  // Vertical separators
  s.addShape(pres.shapes.LINE, { x: 5.1, y: 3.8, w: 0, h: 1.2, line: { color: C.border, width: 1 } });
  s.addShape(pres.shapes.LINE, { x: 8.6, y: 3.8, w: 0, h: 1.2, line: { color: C.border, width: 1 } });

  stats.forEach(st => {
    s.addText(st.val, {
      x: st.x, y: 3.75, w: 2.8, h: 0.7,
      fontSize: 34, color: C.indigo, bold: true, align: 'center', valign: 'middle', margin: 0
    });
    s.addText(st.lbl, {
      x: st.x, y: 4.45, w: 2.8, h: 0.32,
      fontSize: 9.5, color: C.t3, align: 'center', valign: 'middle', margin: 0
    });
  });

  // Separator
  s.addShape(pres.shapes.LINE, {
    x: 2.5, y: 4.95, w: 8.3, h: 0, line: { color: C.border, width: 0.75 }
  });

  // Links
  s.addText('Deployed on Vercel  |  Built with React 18, Node.js, Gemini AI, Groq LLaMA', {
    x: 1, y: 5.1, w: 11.3, h: 0.32,
    fontSize: 9.5, color: C.t3, align: 'center', valign: 'middle', margin: 0
  });

  // Event label
  s.addText('HackAP Hackathon – Agentic AI  |  Problem 5: Autonomous Skill Acquisition Agent', {
    x: 1, y: 5.5, w: 11.3, h: 0.3,
    fontSize: 9, color: C.t3, italic: true, align: 'center', valign: 'middle', margin: 0
  });

  // Bottom accent
  s.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 7.46, w: 13.3, h: 0.04,
    fill: { color: C.emerald }, line: { color: C.emerald, width: 0 }
  });

  addFooter(s);
}

// ── WRITE FILE ─────────────────────────────────────────────────────
pres.writeFile({ fileName: 'C:\\CODING\\HACKap\\SkillForge-HackAP-Pitch.pptx' })
  .then(() => console.log('[OK] SkillForge-HackAP-Pitch.pptx written'))
  .catch(err => { console.error('[ERROR]', err); process.exit(1); });
