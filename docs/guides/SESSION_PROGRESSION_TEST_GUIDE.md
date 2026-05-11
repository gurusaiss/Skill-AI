# Session Progression - Testing Guide

## Quick Test (5 minutes)

### Prerequisites

1. Start the backend server: `cd server && npm start`
2. Start the frontend: `cd client && npm run dev`
3. Have a user account with an active learning plan

### Test Flow

#### Test 1: Complete Session 1 → Navigate to Session 2

1. **Navigate to Session 1**
   - Go to Dashboard
   - Click "Start Day 1" or navigate to `/session/1`

2. **Complete the Learn Phase**
   - Read the concept summary
   - Click "✅ I've Read This — Start 10-Question Quiz →"

3. **Complete the Quiz**
   - Answer at least 7 out of 10 questions (70% minimum to submit)
   - Click "Submit Quiz"
   - **Expected**: Quiz submits, session data sent to backend

4. **View Quiz Results**
   - **Expected**: See score, grade, question breakdown
   - **Expected**: See prominent "🚀 Continue to Day 2 →" button at the top
   - **Expected**: Button is emerald/teal gradient, stands out visually

5. **Click "View Study Notes"**
   - **Expected**: Auto-generated notes appear
   - **Expected**: "🚀 Continue to Day 2 →" button also appears here

6. **Click "Continue to Day 2"**
   - **Expected**: Immediately navigate to `/session/2`
   - **Expected**: Day 2 session loads with new content

7. **Return to Dashboard**
   - **Expected**: Day 1 shows as completed (checkmark or "Completed" status)
   - **Expected**: Stats updated (Total Sessions: 1, Avg Score: X%)
   - **Expected**: Session appears in Recent Sessions history

#### Test 2: Verify Data Persistence

1. **Check Dashboard Stats**
   - Total Sessions should increment
   - Average Score should reflect Session 1 score
   - Best Score should show Session 1 score

2. **Check Learning Plan**
   - Day 1 should show "Completed" status
   - Day 2 should be active/available

3. **Check Skill Mastery**
   - Skill mastery percentage should update based on Session 1 score
   - Skill status may change (e.g., "active" → "complete" if mastery ≥ 75%)

4. **Check Session History**
   - Session 1 should appear in Recent Sessions
   - Should show score, date, skill name

#### Test 3: Complete Multiple Sessions

1. Complete Session 2 following same flow
2. **Expected**: "🚀 Continue to Day 3 →" button appears
3. Complete Session 3
4. **Expected**: "🚀 Continue to Day 4 →" button appears
5. Verify Dashboard shows all 3 sessions

#### Test 4: Last Session (No Next Day)

1. Complete the final session in your learning plan
2. **Expected**: NO "Continue to Day X" button appears
3. **Expected**: Only "View Study Notes", "Reflect", and "Dashboard" buttons show

## Detailed Test Cases

### TC1: Session Submission Success

**Steps**:

1. Complete quiz with 8/10 correct (80%)
2. Submit quiz

**Expected**:

- API call to `POST /api/session/submit` succeeds
- Response includes `nextDay: 2`
- No errors in browser console
- No errors in server logs

**Verify**:

```javascript
// Check browser console for:
// No errors
// Network tab shows POST /api/session/submit with 200 status
```

### TC2: Session Submission Failure (Graceful Degradation)

**Steps**:

1. Stop backend server
2. Complete quiz
3. Submit quiz

**Expected**:

- Error logged to console: "Failed to submit session: ..."
- Quiz results still display
- User can still view notes and navigate
- "Continue to Day X" button does NOT appear (no nextDay)

**Verify**:

```javascript
// Check browser console for:
// Error message logged
// User can still interact with UI
```

### TC3: Backend Data Verification

**Steps**:

1. Complete Session 1
2. Check backend storage

**Expected**:

- Session record saved in `server/data/sessions/{userId}.json`
- Session includes: day, skillId, score, grade, strengths, weaknesses, completedAt
- Learning plan shows day 1 with `completed: true`
- Skill mastery updated

**Verify**:

```bash
# Check session file
cat server/data/sessions/{userId}.json | jq '.sessions[-1]'

# Should show latest session with all data
```

### TC4: Agent Intelligence Triggers

**Steps**:

1. Complete 3 sessions with scores: 45%, 40%, 42% (low scores)
2. Check agent decisions

**Expected**:

- AdaptorAgent triggers
- Agent debate occurs
- Review days added to learning plan
- Agent decision logged in Dashboard → Agent Brain

**Verify**:

- Dashboard → Agent Brain shows adaptation decision
- Learning plan includes review days

### TC5: Skill Drift Detection

**Steps**:

1. Complete 2 sessions with high scores: 90%, 88%
2. Complete 2 sessions with low scores: 60%, 58%
3. Check agent decisions

**Expected**:

- SkillDriftAgent detects 30pt drop
- Agent decision logged: "Skill Declining"
- Recommendation for spaced repetition

**Verify**:

- Dashboard → Agent Brain shows skill drift warning

## Browser Console Checks

### Success Case

```javascript
// Should see:
// ✅ Session submitted successfully
// ✅ Next day: 2
// ✅ No errors
```

### Error Case

```javascript
// Should see:
// ❌ Failed to submit session: [error message]
// ⚠️ Continuing with local results only
```

## Network Tab Verification

### Request

```http
POST /api/session/submit
Content-Type: application/json

{
  "userId": "user123",
  "day": 1,
  "skillId": "skill-id",
  "challenge": { ... },
  "userResponse": {
    "answers": [ ... ],
    "score": 80,
    "completedAt": "2026-05-03T..."
  }
}
```

### Response (Success)

```json
{
  "success": true,
  "data": {
    "evaluation": {
      "score": 80,
      "grade": "B",
      "strengths": ["..."],
      "weaknesses": ["..."],
      "feedback": "...",
      "source": "llm"
    },
    "adaptations": [],
    "nextDay": 2
  },
  "error": null
}
```

## Visual Verification

### Quiz Result Screen

- [ ] Score displayed prominently (large font, animated count-up)
- [ ] Grade badge (A/B/C/D/F with emoji)
- [ ] "🚀 Continue to Day X →" button at top (emerald gradient)
- [ ] "📖 View Study Notes →" button (indigo gradient)
- [ ] "📓 Reflect" button (purple border)
- [ ] "← Dashboard" button (gray border)

### Study Notes Screen

- [ ] Auto-generated notes sections (collapsible)
- [ ] "🚀 Continue to Day X →" button at top (emerald gradient)
- [ ] "📓 Reflect & Journal" button (purple border)
- [ ] "← Dashboard" button (gray border)

### Dashboard After Session

- [ ] Total Sessions count increased
- [ ] Average Score updated
- [ ] Best Score updated
- [ ] Day 1 marked complete in learning plan
- [ ] Session appears in Recent Sessions
- [ ] Skill mastery percentage updated

## Performance Checks

### Session Submission Time

- [ ] Submission completes in < 2 seconds
- [ ] No UI freeze during submission
- [ ] Smooth transition to results screen

### Navigation Time

- [ ] "Continue to Day X" navigation is instant
- [ ] No loading delay
- [ ] New session loads in < 1 second

## Accessibility Checks

### Keyboard Navigation

- [ ] Can tab to "Continue to Day X" button
- [ ] Can press Enter to activate button
- [ ] Focus visible on button

### Screen Reader

- [ ] Button announces as "Continue to Day 2"
- [ ] Button role is "button"
- [ ] Button state is not disabled

## Mobile Testing

### Responsive Layout

- [ ] "Continue to Day X" button full width on mobile
- [ ] Button text readable (not truncated)
- [ ] Button tap target ≥ 44px height
- [ ] No horizontal scroll

### Touch Interaction

- [ ] Button responds to tap
- [ ] No double-tap required
- [ ] Smooth navigation on tap

## Edge Cases

### EC1: User Refreshes During Quiz

- [ ] Quiz state preserved (answers saved)
- [ ] Can continue from where left off
- [ ] Submission still works

### EC2: User Navigates Away Before Submission

- [ ] Session NOT saved (expected behavior)
- [ ] Can return and retake quiz
- [ ] No duplicate submissions

### EC3: Network Timeout During Submission

- [ ] Error handled gracefully
- [ ] User notified of failure
- [ ] Can retry submission

### EC4: Concurrent Sessions (Multiple Tabs)

- [ ] Only one submission succeeds
- [ ] No race conditions
- [ ] Data consistency maintained

## Regression Testing

### Existing Features Still Work

- [ ] Dashboard loads correctly
- [ ] Learning plan displays correctly
- [ ] Skill tree renders correctly
- [ ] Report generation works
- [ ] Digital Twin works
- [ ] Simulation Lab works
- [ ] Interview Simulator works

## Sign-Off Checklist

- [ ] All test cases pass
- [ ] No console errors
- [ ] No server errors
- [ ] Data persists correctly
- [ ] Navigation works smoothly
- [ ] UI looks polished
- [ ] Mobile responsive
- [ ] Accessible
- [ ] Performance acceptable
- [ ] Edge cases handled

## Known Issues / Limitations

1. **No loading state**: Submission happens silently (could add spinner)
2. **No retry mechanism**: If submission fails, user must refresh and retake quiz
3. **No offline support**: Requires active internet connection
4. **No submission confirmation**: No toast/notification that session was saved

## Future Improvements

1. Add loading spinner during submission
2. Add success toast: "Session saved! 🎉"
3. Add retry button if submission fails
4. Add offline queue for submissions
5. Add progress animation when day completes
6. Add celebration animation (confetti) on session complete
7. Add "Resume Session" if user navigates away mid-quiz
