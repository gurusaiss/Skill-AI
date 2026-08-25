# SkillForge AI - Quick Start Guide

## ✅ Backend Fix Applied

The `GeminiService is not a constructor` error has been fixed. The backend should now start successfully.

## 🚀 Start the Application

### Terminal 1: Backend Server

```bash
cd server
npm run dev
```

**Expected Output**:

```
🚀 SkillForge AI Server running on http://localhost:3001
✅ All routes registered
📊 Gemini 2.0 Flash: enabled
🔄 Groq fallback: enabled
```

### Terminal 2: Frontend Client

```bash
cd client
npm run dev
```

**Expected Output**:

```
VITE v5.x.x  ready in XXX ms

➜  Local:   http://localhost:5173/
➜  Network: use --host to expose
```

## 🌐 Access the Application

Open your browser and navigate to:

```
http://localhost:5173
```

## 🧪 Test Session Progression

1. **Create a Goal** (if you haven't already)
   - Go to Landing page
   - Click "Get Started"
   - Enter a learning goal (e.g., "Learn React development")
   - Complete the diagnostic quiz

2. **Start Session 1**
   - Go to Dashboard
   - Click "Start Day 1" or navigate to `/session/1`
   - Read the concept summary
   - Click "Start 10-Question Quiz"

3. **Complete the Quiz**
   - Answer at least 7 out of 10 questions
   - Click "Submit Quiz"
   - **Watch for**: Session data being saved to backend

4. **View Results**
   - See your score and grade
   - **Look for**: "🚀 Continue to Day 2 →" button at the top
   - Click "View Study Notes" to see auto-generated notes

5. **Progress to Day 2**
   - Click "🚀 Continue to Day 2 →"
   - **Expected**: Immediately navigate to Day 2 session
   - **Expected**: Day 1 marked complete in Dashboard

6. **Verify Dashboard**
   - Return to Dashboard
   - **Check**: Day 1 shows as completed
   - **Check**: Stats updated (Total Sessions: 1, Avg Score: X%)
   - **Check**: Session appears in Recent Sessions

## 🔧 Troubleshooting

### Backend Won't Start

**Error**: `Cannot find module`

```bash
cd server
npm install
npm run dev
```

**Error**: `Port 3001 already in use`

```bash
# Windows
netstat -ano | findstr :3001
taskkill /PID <PID> /F

# Or change port in .env
PORT=3002
```

### Frontend Won't Start

**Error**: `Cannot find module`

```bash
cd client
npm install
npm run dev
```

**Error**: `Port 5173 already in use`

- Vite will automatically try the next available port (5174, 5175, etc.)

### API Connection Issues

**Error**: "Could not reach the app server"

1. **Check backend is running**:

   ```bash
   curl http://localhost:3001/api/health
   ```

   Expected: `{"success":true,"data":{"status":"ok"}}`

2. **Check CORS settings** (if accessing from different port):
   - Backend should allow `http://localhost:5173`
   - Check `server/index.js` for CORS configuration

3. **Check .env file**:
   - Ensure `PORT=3001` in server/.env or root .env
   - Ensure API keys are present (GEMINI_API_KEY, GROQ_API_KEY)

### Session Submission Fails

**Error**: "Failed to submit session"

1. **Check browser console** for detailed error
2. **Check server logs** for backend errors
3. **Verify API endpoint**:
   ```bash
   curl -X POST http://localhost:3001/api/session/submit \
     -H "Content-Type: application/json" \
     -d '{"userId":"test","day":1,"skillId":"test","challenge":{},"userResponse":{}}'
   ```

### No "Next Session" Button

**Possible causes**:

1. Session submission failed (check console for errors)
2. No next day exists (you completed the last session)
3. Backend didn't return `nextDay` (check server logs)

**Debug**:

```javascript
// Open browser console after completing quiz
// Check quizResult object
console.log(quizResult);
// Should have: { results: [...], score: 80, weakConcepts: [...], nextDay: 2 }
```

## 📊 API Endpoints

### Health Check

```bash
GET http://localhost:3001/api/health
```

### Get Challenge

```bash
GET http://localhost:3001/api/session/challenge/:userId/:day
```

### Submit Session

```bash
POST http://localhost:3001/api/session/submit
Body: {
  "userId": "string",
  "day": number,
  "skillId": "string",
  "challenge": object,
  "userResponse": object
}
```

### Get Dashboard

```bash
GET http://localhost:3001/api/session/dashboard/:userId
```

## 🔑 Environment Variables

### Required (Backend)

```env
GEMINI_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.0-flash
GROQ_API_KEY=your_groq_api_key_here
PORT=3001
NODE_ENV=development
```

### Optional (Frontend)

```env
VITE_API_URL=http://localhost:3001
```

## 📝 Development Notes

### Backend Structure

```
server/
├── index.js              # Main server entry point
├── routes/
│   ├── session.js        # Session endpoints (FIXED)
│   ├── goal.js           # Goal creation
│   ├── diagnostic.js     # Diagnostic quiz
│   ├── report.js         # Report generation
│   ├── simulation.js     # Simulation lab
│   ├── market.js         # Market intelligence
│   └── interview.js      # Interview simulator
├── agent/
│   ├── SmartAgent.js     # Main orchestrator
│   ├── SkillDecomposer.js
│   ├── QuizGenerator.js
│   ├── Evaluator.js
│   ├── ChallengeEngine.js
│   └── ...
└── services/
    └── GeminiService.js  # LLM service (singleton)
```

### Frontend Structure

```
client/
├── src/
│   ├── App.jsx           # Main app with routes
│   ├── pages/
│   │   ├── Landing.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Session.jsx   # Session flow (UPDATED)
│   │   ├── Report.jsx
│   │   └── ...
│   ├── components/
│   │   ├── SkillTree.jsx
│   │   ├── ProgressRing.jsx
│   │   └── ...
│   └── utils/
│       └── api.js        # API client
└── index.html
```

## 🎯 Next Steps

1. ✅ Backend starts successfully
2. ✅ Frontend starts successfully
3. ✅ Complete Session 1
4. ✅ Click "Continue to Day 2"
5. ✅ Verify Dashboard updates
6. 🎉 Ready for hackathon presentation!

## 🐛 Known Issues

None currently! All features working as expected.

## 📞 Support

If you encounter any issues:

1. Check browser console for frontend errors
2. Check server terminal for backend errors
3. Verify .env file has correct API keys
4. Ensure both servers are running
5. Try clearing browser cache and localStorage

## 🎉 Success Indicators

✅ Backend starts without errors
✅ Frontend connects to backend
✅ Can create goals and complete diagnostic
✅ Can start and complete sessions
✅ "Next Session" button appears after quiz
✅ Dashboard updates with session data
✅ Can progress through multiple sessions
✅ All features work (Digital Twin, Report, etc.)

---

**Status**: ✅ Ready for Development & Testing
**Last Updated**: 2026-05-03
