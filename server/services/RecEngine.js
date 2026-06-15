/**
 * RecEngine.js — Collaborative Filtering + Cosine Similarity
 *
 * Algorithm:
 *  1. Pull all assessment_reports from Supabase → build user-skill matrix
 *  2. Augment with 30 synthetic "archetype" users so the system works
 *     even with zero real assessment data (demo-ready)
 *  3. For the target user: cosine-similarity against every other user
 *  4. Top-K neighbours → weighted average peer skill scores
 *  5. Recommend skills where (a) the user is weak (<75%) and
 *     (b) similar peers are strong (>45%)
 *  6. Score = gap × peer_strength × (0.5 + avg_similarity × 0.5)
 *
 * No external dependencies — all math is native JS.
 */

import { Reports } from './DataStore.js';

// ── Canonical skill taxonomy ───────────────────────────────────────────────────
export const SKILLS = [
  'Python', 'SQL', 'Statistics', 'Linear Algebra',
  'Machine Learning', 'NLP', 'Deep Learning',
  'Data Visualization', 'Feature Engineering', 'Model Evaluation',
  'Communication', 'Leadership', 'Problem Solving',
  'Excel', 'JavaScript', 'Cloud Computing',
];

const SKILL_DOMAINS = {
  Python: 'programming',     SQL: 'data',             JavaScript: 'programming',
  Statistics: 'mathematics', 'Linear Algebra': 'mathematics',
  'Machine Learning': 'ml',  NLP: 'ml',               'Deep Learning': 'ml',
  'Data Visualization': 'data', 'Feature Engineering': 'ml',
  'Model Evaluation': 'ml',  Communication: 'soft skills',
  Leadership: 'soft skills', 'Problem Solving': 'soft skills',
  Excel: 'data',             'Cloud Computing': 'infrastructure',
};

// Map raw skill strings (from LLM-generated assessments) → canonical name
function normalizeSkill(raw) {
  const s = (raw || '').toLowerCase().trim();
  const map = [
    ['python',             'Python'],
    ['sql',                'SQL'],
    ['structured query',   'SQL'],
    ['statistics',         'Statistics'],
    ['probability',        'Statistics'],
    ['linear algebra',     'Linear Algebra'],
    ['algebra',            'Linear Algebra'],
    ['machine learning',   'Machine Learning'],
    [' ml ',               'Machine Learning'],
    ['deep learning',      'Deep Learning'],
    ['neural',             'Deep Learning'],
    ['nlp',                'NLP'],
    ['natural language',   'NLP'],
    ['data visual',        'Data Visualization'],
    ['visualization',      'Data Visualization'],
    ['tableau',            'Data Visualization'],
    ['feature engineer',   'Feature Engineering'],
    ['model eval',         'Model Evaluation'],
    ['evaluation',         'Model Evaluation'],
    ['communication',      'Communication'],
    ['leadership',         'Leadership'],
    ['problem solv',       'Problem Solving'],
    ['excel',              'Excel'],
    ['javascript',         'JavaScript'],
    [' js ',               'JavaScript'],
    ['cloud',              'Cloud Computing'],
    ['aws',                'Cloud Computing'],
    ['azure',              'Cloud Computing'],
    ['gcp',                'Cloud Computing'],
  ];
  for (const [kw, canonical] of map) {
    if (s.includes(kw)) return canonical;
  }
  return null;
}

function skillId(name) {
  return name.toLowerCase().replace(/ /g, '_');
}

// ── 30 synthetic archetype users ──────────────────────────────────────────────
// Ensures recommendations work even with 0 real assessment data.
// Each represents a common ML learner profile.
const SYNTHETIC_USERS = [
  { id: 'syn_ml_beginner',      v: { Python:0.7, Statistics:0.4, 'Machine Learning':0.3, 'Linear Algebra':0.3, SQL:0.5 } },
  { id: 'syn_data_scientist',   v: { Python:0.9, SQL:0.85, Statistics:0.85, 'Data Visualization':0.75, 'Machine Learning':0.8, 'Model Evaluation':0.7 } },
  { id: 'syn_nlp_engineer',     v: { Python:0.85, NLP:0.9, 'Deep Learning':0.8, 'Machine Learning':0.75, Statistics:0.6, 'Linear Algebra':0.65 } },
  { id: 'syn_backend_to_ml',    v: { Python:0.9, SQL:0.8, JavaScript:0.85, 'Machine Learning':0.3, 'Linear Algebra':0.4, Statistics:0.35 } },
  { id: 'syn_analytics_expert', v: { SQL:0.95, Excel:0.85, 'Data Visualization':0.85, Statistics:0.75, 'Feature Engineering':0.55 } },
  { id: 'syn_math_grad',        v: { Statistics:0.9, 'Linear Algebra':0.9, 'Machine Learning':0.6, Python:0.55, 'Model Evaluation':0.65 } },
  { id: 'syn_dl_specialist',    v: { Python:0.85, 'Deep Learning':0.9, NLP:0.7, 'Machine Learning':0.8, 'Linear Algebra':0.75, Statistics:0.65 } },
  { id: 'syn_mlops',            v: { Python:0.8, 'Cloud Computing':0.85, 'Machine Learning':0.65, SQL:0.6, 'Model Evaluation':0.75, 'Feature Engineering':0.7 } },
  { id: 'syn_fe_dev_to_ml',     v: { JavaScript:0.9, Python:0.6, 'Machine Learning':0.25, SQL:0.5, Statistics:0.3 } },
  { id: 'syn_rec_sys_builder',  v: { Python:0.8, 'Machine Learning':0.8, SQL:0.75, Statistics:0.7, 'Feature Engineering':0.8, 'Model Evaluation':0.75 } },
  { id: 'syn_cv_engineer',      v: { Python:0.85, 'Deep Learning':0.85, 'Machine Learning':0.75, 'Linear Algebra':0.8, Statistics:0.6 } },
  { id: 'syn_data_analyst',     v: { SQL:0.9, Excel:0.8, 'Data Visualization':0.75, Statistics:0.6, Python:0.5 } },
  { id: 'syn_researcher',       v: { Statistics:0.85, 'Machine Learning':0.8, Python:0.75, 'Linear Algebra':0.85, 'Model Evaluation':0.8, 'Deep Learning':0.55 } },
  { id: 'syn_product_mgr_ml',   v: { Communication:0.9, Leadership:0.8, 'Problem Solving':0.85, 'Machine Learning':0.35, Python:0.3 } },
  { id: 'syn_sql_expert',       v: { SQL:0.95, 'Data Visualization':0.7, Statistics:0.65, Excel:0.7, 'Feature Engineering':0.5, Python:0.45 } },
  { id: 'syn_cloud_ml',         v: { 'Cloud Computing':0.9, Python:0.75, 'Machine Learning':0.7, SQL:0.6, 'Model Evaluation':0.65 } },
  { id: 'syn_stats_transitioning', v: { Statistics:0.8, 'Linear Algebra':0.75, Python:0.55, 'Machine Learning':0.5, Excel:0.7 } },
  { id: 'syn_junior_ds',        v: { Python:0.65, SQL:0.6, Statistics:0.55, 'Machine Learning':0.45, 'Data Visualization':0.5 } },
  { id: 'syn_senior_ml',        v: { Python:0.9, 'Machine Learning':0.95, 'Feature Engineering':0.9, 'Model Evaluation':0.9, Statistics:0.85, 'Linear Algebra':0.8 } },
  { id: 'syn_fullstack_ml',     v: { Python:0.8, JavaScript:0.8, SQL:0.7, 'Machine Learning':0.55, 'Cloud Computing':0.6 } },
  { id: 'syn_nlp_beginner',     v: { Python:0.7, NLP:0.5, Statistics:0.5, 'Machine Learning':0.45, 'Linear Algebra':0.4 } },
  { id: 'syn_rl_learner',       v: { Python:0.8, 'Machine Learning':0.75, Statistics:0.65, 'Linear Algebra':0.7, 'Deep Learning':0.6 } },
  { id: 'syn_bioinformatics',   v: { Python:0.75, Statistics:0.8, 'Machine Learning':0.55, SQL:0.6, 'Feature Engineering':0.6 } },
  { id: 'syn_finance_ml',       v: { Excel:0.9, Python:0.65, SQL:0.75, Statistics:0.7, 'Machine Learning':0.5 } },
  { id: 'syn_data_engineer',    v: { SQL:0.9, Python:0.8, 'Cloud Computing':0.75, 'Feature Engineering':0.65, 'Machine Learning':0.45 } },
  { id: 'syn_generalist',       v: { Python:0.7, SQL:0.65, Statistics:0.6, 'Machine Learning':0.55, Communication:0.7, 'Problem Solving':0.7 } },
  { id: 'syn_hr_to_analytics',  v: { Communication:0.85, Excel:0.75, 'Data Visualization':0.55, Statistics:0.45, SQL:0.5 } },
  { id: 'syn_automl_user',      v: { 'Machine Learning':0.6, Python:0.6, 'Feature Engineering':0.55, 'Model Evaluation':0.5, Statistics:0.5 } },
  { id: 'syn_transformer_fan',  v: { Python:0.8, 'Deep Learning':0.75, NLP:0.75, 'Machine Learning':0.7, 'Linear Algebra':0.65 } },
  { id: 'syn_classical_ml',     v: { Python:0.75, 'Machine Learning':0.8, Statistics:0.75, 'Feature Engineering':0.8, 'Model Evaluation':0.8, 'Linear Algebra':0.6 } },
];

// ── Math ──────────────────────────────────────────────────────────────────────
function cosine(v1, v2) {
  let dot = 0, n1 = 0, n2 = 0;
  for (const skill of SKILLS) {
    const a = v1[skill] || 0;
    const b = v2[skill] || 0;
    dot += a * b;
    n1  += a * a;
    n2  += b * b;
  }
  if (n1 === 0 || n2 === 0) return 0;
  return dot / (Math.sqrt(n1) * Math.sqrt(n2));
}

function emptyVector() {
  return Object.fromEntries(SKILLS.map(s => [s, 0]));
}

// ── Core engine ───────────────────────────────────────────────────────────────
export class RecEngine {

  // Build {userId → skillVector} from assessment_reports
  static async buildRealMatrix() {
    const reports = await Reports.getAll().catch(() => []);
    const matrix  = {};

    for (const report of (reports || [])) {
      const uid = report.userId;
      if (!uid) continue;
      if (!matrix[uid]) matrix[uid] = emptyVector();

      for (const sb of (report.skillBreakdown || [])) {
        const canon = normalizeSkill(sb.skill);
        if (canon && sb.pct != null) {
          matrix[uid][canon] = Math.max(matrix[uid][canon], sb.pct / 100);
        }
      }

      // Fold overall score into Machine Learning proxy
      if (report.score != null) {
        const proxy = (report.score / 100) * 0.7;
        matrix[uid]['Machine Learning'] = Math.max(matrix[uid]['Machine Learning'], proxy);
      }
    }
    return matrix;
  }

  // Merge real matrix with synthetic archetypes
  static async buildFullMatrix() {
    const real   = await this.buildRealMatrix();
    const full   = { ...real };
    for (const u of SYNTHETIC_USERS) {
      full[u.id] = Object.assign(emptyVector(), u.v);
    }
    return { real, full };
  }

  // Top-K skill recommendations for userId
  static async recommend(userId, topK = 5) {
    const { real, full } = await this.buildFullMatrix();
    const userVec = real[userId] || null;

    // Cold-start: user has no assessment data → return popularity-based recs
    if (!userVec || Object.values(userVec).every(v => v === 0)) {
      return this._popularRecs(full, topK);
    }

    // Cosine similarity against all other users
    const sims = [];
    for (const [oid, ovec] of Object.entries(full)) {
      if (oid === userId) continue;
      const s = cosine(userVec, ovec);
      if (s > 0.05) sims.push({ id: oid, sim: s, vec: ovec });
    }
    sims.sort((a, b) => b.sim - a.sim);
    const neighbours = sims.slice(0, Math.min(8, sims.length));

    const totalWeight = neighbours.reduce((s, u) => s + u.sim, 0);
    const avgSim = totalWeight / Math.max(neighbours.length, 1);

    const recs = [];
    for (const skill of SKILLS) {
      const myScore = userVec[skill] || 0;
      if (myScore >= 0.78) continue; // already proficient

      const wScore = totalWeight > 0
        ? neighbours.reduce((s, u) => s + (u.vec[skill] || 0) * u.sim, 0) / totalWeight
        : 0;
      if (wScore < 0.42) continue; // peers not strong here

      const gap   = 1 - myScore;
      const score = gap * wScore * (0.4 + avgSim * 0.6);
      const strongPeers = neighbours.filter(u => (u.vec[skill] || 0) > 0.6).length;

      recs.push({
        skill_id    : skillId(skill),
        name        : skill,
        domain      : SKILL_DOMAINS[skill] || 'skill',
        score       : Math.min(0.98, score),
        user_score  : myScore,
        peer_avg    : wScore,
        similar_users: strongPeers,
        reason      : strongPeers > 0
          ? `${strongPeers} learner${strongPeers > 1 ? 's' : ''} with your profile excel at ${skill}`
          : `Commonly studied after your current skill set`,
        method      : 'collaborative_filtering',
      });
    }

    recs.sort((a, b) => b.score - a.score);
    return recs.slice(0, topK);
  }

  static _popularRecs(matrix, topK) {
    const totals = Object.fromEntries(SKILLS.map(s => [s, 0]));
    const counts = Object.fromEntries(SKILLS.map(s => [s, 0]));
    for (const vec of Object.values(matrix)) {
      for (const skill of SKILLS) {
        totals[skill] += vec[skill] || 0;
        counts[skill]++;
      }
    }
    return SKILLS
      .map(skill => ({
        skill_id : skillId(skill),
        name     : skill,
        domain   : SKILL_DOMAINS[skill] || 'skill',
        score    : totals[skill] / Math.max(counts[skill], 1),
        reason   : 'Popular among learners on this platform',
        method   : 'popularity',
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }

  // Precision@K, NDCG@K, Coverage — real ML evaluation metrics
  static async computeMetrics(k = 5) {
    const { real } = await this.buildFullMatrix();
    const userIds  = Object.keys(real);
    if (userIds.length < 2) {
      return { precision_at_k: 0, ndcg_at_k: 0, coverage: 0, n_users: userIds.length, k };
    }

    let precSum = 0, ndcgSum = 0;
    const covered = new Set();

    for (const uid of userIds) {
      const vec      = real[uid];
      const weakSkills = SKILLS.filter(s => (vec[s] || 0) < 0.6);
      if (weakSkills.length === 0) continue;

      const recs     = await this.recommend(uid, k);
      const recNames = recs.map(r => r.name);

      // Precision@K: fraction of recs that are actually weak areas
      const hits = recNames.filter(n => weakSkills.includes(n)).length;
      precSum  += hits / k;

      // NDCG@K: ideal is the top-1 weak skill appearing at rank 1
      const groundTruth = weakSkills[0];
      const rank = recNames.indexOf(groundTruth);
      ndcgSum += rank >= 0 ? 1 / Math.log2(rank + 2) : 0;

      recNames.forEach(n => covered.add(n));
    }

    const n = userIds.length || 1;
    return {
      precision_at_k : parseFloat((precSum  / n).toFixed(4)),
      ndcg_at_k      : parseFloat((ndcgSum  / n).toFixed(4)),
      coverage       : parseFloat((covered.size / SKILLS.length).toFixed(4)),
      n_users        : userIds.length,
      k,
    };
  }
}

export default RecEngine;
