-- SkillForge AI — RecSys tables migration
-- Run this in Supabase SQL Editor
-- Safe to run multiple times (IF NOT EXISTS)

-- 1. User-skill interaction log (feeds the recommendation matrix)
CREATE TABLE IF NOT EXISTS user_skill_interactions (
  id               BIGSERIAL PRIMARY KEY,
  user_id          TEXT        NOT NULL,
  skill_id         TEXT        NOT NULL,
  engagement_score FLOAT       NOT NULL DEFAULT 0.5 CHECK (engagement_score >= 0 AND engagement_score <= 1),
  interaction_type TEXT        NOT NULL DEFAULT 'view',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill_id)
);

-- 2. ML metrics snapshots (Precision@5, NDCG@10, Coverage)
CREATE TABLE IF NOT EXISTS rec_metrics (
  id             BIGSERIAL   PRIMARY KEY,
  calculated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  precision_at_5 FLOAT       NOT NULL DEFAULT 0,
  recall_at_5    FLOAT       NOT NULL DEFAULT 0,
  ndcg_at_10     FLOAT       NOT NULL DEFAULT 0,
  coverage       FLOAT       NOT NULL DEFAULT 0,
  total_users    INT         NOT NULL DEFAULT 0,
  total_skills   INT         NOT NULL DEFAULT 0
);

-- 3. Recommendation log (what was shown, what was clicked)
CREATE TABLE IF NOT EXISTS recommendations_log (
  id                  BIGSERIAL   PRIMARY KEY,
  user_id             TEXT        NOT NULL,
  recommended_skills  TEXT[]      NOT NULL DEFAULT '{}',
  clicked_skills      TEXT[]      NOT NULL DEFAULT '{}',
  generated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Skills the user marked as "Not Interested"
CREATE TABLE IF NOT EXISTS rec_exclusions (
  id         BIGSERIAL   PRIMARY KEY,
  user_id    TEXT        NOT NULL,
  skill_id   TEXT        NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, skill_id)
);

-- 5. Skill catalog with domain info (cached from agent output)
CREATE TABLE IF NOT EXISTS rec_skills (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  domain      TEXT NOT NULL DEFAULT 'general',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Market demand scores per skill (written by MarketAgent, read by RecSys)
CREATE TABLE IF NOT EXISTS rec_market_demand (
  skill_id     TEXT PRIMARY KEY,
  demand_score FLOAT       NOT NULL DEFAULT 0.5,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for query performance
CREATE INDEX IF NOT EXISTS idx_interactions_user ON user_skill_interactions (user_id);
CREATE INDEX IF NOT EXISTS idx_interactions_skill ON user_skill_interactions (skill_id);
CREATE INDEX IF NOT EXISTS idx_rec_log_user ON recommendations_log (user_id);
CREATE INDEX IF NOT EXISTS idx_exclusions_user ON rec_exclusions (user_id);
CREATE INDEX IF NOT EXISTS idx_metrics_date ON rec_metrics (calculated_at DESC);

-- RLS: Enable row-level security
ALTER TABLE user_skill_interactions  ENABLE ROW LEVEL SECURITY;
ALTER TABLE recommendations_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec_exclusions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec_metrics              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec_skills               ENABLE ROW LEVEL SECURITY;
ALTER TABLE rec_market_demand        ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS (used by Node.js and Python service)
-- No additional policies needed — service_role key has full access.
-- If using anon key, add policies here per your auth setup.
