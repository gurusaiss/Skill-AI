# Interview Simulator — Testing Guide

## 🚀 Quick Start

### 1. Start the Backend

```bash
npm run dev:server
```

Expected output:

```
╔══════════════════════════════════════╗
║       SkillForge AI Server v2        ║
╠══════════════════════════════════════╣
║  Port:   3001                        ║
║  Gemini: ✅ ON  (gemini-2.0-flash)   ║
║  Env:    development                 ║
╚══════════════════════════════════════╝
```

### 2. Start the Frontend

```bash
cd client
npm run dev
```

Expected output:

```
  VITE v5.x.x  ready in xxx ms

  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### 3. Access Interview Simulator

Open browser: `http://localhost:5173/interview`

---

## 🧪 Test Scenarios

### Test 1: Frontend Developer Interview

**Setup:**

- Role: `Frontend Developer`
- Skills: `React, JavaScript, CSS, Responsive Design`
- Difficulty: `Medium`
- Questions: `5`

**Expected Questions:**

- Technical questions about React hooks, state management
- Behavioral questions about teamwork, challenges
- Coding questions about JavaScript fundamentals
- System design questions about scalability

**Test Actions:**

1. Fill setup form
2. Click "🚀 Start Interview"
3. Wait for questions to generate (5-10 seconds)
4. Answer first question (minimum 10 words)
5. Click "Next Question →"
6. Repeat for all questions
7. Click "Finish Interview →"
8. Wait for report generation (5-10 seconds)
9. Review overall score and feedback
10. Expand question breakdown
11. Click "🔄 New Interview" or "← Dashboard"

**Expected Results:**

- Questions are role-specific and relevant
- Evaluation provides constructive feedback
- Score is between 0-100 with letter grade
- Report includes strengths, weaknesses, recommendations

---

### Test 2: Chef Interview

**Setup:**

- Role: `Chef`
- Skills: `French Cuisine, Pastry, Knife Skills, Menu Planning`
- Difficulty: `Hard`
- Questions: `7`

**Expected Questions:**

- Technical questions about cooking techniques, mother sauces
- Behavioral questions about kitchen management, stress handling
- Practical questions about menu planning, cost control
- Scenario questions about service emergencies

**Test Actions:**

1. Fill setup form with chef-related inputs
2. Start interview
3. Answer questions with culinary knowledge
4. Complete all 7 questions
5. Review comprehensive report

**Expected Results:**

- Questions are culinary-specific (NOT tech-related)
- Evaluation understands cooking terminology
- Recommendations are relevant to culinary career
- Readiness assessment is accurate

---

### Test 3: Error Handling

**Test 3a: Empty Fields**

- Leave role or skills empty
- Click "🚀 Start Interview"
- **Expected**: Button is disabled, cannot proceed

**Test 3b: Short Answers**

- Enter answer with less than 10 words
- Try to submit
- **Expected**: Button is disabled, word count shows "too short"

**Test 3c: API Failure**

- Stop backend server
- Try to start interview
- **Expected**: Error message displayed, can retry

**Test 3d: Network Timeout**

- Simulate slow network
- **Expected**: Loading state with "Agent Thinking" animation

---

### Test 4: Navigation

**Test 4a: From Landing Page**

1. Go to `http://localhost:5173/`
2. Scroll to "Frontier Intelligence Modules"
3. Click "🎤 Interview Simulator"
4. **Expected**: Redirects to `/interview`

**Test 4b: From Dashboard**

1. Complete a session
2. Go to Dashboard
3. Manually navigate to `/interview`
4. **Expected**: Interview Simulator loads

**Test 4c: Back Navigation**

1. Start interview
2. Click "← Dashboard" (if available)
3. **Expected**: Returns to dashboard without losing progress

---

### Test 5: Multi-Domain Support

Test with various domains to ensure universal support:

**Test 5a: Law**

- Role: `Lawyer`
- Skills: `Contract Law, Litigation, Legal Research`
- **Expected**: Legal-specific questions

**Test 5b: Medicine**

- Role: `Doctor`
- Skills: `Diagnosis, Patient Care, Medical Ethics`
- **Expected**: Medical-specific questions

**Test 5c: Fashion**

- Role: `Fashion Designer`
- Skills: `Pattern Making, Fabric Selection, Trend Analysis`
- **Expected**: Fashion-specific questions

**Test 5d: Music**

- Role: `Music Producer`
- Skills: `Audio Engineering, Mixing, Music Theory`
- **Expected**: Music-specific questions

---

## 🔍 API Testing (Optional)

### Test API Endpoints Directly

**1. Generate Questions**

```bash
curl -X POST http://localhost:3001/api/interview/generate \
  -H "Content-Type: application/json" \
  -d '{
    "role": "Frontend Developer",
    "skills": "React, JavaScript",
    "difficulty": "medium",
    "count": 3
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": 1,
      "type": "technical",
      "question": "...",
      "difficulty": "medium",
      "skill": "React",
      "expectedPoints": ["...", "..."],
      "timeLimit": 120
    }
  ]
}
```

**2. Evaluate Answer**

```bash
curl -X POST http://localhost:3001/api/interview/evaluate \
  -H "Content-Type: application/json" \
  -d '{
    "question": {
      "question": "Explain React hooks",
      "expectedPoints": ["useState", "useEffect"]
    },
    "answer": "React hooks are functions that let you use state and lifecycle features in functional components...",
    "role": "Frontend Developer"
  }'
```

**Expected Response:**

```json
{
  "success": true,
  "data": {
    "score": 85,
    "grade": "A",
    "strengths": ["Clear explanation", "Good examples"],
    "weaknesses": ["Could mention custom hooks"],
    "feedback": "Excellent understanding..."
  }
}
```

**3. Generate Report**

```bash
curl -X POST http://localhost:3001/api/interview/report \
  -H "Content-Type: application/json" \
  -d '{
    "questions": [...],
    "role": "Frontend Developer"
  }'
```

---

## ✅ Checklist

### Setup Phase

- [ ] Form fields are visible and editable
- [ ] Role input accepts any text
- [ ] Skills input accepts comma-separated values
- [ ] Difficulty dropdown has 3 options (easy/medium/hard)
- [ ] Question count dropdown has 4 options (3/5/7/10)
- [ ] Start button is disabled when fields are empty
- [ ] Start button is enabled when fields are filled
- [ ] Info cards display correctly

### Interview Phase

- [ ] Questions load after setup
- [ ] Progress bar shows correct percentage
- [ ] Question metadata displays (type, difficulty, skill, time)
- [ ] Expected points section shows hints
- [ ] Answer textarea is functional
- [ ] Word count updates in real-time
- [ ] Word count color changes (red → amber → green)
- [ ] Submit button is disabled for short answers (<10 words)
- [ ] Previous button works (if not on first question)
- [ ] Next/Finish button submits answer
- [ ] Loading state shows during evaluation
- [ ] Error messages display if API fails

### Results Phase

- [ ] Overall score displays with animation
- [ ] Grade badge shows correct color and emoji
- [ ] Readiness level displays
- [ ] Summary text is readable
- [ ] Strengths section lists positive points
- [ ] Areas to improve section lists gaps
- [ ] Recommendations section provides actionable advice
- [ ] Next steps section shows progression path
- [ ] Question breakdown is expandable
- [ ] Individual question feedback displays
- [ ] New Interview button reloads page
- [ ] Dashboard button navigates back

### Integration

- [ ] Landing page link works
- [ ] Route `/interview` is accessible
- [ ] API endpoints respond correctly
- [ ] Gemini integration works (if API key is set)
- [ ] Fallback logic works (if Gemini is unavailable)
- [ ] No console errors
- [ ] No TypeScript/ESLint warnings
- [ ] Responsive design works on mobile

---

## 🐛 Common Issues

### Issue 1: "Could not reach the app server"

**Cause**: Backend is not running  
**Solution**: Run `npm run dev:server` in project root

### Issue 2: Questions are generic/not role-specific

**Cause**: Gemini API key not configured  
**Solution**: Check `.env` file has `GEMINI_API_KEY=your_key_here`

### Issue 3: Evaluation takes too long

**Cause**: Gemini API is slow or rate-limited  
**Solution**: Wait or use fallback (rule-based) evaluation

### Issue 4: "Request timed out"

**Cause**: Network timeout (60s limit)  
**Solution**: Check internet connection, restart backend

### Issue 5: Interview Simulator link not visible

**Cause**: Landing page not updated  
**Solution**: Hard refresh browser (Ctrl+Shift+R or Cmd+Shift+R)

---

## 📊 Performance Benchmarks

### Expected Response Times

- **Question Generation**: 3-8 seconds (Gemini) / <1 second (fallback)
- **Answer Evaluation**: 2-5 seconds (Gemini) / <1 second (fallback)
- **Report Generation**: 3-6 seconds (Gemini) / <1 second (fallback)

### Resource Usage

- **Memory**: ~50-100 MB (backend)
- **CPU**: Low (idle) / Medium (during AI calls)
- **Network**: ~5-20 KB per API call

---

## 🎯 Success Criteria

### Minimum Viable Product (MVP)

- [x] User can input role and skills
- [x] System generates relevant questions
- [x] User can answer questions
- [x] System evaluates answers
- [x] User receives overall report
- [x] Navigation works correctly

### Enhanced Experience

- [x] AI-powered question generation
- [x] Real-time feedback
- [x] Comprehensive reports
- [x] Question-by-question breakdown
- [x] Strengths and weaknesses analysis
- [x] Actionable recommendations
- [x] Readiness assessment

### Production Ready

- [x] Error handling
- [x] Loading states
- [x] Input validation
- [x] Responsive design
- [x] Fallback logic
- [x] API documentation
- [x] Test guide

---

## 🚀 Demo Script

### For Judges/Stakeholders

**1. Introduction (30 seconds)**

> "SkillForge now includes an AI-powered Interview Simulator that helps users practice for real job interviews. Let me show you how it works."

**2. Setup (30 seconds)**

> "I'll set up an interview for a Frontend Developer role, testing React, JavaScript, and CSS skills at medium difficulty with 5 questions."

**3. Interview (2 minutes)**

> "The system generates role-specific questions. Watch as I answer this technical question about React hooks. The AI evaluates my response in real-time, providing instant feedback."

**4. Results (1 minute)**

> "After completing all questions, I receive a comprehensive report with my overall score, strengths, areas to improve, and actionable recommendations. I can also review each question individually."

**5. Versatility (30 seconds)**

> "This works for ANY domain — not just tech. Let me quickly show you a Chef interview with culinary-specific questions."

**Total Demo Time**: ~4 minutes

---

## 📝 Notes

- Always test with Gemini API enabled for best experience
- Fallback logic ensures system works even without AI
- Questions are cached during interview (no re-generation)
- Report is generated only once at the end
- All data is processed in real-time (no database storage)
- Interview state is not persisted (refresh = restart)

---

**Last Updated**: May 3, 2026  
**Version**: 1.0.0  
**Status**: Production Ready ✅
