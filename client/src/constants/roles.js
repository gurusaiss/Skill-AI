// Platform system/access roles (Leadership, Senior * Manager, Assistant
// Manager - *, WFM, Lead, Trainer, Quality Analyst, SME) — the same list
// UserManagement.jsx's "Role" (system access) dropdown offers, kept here so
// every "Job Role" suggestion surface (Add/Edit User, Onboarding, login's
// job-role autocomplete) can offer them too without duplicating the list in
// four different files. Must stay in sync with the server-side canonical
// list: server/services/roleCapability.js's MANAGER_TIER_ROLES plus
// trainer/quality-analyst/sme from ALL_VALID_ROLES.
export const SYSTEM_ROLE_LABELS = {
  leadership: 'Leadership',
  'senior-training-development-manager': 'Senior Training & Development Manager',
  'senior-quality-manager': 'Senior Quality Manager',
  'senior-training-manager': 'Senior Training Manager',
  'senior-operations-manager': 'Senior Operations Manager',
  'assistant-manager-ops': 'Assistant Manager - Ops',
  'assistant-manager-quality': 'Assistant Manager - Quality',
  'assistant-manager-training': 'Assistant Manager - Training',
  wfm: 'WFM',
  lead: 'Lead',
  trainer: 'Trainer',
  'quality-analyst': 'Quality Analyst',
  sme: 'SME',
};

// Just the display labels, e.g. for a Job Role datalist/suggestion list —
// these are plain strings there (free text), not the slug keys above.
export const SYSTEM_ROLE_JOB_TITLES = Object.values(SYSTEM_ROLE_LABELS);
