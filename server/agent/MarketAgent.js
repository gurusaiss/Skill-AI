/**
 * MarketAgent.js — Real-Time Market Intelligence Engine
 * Provides skill demand trends, job market data, competitive analysis
 * LLM-powered with rule-based fallback
 */

import GeminiService from '../services/GeminiService.js';

const MARKET_SNAPSHOTS = {
  full_stack: {
    demandScore: 92, trend: '+12% YoY', openJobs: '185,000+', avgSalary: '$115,000',
    topSkills: ['React', 'Node.js', 'TypeScript', 'PostgreSQL', 'Docker'],
    risingSkills: ['Bun.js', 'htmx', 'Rust for WASM', 'Edge computing'],
    companies: ['Meta', 'Google', 'Stripe', 'Shopify', 'Vercel'],
    insights: [
      'AI-assisted coding is table stakes — GitHub Copilot proficiency expected',
      'TypeScript has overtaken plain JavaScript in enterprise hiring',
      'System design interview weighting increased by 40% since 2023',
    ],
  },
  frontend: {
    demandScore: 88, trend: '+8% YoY', openJobs: '95,000+', avgSalary: '$105,000',
    topSkills: ['React', 'Next.js', 'TypeScript', 'Tailwind CSS', 'Testing'],
    risingSkills: ['React Server Components', 'Astro', 'Web Components', 'WebAssembly'],
    companies: ['Airbnb', 'Figma', 'Linear', 'Notion', 'Atlassian'],
    insights: [
      'React remains dominant but Server Components require architectural rethinking',
      'Performance optimization skills now required at all levels',
      'Accessibility (WCAG) compliance becoming legally mandated at many companies',
    ],
  },
  data_science: {
    demandScore: 95, trend: '+31% YoY', openJobs: '220,000+', avgSalary: '$135,000',
    topSkills: ['Python', 'PyTorch', 'SQL', 'Statistics', 'Data Visualization'],
    risingSkills: ['LLM Fine-tuning', 'MLOps', 'Vector Databases', 'Multimodal AI'],
    companies: ['OpenAI', 'Anthropic', 'Google DeepMind', 'Tesla', 'Bloomberg'],
    insights: [
      'LLM experience has become the single highest-signal differentiator in 2025',
      'Data engineers now earn more than data scientists at many companies',
      'Causal ML and interpretability skills are emerging premium differentiators',
    ],
  },
  machine_learning: {
    demandScore: 97, trend: '+45% YoY', openJobs: '145,000+', avgSalary: '$165,000',
    topSkills: ['PyTorch', 'Transformers', 'CUDA', 'MLOps', 'Distributed Training'],
    risingSkills: ['RLHF', 'Constitutional AI', 'Mixture of Experts', 'Quantization'],
    companies: ['OpenAI', 'Anthropic', 'xAI', 'Mistral', 'Cohere'],
    insights: [
      'The gap between ML researchers and ML engineers is narrowing rapidly',
      'Fine-tuning and RAG expertise commanding $200k+ in competitive markets',
      'GPU programming (CUDA/Triton) skills are extremely scarce and highly valued',
    ],
  },
  devops: {
    demandScore: 90, trend: '+18% YoY', openJobs: '125,000+', avgSalary: '$140,000',
    topSkills: ['Kubernetes', 'Terraform', 'AWS/GCP/Azure', 'CI/CD', 'Observability'],
    risingSkills: ['Platform Engineering', 'eBPF', 'Wasm on the edge', 'GitOps'],
    companies: ['Datadog', 'HashiCorp', 'CNCF members', 'Netflix', 'Cloudflare'],
    insights: [
      'Platform Engineering is replacing "DevOps" as the job title in large enterprises',
      'FinOps skills (cloud cost optimization) now a distinct hiring category',
      'Security-as-code and supply chain security skills are rapidly growing',
    ],
  },
  medicine: {
    demandScore: 89, trend: '+5% YoY', openJobs: '75,000+', avgSalary: '$230,000',
    topSkills: ['Clinical Diagnosis', 'Patient Communication', 'Evidence-Based Medicine', 'EMR Systems', 'Pharmacology'],
    risingSkills: ['AI-assisted Diagnostics', 'Telemedicine', 'Genomic Medicine', 'Precision Medicine'],
    companies: ['Mayo Clinic', 'Cleveland Clinic', 'Kaiser Permanente', 'Johns Hopkins', 'Mass General'],
    insights: [
      'AI diagnostic tools (radiology, pathology) are augmenting but not replacing physicians',
      'Hospitalist medicine growing fastest due to aging demographics',
      'Telehealth skills now required in most residency programs',
    ],
  },
  law: {
    demandScore: 82, trend: '+3% YoY', openJobs: '45,000+', avgSalary: '$145,000',
    topSkills: ['Contract Drafting', 'Litigation', 'Legal Research', 'Negotiation', 'Regulatory Compliance'],
    risingSkills: ['AI/Data Privacy Law', 'Crypto/Blockchain Regulation', 'Legal Tech', 'ESG Compliance'],
    companies: ['Kirkland & Ellis', 'Skadden', 'Cravath', 'BigLaw firms', 'In-house Tech Cos'],
    insights: [
      'AI and data privacy law is the fastest-growing practice area globally',
      'Legal tech fluency (contract AI, e-discovery) increasingly required',
      'In-house counsel roles at tech companies growing 3x faster than law firm roles',
    ],
  },
  cybersecurity: {
    demandScore: 94, trend: '+28% YoY', openJobs: '160,000+', avgSalary: '$148,000',
    topSkills: ['Penetration Testing', 'Cloud Security', 'SIEM/SOAR', 'Zero Trust Architecture', 'Compliance'],
    risingSkills: ['AI Red-teaming', 'Kubernetes Security', 'Supply Chain Security', 'Quantum-safe Cryptography'],
    companies: ['CrowdStrike', 'Palo Alto Networks', 'SentinelOne', 'Mandiant/Google', 'Recorded Future'],
    insights: [
      'Cybersecurity talent gap is 3.4 million globally — demand far exceeds supply',
      'Cloud security expertise commands 25% salary premium over traditional security',
      'AI-powered attacks are driving urgent demand for AI security specialists',
    ],
  },
};

const DEFAULT_MARKET = {
  demandScore: 75, trend: '+8% YoY', openJobs: '50,000+', avgSalary: '$90,000',
  topSkills: ['Domain Expertise', 'Communication', 'Problem Solving', 'Data Analysis', 'Project Management'],
  risingSkills: ['AI Integration', 'Data Literacy', 'Remote Collaboration', 'Automation Tools'],
  companies: ['Fortune 500 companies', 'Growing startups', 'Consulting firms'],
  insights: [
    'Cross-functional AI literacy is becoming a baseline expectation across all roles',
    'Professionals who combine domain expertise with data skills command premium salaries',
    'Remote work has expanded the competitive landscape — now competing globally',
  ],
};

class MarketAgent {
  async getIntelligence({ domain, goal, skills }) {
    // Try LLM for personalized market data
    const llmData = await this._getWithLLM({ domain, goal, skills });
    if (llmData) return { ...llmData, _source: 'llm' };

    // Rule-based fallback
    const snapshot = MARKET_SNAPSHOTS[domain] || DEFAULT_MARKET;
    return {
      domain,
      goal,
      ...snapshot,
      skillGapAnalysis: this._analyzeSkillGap(skills, snapshot.topSkills),
      opportunityScore: snapshot.demandScore,
      marketSummary: `The ${domain} market shows ${snapshot.trend} growth with ${snapshot.openJobs} open positions globally. Average compensation is ${snapshot.avgSalary}. Key differentiators include ${snapshot.risingSkills.slice(0, 2).join(' and ')}.`,
      _source: 'rule-based',
    };
  }

  async _getWithLLM({ domain, goal, skills }) {
    const prompt = `You are a market intelligence agent analyzing career opportunities.

Goal: "${goal}"
Domain: ${domain}
Current skills: ${(skills || []).slice(0, 5).join(', ') || 'entry level'}

Return ONLY valid JSON:
{
  "demandScore": 88,
  "trend": "+15% YoY",
  "openJobs": "120,000+",
  "avgSalary": "$115,000",
  "topSkills": ["skill1", "skill2", "skill3", "skill4", "skill5"],
  "risingSkills": ["emerging1", "emerging2", "emerging3"],
  "companies": ["Company1", "Company2", "Company3", "Company4"],
  "insights": [
    "Specific market insight 1 relevant to ${domain}",
    "Specific market insight 2",
    "Specific market insight 3"
  ],
  "skillGapAnalysis": [
    { "skill": "skill name", "userLevel": 45, "marketRequirement": 80, "gap": 35, "priority": "high" }
  ],
  "opportunityScore": 85,
  "marketSummary": "2-3 sentence personalized market summary for this goal",
  "salaryProgression": [
    { "level": "Junior", "years": "0-2", "salary": "$70,000-$90,000" },
    { "level": "Mid", "years": "2-5", "salary": "$90,000-$130,000" },
    { "level": "Senior", "years": "5-8", "salary": "$130,000-$180,000" },
    { "level": "Staff/Principal", "years": "8+", "salary": "$180,000-$300,000+" }
  ]
}

Use real, current market data. Be specific and accurate.`;

    try {
      const result = await GeminiService.generateJSON(prompt,
        'You are a precise market intelligence engine. Return current, accurate career market data as JSON.');
      if (result?.demandScore) {
        console.log(`[MarketAgent] LLM intelligence generated for "${domain}"`);
        return result;
      }
    } catch (err) {
      console.error('[MarketAgent] LLM error:', err.message);
    }
    return null;
  }

  _analyzeSkillGap(userSkills, marketSkills) {
    return marketSkills.map((skill, i) => ({
      skill,
      userLevel: userSkills?.some(s => s.toLowerCase().includes(skill.toLowerCase())) ? 75 : Math.max(10, 50 - i * 8),
      marketRequirement: 80,
      gap: userSkills?.some(s => s.toLowerCase().includes(skill.toLowerCase())) ? 5 : Math.min(70, 30 + i * 8),
      priority: i < 2 ? 'critical' : i < 4 ? 'high' : 'medium',
    }));
  }

  getSkillTrends(domain) {
    const snapshot = MARKET_SNAPSHOTS[domain] || DEFAULT_MARKET;
    return {
      hot: snapshot.risingSkills,
      established: snapshot.topSkills,
      declining: this._getDecliningSkills(domain),
    };
  }

  _getDecliningSkills(domain) {
    const declining = {
      full_stack: ['jQuery', 'Backbone.js', 'CoffeeScript', 'Bower'],
      data_science: ['Hadoop MapReduce', 'Pig Latin', 'Traditional BI tools'],
      devops: ['Physical server management', 'Bare-metal deployments', 'Ansible alone'],
      default: ['Legacy frameworks', 'Manual deployment', 'Monolithic architecture'],
    };
    return declining[domain] || declining.default;
  }
}

export default new MarketAgent();
