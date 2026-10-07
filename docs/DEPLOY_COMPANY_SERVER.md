# Putting a new version on the company server (Azure)

Pushing code to GitHub does NOT update the company server by itself. This repo only tests and builds on GitHub; the running server changes only when someone rebuilds and restarts it. Follow these steps every time.

## 1. Get the new code onto the server
Pick the line that matches how the server runs:
- **Azure App Service connected to GitHub** (Deployment Center): open Deployment Center and check the latest run succeeded for the newest commit. If it did not start, press **Sync**, or confirm the branch it watches is `main` of the company repo (`tessrac-projects/skill_forge_LMS`).
- **Docker image** (App Service for Containers, Container Apps, a registry): build a new image from the repo's `Dockerfile` (`docker build --build-arg VITE_API_URL=<your site URL> --build-arg APP_COMMIT=<commit id> -t <registry>/skillforge-ai:<tag> .`), push it, then point the service at the new tag and restart. The React client is built INTO the image, so the image must be rebuilt for screen changes to appear.
- **A VM** (pm2, systemd, docker compose): on the VM run `git pull`, then `npm ci`, then `npm run build --workspace=client`, then restart the app (`pm2 restart all`, or `docker compose up -d --build`).

## 2. Settings (environment variables) on the server
The server only knows what is set on the server. Local `.env` changes never reach it. In App Service: Settings > Environment variables, then restart.
Needed for the new features (names only; get the values from your own accounts):
- Database: `SUPABASE_URL` and the service key variable (`SUPABASESERVICE_ROLE_KEY`, or `SUPABASE_SECRET_KEY` / `SUPABASE_KEY`). For the new company database these must be the NEW database's values.
- AI keys: `GEMINI_API_KEY`, `GEMINI_API_KEY_2` ... `GEMINI_API_KEY_10`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`.
- Optional: `REPORT_TIMEZONE` (default Asia/Kolkata), `GEN_TIME_BUDGET_MS`, `GEN_CONCURRENCY`, `GEN_EXTRACTIVE_SHARE`.
- `JWT_SECRET` must be set to a long random value.

## 3. Database
Run the SQL in `queries/` (see `queries/README.md`) in the company database's SQL editor. Without it, new screens (employee ID, reminders, quarter archives, assign/reassign dates) cannot save.

## 4. Check that the new version is live
- Open `https://<your-site>/api/health`. Look at `data.build.startedAt`: it must be the time you restarted. `data.build.commit` shows the commit when the image was built with `APP_COMMIT`. `data.db` should say `supabase`, `data.openrouter` should say `enabled` if you set that key.
- In the browser press **Ctrl+F5** once so an old copy of the site is not shown from cache. If the site sits behind a CDN, purge it.
- If `startedAt` is old, the server did not restart: the deploy did not happen.
