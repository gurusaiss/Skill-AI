# Vercel Configuration

This directory contains Vercel-specific configuration and deployment settings.

## Quick Reference

### Environment Variables (Required)

Add these in Vercel Dashboard → Settings → Environment Variables:

```
GEMINI_API_KEY=your_gemini_api_key
NODE_ENV=production
```

### Build Settings

- **Framework Preset**: Other
- **Build Command**: `npm run vercel-build`
- **Output Directory**: `client/dist`
- **Install Command**: `npm install`

### Routes

- `/api/*` → Server (serverless function)
- `/*` → Client (static files)

### Deployment

```bash
# Via CLI
vercel

# Via Git
git push origin main
```

### Health Check

After deployment, test:

```
https://your-app.vercel.app/api/health
```

Should return:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "gemini": "enabled"
  }
}
```

## Files

- `../vercel.json` - Main configuration
- `../.vercelignore` - Files to exclude
- `../VERCEL_DEPLOYMENT.md` - Full guide
