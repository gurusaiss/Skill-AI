import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import GeminiService from '../services/GeminiService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

class SkillDecomposer {
  constructor() {
    const domainsPath = join(__dirname, '../knowledge/domains.json');
    this.domains = JSON.parse(readFileSync(domainsPath, 'utf-8'));

    this.domainKeywords = {
      frontend_development: ['react', 'vue', 'angular', 'frontend', 'html', 'css', 'javascript', 'typescript', 'next.js', 'nuxt', 'tailwind', 'jsx', 'hooks', 'redux', 'sass', 'webpack', 'vite', 'svelte', 'components', 'web development', 'web app'],
      backend_development: ['backend', 'server', 'api', 'database', 'node', 'express', 'rest', 'sql', 'deployment', 'docker', 'python', 'django', 'flask'],
      machine_learning: ['machine learning', 'ml', 'neural', 'model', 'training', 'prediction', 'ai', 'deep learning', 'tensorflow', 'pytorch', 'llm', 'artificial intelligence'],
      ui_ux_design: ['design', 'ui', 'ux', 'interface', 'user experience', 'wireframe', 'prototype', 'figma', 'visual', 'interaction'],
      digital_marketing: ['marketing', 'seo', 'social media', 'content', 'advertising', 'campaign', 'email', 'analytics', 'conversion'],
      data_science: ['data science', 'analytics', 'statistics', 'visualization', 'pandas', 'numpy', 'analysis', 'jupyter', 'data analysis']
    };

    this.domainIcons = {
      frontend_development: '⚛️',
      backend_development: '💻',
      machine_learning: '🧠',
      ui_ux_design: '🎨',
      digital_marketing: '📈',
      data_science: '📊',
      custom: '🚀'
    };

    this.toolKeywords = {
      python: ['python', 'django', 'flask', 'fastapi', 'pandas', 'numpy', 'sklearn'],
      javascript: ['javascript', 'node', 'nodejs', 'express', 'typescript'],
      react: ['react', 'jsx', 'hooks', 'redux', 'next.js', 'vite'],
      vue: ['vue', 'nuxt', 'vuex', 'pinia'],
      css: ['css', 'tailwind', 'sass', 'scss', 'flexbox', 'grid'],
      data: ['sql', 'postgres', 'mysql', 'mongodb', 'analytics', 'dashboard'],
      ml: ['tensorflow', 'pytorch', 'huggingface', 'nlp', 'transformers', 'neural'],
      design: ['figma', 'wireframe', 'prototype', 'typography', 'color'],
      marketing: ['seo', 'email', 'content', 'ads', 'campaign', 'social']
    };
  }

  detectDomain(goalText) {
    const lowerGoal = goalText.toLowerCase();
    const scores = {};

    for (const [domainId, keywords] of Object.entries(this.domainKeywords)) {
      scores[domainId] = 0;
      for (const keyword of keywords) {
        // Use word-boundary matching to avoid "ai" matching inside "tailor", etc.
        const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const pattern = keyword.includes(' ')
          ? new RegExp(escaped, 'i')                    // multi-word: substring ok
          : new RegExp(`\\b${escaped}\\b`, 'i');         // single word: whole word only
        if (pattern.test(lowerGoal)) {
          scores[domainId] += keyword.includes(' ') ? 3 : 1;
        }
      }
    }

    let maxScore = 0;
    let selectedDomain = null;

    for (const [domainId, score] of Object.entries(scores)) {
      if (score > maxScore) {
        maxScore = score;
        selectedDomain = domainId;
      }
    }

    if (maxScore === 0 || selectedDomain === null) return 'dynamic';
    return selectedDomain;
  }

  // ── Gemini-powered universal decomposition ─────────────────────────────────
  async decomposeWithLLM(goalText) {
    const prompt = `You are an expert curriculum architect. A user wants to: "${goalText}"

Build a REAL skill tree for this EXACT domain. Do NOT generate generic or software-development skills unless the goal is explicitly about software/coding.

CORRECT examples:
- "I want to be a Doctor" → skills: Human Anatomy, Physiology & Biochemistry, Pathology & Microbiology, Pharmacology & Therapeutics, Clinical Medicine & Diagnosis
- "I want to be a Lawyer" → skills: Constitutional Law, Contract & Tort Law, Criminal Law & IPC, Civil Procedure & Evidence, Legal Drafting & Practice
- "I want to learn cooking" → skills: Knife Skills & Kitchen Safety, Classical Cooking Methods, Sauce & Flavour Science, Pastry & Baking, Menu Design & Plating
- "I want to learn guitar" → skills: Music Theory & Notation, Chord Shapes & Transitions, Scales & Improvisation, Rhythm & Strumming Patterns, Performance & Song Learning

Return ONLY valid JSON:
{
  "domain": "snake_case_domain_id",
  "domainLabel": "Human Readable Domain Name",
  "domainIcon": "single relevant emoji",
  "profile": {
    "targetRole": "what they want to become (e.g. Doctor, Lawyer, Chef, Engineer)",
    "learnerLevel": "beginner|intermediate|advanced",
    "intensity": "accelerated|balanced|deep",
    "detectedTools": ["real domain tools/instruments/materials"],
    "focusKeywords": ["domain-specific keyword1", "domain-specific keyword2"]
  },
  "skills": [
    {
      "id": "snake_case_skill_id",
      "name": "Real Subject Name (e.g. Human Anatomy, Contract Law, Knife Skills)",
      "description": "What this skill covers and why it is essential to reach the goal",
      "level": "beginner|intermediate|advanced",
      "days": 5,
      "topics": [
        "named real concept 1 (e.g. 'brachial plexus innervation', 'consideration in contract', 'julienne cut technique')",
        "named real concept 2",
        "named real concept 3",
        "named real concept 4",
        "named real concept 5"
      ],
      "reason": "Why this skill is critical for becoming a [targetRole]"
    }
  ],
  "totalEstimatedDays": 35
}

STRICT RULES:
- 4 to 6 skills, ordered foundational → advanced
- Skill names = the REAL subjects taught in this domain (e.g. Anatomy, Pharmacology for Doctor — NOT "Foundations", "Intermediate Level")
- Topics = real named concepts professionals actually know (e.g. "glomerular filtration rate", "mens rea", "mise en place")
- NEVER use generic topic names like "core concepts", "fundamentals overview", "introduction to the field", "basic skills"
- days: 4–10 per skill
- totalEstimatedDays: sum of all skill days
- detectedTools: real instruments/equipment/materials (stethoscope for doctor, lathe for machinist, Figma for designer)`;

    try {
      const result = await GeminiService.generateJSON(prompt,
        `You are an expert curriculum designer for the domain in the user's goal. Return only valid JSON with REAL domain-specific skill names and topic names. Absolutely no generic placeholders.`);

      if (result && result.skills && result.skills.length >= 3) {
        console.log(`[SkillDecomposer] Gemini decomposed "${goalText}" → ${result.domainLabel} (${result.skills.length} skills)`);
        return result;
      }
    } catch (err) {
      console.error('[SkillDecomposer] Gemini error:', err.message);
    }
    return null;
  }

  // Domain-specific topic sets for common non-tech fields
  // Used when Gemini is unavailable so fallback content is realistic
  _getDomainTopics(subjectId, subjectTitle) {
    const s = subjectId.toLowerCase();
    const t = subjectTitle.toLowerCase();

    // Tailoring / Sewing
    if (/tailor|sew|stitch|garment|dressmaker|alterations/.test(s + t)) {
      return {
        foundations: ['seam allowance', 'fabric grain and bias', 'hand stitches (running, backstitch, slip)', 'reading a sewing pattern', 'pressing and ironing seams'],
        practical:   ['cutting fabric on grain', 'inserting a zipper', 'sewing darts and tucks', 'finishing seams (overlock, French seam)', 'hemming techniques'],
        intermediate:['fitting and alterations', 'collar and cuff construction', 'lining a garment', 'pattern grading', 'understanding ease in patterns'],
        advanced:    ['draping on a dress form', 'tailored jacket construction', 'couture hand-finishing', 'creating original patterns', 'professional pressing techniques']
      };
    }
    // Cooking / Chef
    if (/cook|chef|culinary|bak|pastry|kitchen/.test(s + t)) {
      return {
        foundations: ['knife skills and cuts (julienne, brunoise, chiffonade)', 'mise en place', 'heat levels and cooking methods', 'seasoning and taste balance', 'kitchen safety and sanitation'],
        practical:   ['sauté, braise, roast techniques', 'making stocks and sauces (mother sauces)', 'emulsification and vinaigrettes', 'egg cookery', 'pasta and dough fundamentals'],
        intermediate:['Maillard reaction and caramelisation', 'flavor pairing principles', 'advanced sauce work (reduction, velouté)', 'plating and presentation', 'menu planning and costing'],
        advanced:    ['sous vide and modern techniques', 'pastry and laminated doughs', 'fermentation and pickling', 'tasting and critique', 'building a signature dish']
      };
    }
    // Music
    if (/music|guitar|piano|violin|drum|sing|vocal|instrument/.test(s + t)) {
      return {
        foundations: ['notes, scales and octaves', 'rhythm, beat and time signatures', 'treble and bass clef reading', 'major vs minor keys', 'basic chords (triads)'],
        practical:   ['chord progressions (I-IV-V-I)', 'playing in time with a metronome', 'dynamics (piano, forte, crescendo)', 'basic music notation', 'ear training — intervals'],
        intermediate:['modes and modal playing', 'transposing between keys', '7th chords and extensions', 'improvisation basics', 'ensemble playing and listening'],
        advanced:    ['advanced harmony and voice leading', 'composition and arrangement', 'recording and production basics', 'sight-reading', 'performance and stage presence']
      };
    }
    // Photography
    if (/photo|camera|shoot|lighting|portrait|landscape/.test(s + t)) {
      return {
        foundations: ['exposure triangle (ISO, aperture, shutter)', 'composition rules (rule of thirds, leading lines)', 'camera modes (manual, aperture priority)', 'understanding focal lengths', 'white balance and color temperature'],
        practical:   ['portrait lighting setups', 'depth of field control', 'freezing vs blurring motion', 'histogram reading', 'RAW vs JPEG'],
        intermediate:['off-camera flash and modifiers', 'post-processing in Lightroom/Camera Raw', 'focus modes and tracking', 'bracketing and HDR', 'color grading basics'],
        advanced:    ['studio lighting ratios', 'advanced Photoshop compositing', 'tethered shooting workflow', 'building a photography portfolio', 'client and contract basics']
      };
    }
    // Fitness / Training
    if (/fitness|workout|gym|yoga|exercise|train|bodybuilding|weight/.test(s + t)) {
      return {
        foundations: ['compound movements (squat, deadlift, press)', 'sets, reps and progressive overload', 'warm-up and cool-down protocols', 'macronutrients and caloric balance', 'rest and recovery basics'],
        practical:   ['proper squat form and cues', 'deadlift technique and safety', 'push/pull workout splits', 'cardiovascular training zones', 'mobility and flexibility work'],
        intermediate:['periodisation and training cycles', 'tracking and adjusting load', 'hypertrophy vs strength protocols', 'injury prevention and prehab', 'reading body composition metrics'],
        advanced:    ['peak week and competition prep', 'advanced nutrition strategies', 'programming for plateaus', 'coaching cues and feedback', 'sport-specific conditioning']
      };
    }
    // Language learning
    if (/spanish|french|german|japanese|mandarin|chinese|arabic|language|speak|fluent/.test(s + t)) {
      return {
        foundations: ['alphabet and pronunciation rules', 'core vocabulary (100 high-frequency words)', 'present tense conjugations', 'basic sentence structure (SVO)', 'greetings and everyday phrases'],
        practical:   ['past and future tenses', 'question formation', 'numbers, dates and time', 'vocabulary for shopping, travel, food', 'listening practice with native audio'],
        intermediate:['subjunctive and conditional moods', 'complex sentence connectors', 'reading authentic texts', 'idiomatic expressions', 'speaking fluency drills'],
        advanced:    ['advanced grammar nuances', 'regional dialects and slang', 'academic and professional writing', 'debate and persuasion in target language', 'C1/C2 exam preparation']
      };
    }
    // Drawing / Art
    if (/draw|paint|sketch|illustrat|art|watercolor|portrait|figure/.test(s + t)) {
      return {
        foundations: ['line control and mark-making', 'perspective (1-point, 2-point)', 'basic shapes and form', 'light and shadow (value scale)', 'proportion and measurement'],
        practical:   ['shading techniques (hatching, blending)', 'sketching from observation', 'gesture drawing', 'color mixing (primary, secondary)', 'composition basics'],
        intermediate:['portrait anatomy (facial proportions)', 'figure drawing and anatomy', 'digital drawing tools', 'color theory and harmony', 'texture rendering'],
        advanced:    ['character design and stylisation', 'storytelling through illustration', 'developing a personal style', 'portfolio curation', 'client brief and commercial work']
      };
    }

    // Medicine / Doctor
    if (/doctor|mbbs|medicine|medical|physician|surgeon|clinical|anatomy|physiology|pathology|pharmacology|healthcare/.test(s + t)) {
      return {
        foundations: ['human anatomy (skeletal, muscular, nervous systems)', 'cell biology and histology', 'medical terminology and nomenclature', 'physiology (cardiovascular, respiratory, renal)', 'biochemistry — enzymes, metabolism, genetics'],
        practical:   ['clinical examination skills (inspection, palpation, percussion, auscultation)', 'reading and interpreting ECG', 'blood pressure measurement and vitals assessment', 'interpreting lab reports (CBC, LFT, KFT, lipid profile)', 'patient history taking (SOAP format)'],
        intermediate:['pathology — disease mechanisms and tissue changes', 'pharmacology — drug classes, mechanisms, side effects', 'microbiology — bacteria, viruses, fungi, parasites', 'radiology basics — X-ray, CT, MRI interpretation', 'clinical diagnosis — differential diagnosis formulation'],
        advanced:    ['clinical medicine — internal medicine, surgery, OB-GYN, pediatrics', 'emergency medicine and trauma protocols (ATLS, ACLS)', 'surgical techniques and sterile field principles', 'evidence-based medicine and clinical trials', 'medical ethics, consent, and medicolegal issues']
      };
    }
    // Law / Legal Studies
    if (/\blaw\b|lawyer|legal|llb|attorney|advocate|judiciary|constitution|legal studies/.test(s + t)) {
      return {
        foundations: ['sources of law — legislation, case law, custom, equity', 'Indian Constitution — fundamental rights, directive principles', 'Contract Act 1872 — offer, acceptance, consideration, capacity', 'legal terminology — jurisdiction, locus standi, res judicata, estoppel', 'court hierarchy — district courts, high courts, Supreme Court'],
        practical:   ['drafting legal notices and plaints', 'reading and analyzing bare acts and judgments', 'IPC 1860 — crimes against person, property, state', 'Consumer Protection Act — filing consumer complaints', 'family law — marriage, divorce, maintenance, inheritance'],
        intermediate:['Code of Civil Procedure (CPC) — suits, appeals, revision', 'Code of Criminal Procedure (CrPC) — FIR, bail, trial stages', 'law of evidence — admissibility, burden of proof, witness examination', 'property law — transfer of property, easements, mortgages', 'company law — incorporation, directors, winding up'],
        advanced:    ['constitutional litigation and public interest law (PIL)', 'arbitration and alternative dispute resolution (ADR)', 'intellectual property law — patents, copyright, trademarks', 'taxation law — direct and indirect taxes, GST framework', 'international law — treaties, WTO, human rights conventions']
      };
    }
    // Civil Engineering
    if (/civil engineering|structural|construction|concrete|rcc|surveying|geotechnical|highway|rebar/.test(s + t)) {
      return {
        foundations: ['engineering mechanics — statics, free body diagrams, equilibrium', 'mechanics of materials — stress, strain, Young\'s modulus', 'fluid mechanics — flow types, Bernoulli\'s theorem, pipe flow', 'surveying — levelling, theodolite, contour mapping, EDM', 'engineering drawing and AutoCAD basics'],
        practical:   ['concrete mix design — IS 10262, water-cement ratio, workability', 'reinforcement detailing — cover, bar bending schedule, hooks', 'soil testing — Proctor compaction, CBR, shear strength parameters', 'construction materials — cement grades, steel types (Fe415/500)', 'site supervision — shuttering, pouring, curing, de-shuttering'],
        intermediate:['structural analysis — beams, columns, slabs, frames', 'RCC design — IS 456, limit state design, BM and SF diagrams', 'foundation engineering — footings, piles, raft foundations', 'highway engineering — pavement design, IRC standards', 'water supply and sanitation engineering'],
        advanced:    ['advanced structural design — multi-storey frames, seismic design (IS 1893)', 'pre-stressed concrete — pre-tensioning, post-tensioning', 'project management — CPM, PERT, cost estimation, BOQ', 'environmental engineering — wastewater treatment, EIA', 'infrastructure project tendering and contracts (FIDIC)']
      };
    }
    // Finance / Accounting
    if (/\bfinance\b|accounting|investment|stock|balance sheet|equity|valuation|portfolio|ca\b|chartered accountant|cfa|financial/.test(s + t)) {
      return {
        foundations: ['accounting equation — assets, liabilities, equity', 'double-entry bookkeeping — debit, credit, journal entries', 'financial statements — P&L, balance sheet, cash flow statement', 'time value of money — PV, FV, NPV, IRR', 'basic taxation — income tax slabs, TDS, GST overview'],
        practical:   ['ratio analysis — liquidity, profitability, leverage, efficiency ratios', 'budgeting and variance analysis', 'working capital management — receivables, payables, inventory cycle', 'bank reconciliation and trial balance preparation', 'reading annual reports and investor presentations'],
        intermediate:['financial modelling — DCF valuation, 3-statement model', 'equity research — P/E, EV/EBITDA, comparable company analysis', 'cost accounting — absorption, marginal, standard costing', 'investment analysis — bonds, equities, mutual funds, derivatives basics', 'corporate finance — capital structure, WACC, dividend policy'],
        advanced:    ['advanced valuation — LBO, merger modelling, precedent transactions', 'derivatives and risk management — options, futures, hedging strategies', 'portfolio management — CAPM, MPT, factor models, portfolio optimization', 'audit and assurance — audit planning, risk assessment, audit evidence', 'regulatory framework — SEBI, RBI, Companies Act 2013, Ind AS/IFRS']
      };
    }

    // Generic fallback for anything else
    const subj = subjectTitle;
    return {
      foundations: [`history and origins of ${subj}`, `essential tools and materials`, `core vocabulary and terminology`, `foundational principles of ${subj}`, `first practice exercise`],
      practical:   [`common beginner techniques`, `hands-on projects for ${subj}`, `avoiding typical mistakes`, `developing core skills`, `guided practice routines`],
      intermediate:[`intermediate methods and approaches`, `workflow and process refinement`, `quality standards in ${subj}`, `solving common problems`, `real-world application scenarios`],
      advanced:    [`professional-level techniques`, `advanced creative problem-solving`, `building a ${subj} portfolio`, `industry best practices`, `mentoring and teaching ${subj}`]
    };
  }

  buildDynamicDomain(goalText, profile) {
    const lowerGoal = goalText.toLowerCase();
    const learnMatch = lowerGoal.match(
      /(?:learn|master|study|understand|explore|get into|practice|become good at|become a|become an)\s+(?:to\s+)?([a-z0-9#.+\s]+?)(?:\s+(?:from scratch|for beginners?|as a beginner|professionally|quickly|well|deeply))?(?:\s+and\s+.*)?$/
    );

    let subject = learnMatch?.[1]?.trim() || goalText;
    const stopwords = new Set(['i', 'want', 'to', 'the', 'a', 'an', 'and', 'or', 'how', 'make', 'create', 'write', 'use', 'with', 'be', 'do']);
    subject = subject.split(/\s+/).filter(w => !stopwords.has(w)).join(' ')
      .replace(/[^\w\s#.+]/g, '').trim().slice(0, 40);

    const subjectId = subject.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '');
    const subjectTitle = subject.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    const level = profile?.learnerLevel || 'beginner';
    const domainTopics = this._getDomainTopics(subjectId, subjectTitle);

    return {
      id: 'custom',
      name: subjectTitle,
      skills: [
        {
          id: `${subjectId}_foundations`,
          name: `${subjectTitle} Foundations`,
          description: `Core concepts and hands-on basics to begin learning ${subjectTitle}.`,
          level: 'beginner', days: 4,
          topics: domainTopics.foundations
        },
        {
          id: `${subjectId}_practical`,
          name: `Practical ${subjectTitle}`,
          description: `Apply ${subjectTitle} through hands-on techniques and real exercises.`,
          level: level === 'advanced' ? 'intermediate' : level, days: 5,
          topics: domainTopics.practical
        },
        {
          id: `${subjectId}_intermediate`,
          name: `Intermediate ${subjectTitle}`,
          description: `Go deeper with intermediate patterns, quality and workflow.`,
          level: 'intermediate', days: 4,
          topics: domainTopics.intermediate
        },
        {
          id: `${subjectId}_advanced`,
          name: `Advanced ${subjectTitle}`,
          description: `Professional-level ${subjectTitle} techniques and best practices.`,
          level: 'advanced', days: 4,
          topics: domainTopics.advanced
        }
      ]
    };
  }

  parseGoalProfile(goalText, domainId) {
    const lowerGoal = goalText.toLowerCase();
    const cleanedGoal = lowerGoal.replace(/[^a-z0-9\s/+.-]/g, ' ');
    const focusKeywords = [...new Set(cleanedGoal.split(/\s+/).filter(w => w.length > 2))];
    const detectedTools = [];

    for (const [, keywords] of Object.entries(this.toolKeywords)) {
      for (const keyword of keywords) {
        if (lowerGoal.includes(keyword)) detectedTools.push(keyword);
      }
      if (detectedTools.length >= 6) break;
    }

    return {
      rawGoal: goalText,
      targetRole: this.extractTargetRole(lowerGoal, domainId),
      learnerLevel: this.detectLearnerLevel(lowerGoal),
      intensity: this.detectIntensity(lowerGoal),
      detectedTools: [...new Set(detectedTools)].slice(0, 6),
      focusKeywords,
      domainId
    };
  }

  extractTargetRole(lowerGoal, domainId) {
    const rolePatterns = [
      /become (?:a|an)?\s+([a-z0-9\s/+.-]+?)(?: developer| engineer| scientist| designer| marketer| tailor| chef| musician)?(?:$| with| in)/,
      /learn (?:to )?([a-z0-9\s/+.-]+?)(?:$| with| in)/,
      /master ([a-z0-9\s/+.-]+?)(?:$| with| in)/
    ];
    for (const pattern of rolePatterns) {
      const match = lowerGoal.match(pattern);
      if (match?.[1]) return match[1].trim();
    }
    const domainNames = {
      backend_development: 'backend developer', machine_learning: 'ML engineer',
      ui_ux_design: 'UX designer', digital_marketing: 'digital marketer', data_science: 'data scientist'
    };
    return domainNames[domainId] || 'specialist';
  }

  detectLearnerLevel(lowerGoal) {
    if (/(beginner|from scratch|new to|no experience|never|just starting)/.test(lowerGoal)) return 'beginner';
    if (/(advanced|expert|master|deeper|production|professional)/.test(lowerGoal)) return 'advanced';
    return 'intermediate';
  }

  detectIntensity(lowerGoal) {
    if (/(quickly|fast|urgent|asap|soon|rapid)/.test(lowerGoal)) return 'accelerated';
    if (/(thorough|deep|complete|mastery|comprehensive)/.test(lowerGoal)) return 'deep';
    return 'balanced';
  }

  personalizeSkills(domain, profile) {
    const prioritized = domain.skills.map((skill, index) => {
      const searchText = `${skill.name} ${skill.description} ${(skill.topics || []).join(' ')}`.toLowerCase();
      let relevanceScore = 0;
      for (const kw of profile.focusKeywords) {
        if (searchText.includes(kw)) relevanceScore += kw.length > 5 ? 3 : 2;
      }
      for (const tool of profile.detectedTools) {
        if (searchText.includes(tool)) relevanceScore += 4;
      }
      if (profile.targetRole && searchText.includes(profile.targetRole)) relevanceScore += 5;

      return {
        ...skill,
        topics: this.personalizeTopics(skill.topics || [], profile),
        days: this.personalizeDays(skill.days, relevanceScore, profile.intensity),
        relevanceScore,
        reason: this.buildSkillReason(skill, profile, relevanceScore),
        recommendedFor: profile.targetRole,
        sequenceHint: index + 1
      };
    });

    return prioritized.sort((a, b) => {
      if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
      return a.days - b.days;
    });
  }

  personalizeTopics(topics, profile) {
    const matched = topics.filter(t =>
      profile.focusKeywords.some(kw => t.toLowerCase().includes(kw)) ||
      profile.detectedTools.some(tool => t.toLowerCase().includes(tool))
    );
    const remaining = topics.filter(t => !matched.includes(t));
    return [...matched, ...remaining];
  }

  personalizeDays(baseDays, relevanceScore, intensity) {
    let days = baseDays;
    if (relevanceScore >= 8) days += 1;
    if (relevanceScore >= 14) days += 1;
    if (intensity === 'accelerated') days = Math.max(1, days - 1);
    if (intensity === 'deep') days += 1;
    return days;
  }

  buildSkillReason(skill, profile, relevanceScore) {
    if (relevanceScore <= 0) return `Foundation for becoming a ${profile.targetRole}.`;
    const matchingTopic = (skill.topics || []).find(t =>
      profile.focusKeywords.some(kw => t.toLowerCase().includes(kw)) ||
      profile.detectedTools.some(tool => t.toLowerCase().includes(tool))
    );
    if (matchingTopic) return `Prioritized because your goal mentions "${matchingTopic}" and directly aligns with ${skill.name}.`;
    return `Critical skill for your ${profile.targetRole} goal.`;
  }

  // ── Main entry point — tries Gemini first, falls back to rule-based ────────
  async decompose(goalText) {
    // Try Gemini first (handles ANY domain on earth)
    if (GeminiService.isEnabled()) {
      const llmResult = await this.decomposeWithLLM(goalText);
      if (llmResult) {
        const profile = {
          rawGoal: goalText,
          targetRole: llmResult.profile?.targetRole || 'specialist',
          learnerLevel: llmResult.profile?.learnerLevel || 'intermediate',
          intensity: llmResult.profile?.intensity || 'balanced',
          detectedTools: llmResult.profile?.detectedTools || [],
          focusKeywords: llmResult.profile?.focusKeywords || [],
          domainId: llmResult.domain
        };
        const skills = (llmResult.skills || []).map((s, i) => ({
          ...s,
          reason: s.reason || `Core skill for ${llmResult.domainLabel}`,
          sequenceHint: i + 1,
          relevanceScore: 10 - i
        }));
        return {
          domain: llmResult.domain || 'custom',
          domainName: llmResult.domainLabel || llmResult.domain,
          domainIcon: llmResult.domainIcon || '🚀',
          profile,
          skills
        };
      }
    }

    // Rule-based fallback
    const domainId = this.detectDomain(goalText);

    if (domainId === 'dynamic') {
      const profile = this.parseGoalProfile(goalText, 'custom');
      const dynamicDomain = this.buildDynamicDomain(goalText, profile);
      return {
        domain: 'custom',
        domainName: dynamicDomain.name,
        domainIcon: '🚀',
        profile,
        skills: this.personalizeSkills(dynamicDomain, profile)
      };
    }

    const domain = this.domains[domainId];
    if (!domain) throw new Error(`Domain not found: ${domainId}`);

    const profile = this.parseGoalProfile(goalText, domainId);
    return {
      domain: domainId,
      domainName: domain.name,
      domainIcon: this.domainIcons[domainId] || '🚀',
      profile,
      skills: this.personalizeSkills(domain, profile)
    };
  }

  getDomainIcon(domainId) {
    return this.domainIcons[domainId] || '🚀';
  }
}

export default SkillDecomposer;
