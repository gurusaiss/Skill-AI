-- SkillForge AI — Supabase Migration
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- Adds the missing `content` column to the modules table

-- 1. Add content JSONB column (stores roadmap, sessions, quizzes, milestones, etc.)
ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS content JSONB DEFAULT '{}'::jsonb;

-- 2. Add progress_tracking column (boolean flag)
ALTER TABLE modules
  ADD COLUMN IF NOT EXISTS progress_tracking BOOLEAN DEFAULT true;

-- 3. Add assigned_by column to assignment_requests if missing
ALTER TABLE assignment_requests
  ADD COLUMN IF NOT EXISTS group_id TEXT;

ALTER TABLE assignment_requests
  ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium';

ALTER TABLE assignment_requests
  ADD COLUMN IF NOT EXISTS due_date TIMESTAMPTZ;

ALTER TABLE assignment_requests
  ADD COLUMN IF NOT EXISTS requested_at TIMESTAMPTZ DEFAULT NOW();

-- 4. Verify the modules table schema
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'modules'
ORDER BY ordinal_position;
