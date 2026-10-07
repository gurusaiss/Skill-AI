-- Adds the per-user profile columns the app reads/writes (Employee/Manager ID,
-- phone, status). Idempotent: safe to run more than once. Run in the Supabase
-- SQL editor. Without employee_id the app silently drops the ID on save.
ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone       TEXT DEFAULT '';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status      TEXT DEFAULT 'active';
-- Non-unique lookup index (uniqueness is enforced per company in the API).
CREATE INDEX IF NOT EXISTS idx_users_company_employee_id
  ON users (company_id, lower(employee_id));
