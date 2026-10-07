# MySQL - not provided on purpose

The full SkillForge app cannot run on MySQL. `DB_BACKEND=mysql` only switches the users store
(`server/services/UserStore.js`) and the `server/db/store.js` tables. Every collection in
`server/services/DataStore.js` (assessments, reports, companies, role library, question banks,
employee assessment assignments, reminders, settings, access codes ...) is Supabase/PostgreSQL or local
JSON files only.

`sql/mysql_schema.sql` already includes `users.employee_id`, `phone`, `status` and the
`(company_id, employee_id)` index, so there is nothing to add for those. Use the Supabase scripts in
`../supabase/` for the company database.
