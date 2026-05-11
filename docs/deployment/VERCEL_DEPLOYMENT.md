# SkillForge AI - Vercel Deployment Guide

Complete guide for deploying SkillForge AI to Vercel.

---

## Prerequisites

- Vercel Account (free tier works)
- Gemini API Key from Google AI Studio
- Git repository (GitHub, GitLab, or Bitbucket)

---

## Quick Deploy

### 1. Push to GitHub

```bash
git add .
git commit -m "Ready for Vercel deployment"
git push origin main
```

### 2. Import to Vercel

1. Go to [vercel.com/new](https://vercel.com/new)
2. Click "Import Project"
3. Select your GitHub repository
4. Vercel will auto-detect the configuration

### 3. Configure Environment Variables

In Vercel dashboard, add:

**Required:**

- `GEMINI_API_KEY` = Your Gemini API key
- `NODE_ENV` = `production`

**Optional:**

- `GEMINI_MODEL` = `gemini-2.0-flash`

### 4. Deploy

Click "Deploy" and wait 2-3 minutes.

---

## Project Structure

```
skillforge-ai/
├── vercel.json          # Vercel configuration
├── package.json         # Root package with workspaces
├── client/              # React frontend
│   ├── dist/           # Build output (auto-generated)
│   └── package.json
└── server/              # Express backend
    ├── index.js        # Serverless function entry
    └── package.json
```

---

## Configuration Files

### vercel.json

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server/index.js",
      "use": "@vercel/node"
    },
    {
      "src": "client/package.json",
      "use": "@vercel/static-build",
      "config": { "distDir": "client/dist" }
    }
  ],
  "routes": [
    { "src": "/api/(.*)", "dest": "server/index.js" },
    { "src": "/(.*)", "dest": "client/dist/$1" }
  ]
}
```

---

## Environment Variables

### Production (.env on Vercel)

```bash
# Required
GEMINI_API_KEY=your_gemini_api_key_here
NODE_ENV=production

# Optional
GEMINI_MODEL=gemini-2.0-flash
PORT=3001
```

### Local Development (.env)

```bash
# Required
GEMINI_API_KEY=your_gemini_api_key_here
NODE_ENV=development

# Optional
GEMINI_MODEL=gemini-2.0-flash
PORT=3001
```

---

## Deployment Checklist

- [ ] Push code to GitHub
- [ ] Create Vercel project
- [ ] Add GEMINI_API_KEY environment variable
- [ ] Add NODE_ENV=production
- [ ] Deploy
- [ ] Test health endpoint: `https://your-app.vercel.app/api/health`
- [ ] Test creating a goal
- [ ] Verify Gemini is enabled in health check

---

## Testing Deployment

### 1. Health Check

```bash
curl https://your-app.vercel.app/api/health
```

Expected response:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "gemini": "enabled",
    "model": "gemini-2.0-flash",
    "agents": ["GoalAgent", "DecomposeAgent", ...]
  }
}
```

### 2. Create Test Goal

```bash
curl -X POST https://your-app.vercel.app/api/goal \
  -H "Content-Type: application/json" \
  -d '{"goalText": "I want to learn React"}'
```

---

## Troubleshooting

### Issue: "Gemini: disabled" in health check

**Solution:** Add GEMINI_API_KEY to Vercel environment variables

1. Go to Project Settings → Environment Variables
2. Add `GEMINI_API_KEY` with your key
3. Redeploy

### Issue: CORS errors

**Solution:** Already configured to allow Vercel URLs

- Check `server/index.js` CORS configuration
- Vercel URL is automatically allowed

### Issue: Build fails

**Solution:** Check build logs

1. Go to Deployments tab
2. Click failed deployment
3. Check build logs for errors
4. Common issues:
   - Missing dependencies
   - Node version mismatch
   - Build script errors

### Issue: API routes return 404

**Solution:** Check vercel.json routes

- API routes should start with `/api/`
- Static files served from `client/dist/`

### Issue: Session data not persisting

**Solution:** Vercel serverless functions are stateless

- Session data is stored in `server/data/` directory
- This works for development but not production
- For production, consider:
  - Vercel KV (Redis)
  - Vercel Postgres
  - External database (MongoDB, Supabase)

---

## Production Considerations

### 1. Database for Session Storage

Current: File-based storage in `server/data/`
**Problem:** Serverless functions are stateless

**Solutions:**

**Option A: Vercel KV (Redis)**

```bash
npm install @vercel/kv
```

**Option B: Vercel Postgres**

```bash
npm install @vercel/postgres
```

**Option C: MongoDB Atlas**

```bash
npm install mongodb
```

### 2. Rate Limiting

Add rate limiting to prevent API abuse:

```bash
npm install express-rate-limit
```

### 3. Monitoring

Enable Vercel Analytics:

1. Go to Project Settings → Analytics
2. Enable Web Analytics
3. Enable Speed Insights

---

## Custom Domain

### Add Custom Domain

1. Go to Project Settings → Domains
2. Add your domain
3. Update DNS records as instructed
4. Wait for SSL certificate (automatic)

---

## Continuous Deployment

Vercel automatically deploys on:

- Push to `main` branch → Production
- Push to other branches → Preview deployments
- Pull requests → Preview deployments

### Disable Auto-Deploy

If you want manual deploys:

1. Go to Project Settings → Git
2. Disable "Production Branch"
3. Deploy manually via CLI or dashboard

---

## Performance Optimization

### 1. Enable Edge Functions

Update `vercel.json`:

```json
{
  "functions": {
    "server/index.js": {
      "memory": 1024,
      "maxDuration": 30,
      "runtime": "nodejs18.x"
    }
  }
}
```

### 2. Enable Caching

Add cache headers for static assets:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### 3. Optimize Build

- Use `npm ci` instead of `npm install`
- Enable build cache
- Minimize bundle size

---

## Security

### 1. Environment Variables

- Never commit `.env` file
- Use Vercel dashboard for secrets
- Rotate API keys regularly

### 2. CORS

Already configured to allow:

- Localhost (development)
- Vercel URLs (production)

### 3. Rate Limiting

Consider adding:

```javascript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use("/api/", limiter);
```

---

## Cost Estimation

### Vercel Free Tier

- 100 GB bandwidth/month
- 100 GB-hours serverless function execution
- Unlimited deployments
- Unlimited team members

### Gemini API (Google)

- Free tier: 15 requests/minute
- Paid tier: $0.00025 per 1K characters

**Estimated monthly cost for 1000 users:**

- Vercel: $0 (within free tier)
- Gemini: ~$5-10 (depends on usage)

---

## Support

### Vercel Support

- [Vercel Documentation](https://vercel.com/docs)
- [Vercel Community](https://github.com/vercel/vercel/discussions)
- [Vercel Support](https://vercel.com/support)

### SkillForge AI

- Check `README.md` for project documentation
- Check `AUDIT_REPORT.md` for system status
- Check `FIXES_APPLIED.md` for recent changes

---

## Next Steps

1. ✅ Deploy to Vercel
2. ✅ Test all features
3. ✅ Add custom domain (optional)
4. ✅ Enable analytics
5. ✅ Set up monitoring
6. ✅ Consider database for production
7. ✅ Add rate limiting
8. ✅ Monitor API costs

---

**Deployment Status:** Ready for Vercel ✅

All configuration files are in place. Just push to GitHub and import to Vercel!
