# Deploy SkillForge AI to Vercel - Quick Start

## 🚀 One-Click Deploy

### Method 1: Vercel Dashboard (Easiest)

1. **Go to**: https://vercel.com/new
2. **Import Git Repository**: Connect your GitHub repo
3. **Configure Project**:
   - Framework Preset: **Other**
   - Root Directory: **.**
   - Build Command: `npm run vercel-build`
   - Output Directory: `client/dist`
   - Install Command: `npm install`

4. **Add Environment Variables** (IMPORTANT!):

   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.0-flash
   GROQ_API_KEY=your_groq_api_key_here
   NODE_ENV=production
   ```

5. **Click "Deploy"** and wait 3-5 minutes

6. **Done!** Your app will be live at `https://skillforge-ai-xyz.vercel.app`

### Method 2: Vercel CLI (For Developers)

```bash
# 1. Install Vercel CLI
npm install -g vercel

# 2. Login to Vercel
vercel login

# 3. Deploy (first time)
vercel

# Answer prompts:
# - Set up and deploy? Yes
# - Which scope? Your account
# - Link to existing project? No
# - Project name? skillforge-ai
# - Directory? ./
# - Override settings? No

# 4. Add environment variables
vercel env add GEMINI_API_KEY
# Paste: your_gemini_api_key_here

vercel env add GEMINI_MODEL
# Paste: gemini-2.0-flash

vercel env add GROQ_API_KEY
# Paste: your_groq_api_key_here

vercel env add NODE_ENV
# Paste: production

# 5. Deploy to production
vercel --prod
```

## ✅ Verify Deployment

### 1. Test Backend API

```bash
# Replace with your Vercel URL
curl https://your-app.vercel.app/api/health
```

**Expected Response**:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "gemini": "enabled",
    "groq": "enabled (fallback)",
    "model": "gemini-2.0-flash"
  }
}
```

### 2. Test Frontend

Open `https://your-app.vercel.app` in browser:

- ✅ Landing page loads
- ✅ Can click "Get Started"
- ✅ Can create a goal
- ✅ Can complete diagnostic
- ✅ Can start sessions

### 3. Test Full Flow

1. Create goal: "I want to become a Data Scientist"
2. Complete diagnostic quiz
3. Go to Dashboard
4. Start Day 1 session
5. Complete quiz
6. Check if "Continue to Day 2" button appears
7. Click it and verify Day 2 loads

## 🔧 If Deployment Fails

### Build Error

```bash
# Test build locally first
npm install
npm run vercel-build

# If it works locally, check Vercel logs
```

### API Error (500)

```bash
# Check Vercel Function Logs:
# Dashboard → Your Project → Deployments → Latest → Functions

# Common fixes:
# 1. Add environment variables
# 2. Check import paths (must include .js extension)
# 3. Increase timeout in vercel.json
```

### CORS Error

```bash
# Add your Vercel URL to allowed origins in server/index.js
# Already configured - should work automatically
```

### Environment Variables Not Working

```bash
# In Vercel Dashboard:
# 1. Go to Settings → Environment Variables
# 2. Make sure variables are added to "Production"
# 3. Redeploy after adding variables
```

## 📱 Share Your App

After deployment, share your URL:

```
https://skillforge-ai-xyz.vercel.app
```

Or set up a custom domain:

1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add domain (e.g., `skillforge.ai`)
3. Follow DNS instructions
4. Wait 5-30 minutes for propagation

## 🎯 Quick Checklist

Before deploying:

- ✅ All code committed to Git
- ✅ Environment variables ready
- ✅ Build works locally (`npm run vercel-build`)
- ✅ Server works locally (`npm run dev`)

After deploying:

- ✅ Test `/api/health` endpoint
- ✅ Test landing page
- ✅ Test goal creation
- ✅ Test session completion
- ✅ Test dashboard updates
- ✅ Test on mobile

## 🚀 Continuous Deployment

Once deployed, Vercel automatically redeploys when you:

- Push to `main` branch → Production deployment
- Push to other branches → Preview deployment
- Create pull request → Preview deployment with unique URL

## 📞 Need Help?

1. **Check Vercel Logs**: Dashboard → Deployments → Latest → Functions
2. **Check Browser Console**: F12 → Console tab
3. **Test API**: `curl https://your-app.vercel.app/api/health`
4. **Verify Environment Variables**: Dashboard → Settings → Environment Variables

## 🎉 Success!

Your SkillForge AI app is now live and accessible worldwide! 🌍

**Next Steps**:

1. Share the URL with your team
2. Test all features
3. Monitor performance in Vercel Dashboard
4. Set up custom domain (optional)
5. Enable analytics (optional)

---

**Deployment Time**: ~3-5 minutes
**Build Time**: ~2-3 minutes
**Status**: Ready to deploy! 🚀
