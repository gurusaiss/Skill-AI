# 🚀 Quick Start: Deploy to Vercel in 5 Minutes

The fastest way to get SkillForge AI live on Vercel.

---

## ⚡ 5-Minute Deployment

### Step 1: Push to GitHub (1 min)

```bash
git add .
git commit -m "Deploy to Vercel"
git push origin main
```

### Step 2: Import to Vercel (2 min)

1. Go to **[vercel.com/new](https://vercel.com/new)**
2. Click **"Import Project"**
3. Select your **GitHub repository**
4. Click **"Import"**

### Step 3: Add Environment Variables (1 min)

In the Vercel import screen, add:

```
GEMINI_API_KEY = your_gemini_api_key_here
NODE_ENV = production
```

### Step 4: Deploy (1 min)

Click **"Deploy"** and wait ~2 minutes.

### Step 5: Test (30 sec)

Visit: `https://your-app.vercel.app/api/health`

Should see:

```json
{
  "success": true,
  "data": {
    "status": "ok",
    "gemini": "enabled"
  }
}
```

---

## ✅ Done!

Your app is live at: `https://your-project.vercel.app`

---

## 🧪 Quick Test

1. Visit your app URL
2. Enter: "I want to learn cooking"
3. Verify skill tree generates
4. Check resources show cooking sites (not tech sites)

---

## 🆘 Troubleshooting

### Gemini shows "disabled"

→ Add `GEMINI_API_KEY` in Vercel dashboard → Redeploy

### Build fails

→ Check deployment logs → Verify Node 18+

### CORS errors

→ Already fixed! Should work automatically

---

## 📚 Need More Help?

- **Full Guide:** VERCEL_DEPLOYMENT.md
- **Checklist:** DEPLOYMENT_CHECKLIST.md
- **Reference:** .vercel/README.md

---

**That's it! You're deployed!** 🎉
