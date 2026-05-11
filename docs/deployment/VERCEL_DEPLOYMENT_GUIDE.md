# Vercel Deployment Guide - SkillForge AI

## 🚀 Quick Deploy

### Option 1: Deploy via Vercel Dashboard (Recommended)

1. **Go to Vercel**: https://vercel.com
2. **Sign in** with GitHub
3. **Click "Add New Project"**
4. **Import your GitHub repository**
5. **Configure**:
   - Framework Preset: **Other**
   - Root Directory: **.**
   - Build Command: `npm run vercel-build`
   - Output Directory: `client/dist`
   - Install Command: `npm install`

6. **Add Environment Variables**:

   ```
   GEMINI_API_KEY=your_gemini_api_key_here
   GEMINI_MODEL=gemini-2.0-flash
   GROQ_API_KEY=your_groq_api_key_here
   NODE_ENV=production
   ```

7. **Click "Deploy"**

### Option 2: Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm install -g vercel

# Login to Vercel
vercel login

# Deploy
vercel

# Follow prompts:
# - Set up and deploy? Yes
# - Which scope? Your account
# - Link to existing project? No
# - Project name? skillforge-ai
# - Directory? ./
# - Override settings? No

# Deploy to production
vercel --prod
```

## 📋 Pre-Deployment Checklist

### 1. Environment Variables

Ensure these are set in Vercel Dashboard → Settings → Environment Variables:

```env
GEMINI_API_KEY=AIzaSy...  (Required for AI features)
GEMINI_MODEL=gemini-2.0-flash
GROQ_API_KEY=gsk_...  (Optional fallback)
NODE_ENV=production
```

### 2. Build Configuration

Verify `vercel.json` is correct:

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
      "config": {
        "distDir": "client/dist"
      }
    }
  ],
  "routes": [
    {
      "src": "/api/(.*)",
      "dest": "server/index.js"
    },
    {
      "src": "/(.*)",
      "dest": "client/dist/$1"
    }
  ]
}
```

### 3. Package.json Scripts

Verify root `package.json` has:

```json
{
  "scripts": {
    "vercel-build": "npm run build --workspace=client"
  }
}
```

### 4. Client Build

Verify `client/package.json` has:

```json
{
  "scripts": {
    "build": "vite build"
  }
}
```

## 🔧 Configuration Files

### vercel.json

- ✅ Already configured
- ✅ Routes API calls to serverless function
- ✅ Routes static files to client build
- ✅ 60-second timeout for AI operations

### .vercelignore

Create if doesn't exist:

```
node_modules
.env
.env.local
*.log
.DS_Store
server/data/*.json
!server/data/.gitkeep
pptx_slides
pptx_slides2
.kiro
.vscode
.git
```

## 🌐 After Deployment

### 1. Get Your URL

Vercel will provide a URL like:

```
https://skillforge-ai-xyz123.vercel.app
```

### 2. Test the Deployment

**Test Backend**:

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
    "groq": "enabled (fallback)",
    "model": "gemini-2.0-flash",
    "agents": [...]
  }
}
```

**Test Frontend**:
Open `https://your-app.vercel.app` in browser

- Should see SkillForge landing page
- Should be able to create goals
- Should be able to complete sessions

### 3. Custom Domain (Optional)

1. Go to Vercel Dashboard → Your Project → Settings → Domains
2. Add your custom domain (e.g., `skillforge.ai`)
3. Follow DNS configuration instructions
4. Wait for DNS propagation (5-30 minutes)

## 🐛 Troubleshooting

### Build Fails

**Error**: `Cannot find module`

```bash
# Solution: Install dependencies
npm install
npm run build --workspace=client
```

**Error**: `Build exceeded maximum duration`

```bash
# Solution: Optimize build
# 1. Remove unused dependencies
# 2. Use production build
# 3. Check Vercel plan limits
```

### API Not Working

**Error**: `500 Internal Server Error`

```bash
# Check Vercel Function Logs:
# Dashboard → Your Project → Deployments → Latest → Functions

# Common issues:
# 1. Missing environment variables
# 2. Import errors (use .js extensions)
# 3. Timeout (increase in vercel.json)
```

**Error**: `CORS Error`

```javascript
// server/index.js should have:
const allowedOrigins = [
  "http://localhost:5173",
  process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null,
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: allowedOrigins.length > 2 ? allowedOrigins : "*",
    credentials: true,
  }),
);
```

### Frontend Not Loading

**Error**: `404 Not Found`

```bash
# Check build output:
# 1. Verify client/dist exists after build
# 2. Check vercel.json routes
# 3. Verify distDir in vercel.json
```

**Error**: `Blank page`

```bash
# Check browser console for errors
# Common issues:
# 1. API URL not set correctly
# 2. Environment variables missing
# 3. Build errors not caught
```

### Environment Variables Not Working

```bash
# Verify in Vercel Dashboard:
# Settings → Environment Variables

# Make sure to:
# 1. Add to all environments (Production, Preview, Development)
# 2. Redeploy after adding variables
# 3. No quotes around values
```

## 📊 Monitoring

### Vercel Analytics

Enable in Dashboard → Your Project → Analytics

- Page views
- Performance metrics
- Error tracking

### Function Logs

Dashboard → Your Project → Deployments → Latest → Functions

- Real-time logs
- Error messages
- Performance data

### Custom Monitoring

Add to `server/index.js`:

```javascript
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});
```

## 🔄 Continuous Deployment

### Automatic Deployments

Vercel automatically deploys when you push to GitHub:

- **Push to `main`** → Production deployment
- **Push to other branches** → Preview deployment
- **Pull requests** → Preview deployment with unique URL

### Manual Deployments

```bash
# Deploy current branch
vercel

# Deploy to production
vercel --prod

# Deploy specific branch
git checkout feature-branch
vercel
```

## 🎯 Performance Optimization

### 1. Enable Caching

Add to `vercel.json`:

```json
{
  "headers": [
    {
      "source": "/assets/(.*)",
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

### 2. Optimize Images

Use Vercel Image Optimization:

```javascript
// In React components
<img src="/api/image?url=..." alt="..." />
```

### 3. Enable Compression

Already enabled by default in Vercel

### 4. Use Edge Functions (Optional)

For faster response times globally:

```json
{
  "functions": {
    "server/index.js": {
      "runtime": "edge"
    }
  }
}
```

## 🔐 Security

### 1. Environment Variables

- Never commit `.env` to Git
- Use Vercel Dashboard to set variables
- Rotate API keys regularly

### 2. CORS Configuration

- Restrict origins in production
- Use specific domains, not `*`

### 3. Rate Limiting

Add to `server/index.js`:

```javascript
import rateLimit from "express-rate-limit";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
});

app.use("/api/", limiter);
```

## 📱 Mobile Optimization

### 1. Responsive Design

Already implemented with Tailwind CSS

### 2. PWA Support (Optional)

Add `manifest.json` and service worker

### 3. Performance

- Lazy load components
- Code splitting
- Image optimization

## 🎉 Success Checklist

After deployment, verify:

- ✅ Landing page loads
- ✅ Can create goals
- ✅ Can complete diagnostic
- ✅ Can start sessions
- ✅ Can complete quizzes
- ✅ Dashboard shows data
- ✅ All features work
- ✅ No console errors
- ✅ Mobile responsive
- ✅ Fast load times

## 📞 Support

### Vercel Support

- Documentation: https://vercel.com/docs
- Community: https://github.com/vercel/vercel/discussions
- Status: https://www.vercel-status.com

### SkillForge Issues

- Check server logs in Vercel Dashboard
- Check browser console for frontend errors
- Verify environment variables are set
- Test API endpoints with curl

## 🚀 Quick Commands

```bash
# Install Vercel CLI
npm install -g vercel

# Login
vercel login

# Deploy to preview
vercel

# Deploy to production
vercel --prod

# View logs
vercel logs

# List deployments
vercel ls

# Remove deployment
vercel rm deployment-url

# Pull environment variables
vercel env pull

# Add environment variable
vercel env add VARIABLE_NAME
```

## 📝 Deployment URL

After deployment, your app will be available at:

```
https://skillforge-ai-[random].vercel.app
```

You can also set up a custom domain:

```
https://skillforge.ai
https://www.skillforge.ai
```

## 🎯 Next Steps

1. ✅ Deploy to Vercel
2. ✅ Test all features
3. ✅ Set up custom domain (optional)
4. ✅ Enable analytics
5. ✅ Monitor performance
6. ✅ Share with users!

---

**Status**: Ready for deployment! 🚀
**Estimated Deploy Time**: 3-5 minutes
**Estimated Build Time**: 2-3 minutes
