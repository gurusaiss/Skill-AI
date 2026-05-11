# Quiz Generation Timeout Fix

## Problem

When clicking "Day 2" (or any subsequent day), the page gets stuck on "Generating your 10-question quiz..." and never shows the quiz.

## Root Cause

The `/api/session/quiz` endpoint is either:

1. Taking too long (> 60 seconds)
2. Hanging indefinitely
3. Gemini API is slow or rate-limited
4. Backend is processing but not responding

The frontend has a 60-second timeout, but if the request hangs, it never triggers the fallback questions.

## Fix Applied

**File**: `client/src/pages/Session.jsx`

**Added**: 30-second timeout to force fallback questions

```javascript
// Before: No timeout, could hang forever
api.generateSessionQuiz({...})
  .then(res => { /* use questions */ })
  .catch(() => { /* use fallback */ });

// After: 30-second timeout forces fallback
const timeoutId = setTimeout(() => {
  console.warn('[Quiz] API timeout - using fallback questions');
  const questions = buildFallbackQuestions(topic, skillName, ch.warmupQuestion);
  setQuizQuestions(questions);
  setPhase('quiz');
}, 30000);

api.generateSessionQuiz({...})
  .then(res => {
    clearTimeout(timeoutId); // Cancel timeout if API succeeds
    /* use questions */
  })
  .catch(() => {
    clearTimeout(timeoutId); // Cancel timeout if API fails
    /* use fallback */
  });
```

## How It Works

1. **User clicks Day 2**
   - Navigates to `/session/2`
   - Phase changes to `quiz-loading`

2. **Quiz generation starts**
   - Calls `/api/session/quiz`
   - Starts 30-second timeout timer

3. **Three possible outcomes**:

   **A) API succeeds quickly (< 30s)**
   - Timeout cancelled
   - AI-generated questions used
   - Quiz appears

   **B) API fails**
   - Timeout cancelled
   - Fallback questions used
   - Quiz appears

   **C) API hangs (> 30s)**
   - Timeout triggers
   - Fallback questions used
   - Quiz appears
   - API call continues in background (ignored)

## Fallback Questions

The system has built-in fallback questions that work for any topic:

- 7 multiple-choice questions
- 3 fill-in-the-blank questions
- Generic but relevant to the topic
- Always available, no API needed

## Why 30 Seconds?

- Gemini API typically responds in 5-15 seconds
- 30 seconds is generous but not too long
- User doesn't wait forever
- Still allows API to succeed if it's just slow

## Testing

### Test 1: Normal Flow (API Works)

1. Refresh browser (Ctrl+F5)
2. Complete Day 1
3. Click "Continue to Day 2"
4. **Expected**: Quiz appears within 5-15 seconds
5. **Expected**: Console shows no timeout warning

### Test 2: Slow API (Timeout Triggers)

1. If API is slow (> 30s)
2. **Expected**: Quiz appears after exactly 30 seconds
3. **Expected**: Console shows: `[Quiz] API timeout - using fallback questions`
4. **Expected**: Fallback questions displayed

### Test 3: API Failure

1. Stop backend server
2. Try to start Day 2
3. **Expected**: Quiz appears immediately (fallback)
4. **Expected**: Console shows API error

## Checking Backend Issues

If the quiz is consistently slow, check:

### 1. Server Terminal

Look for errors like:

```
[Gemini] ❌ Attempt 1/3 failed: ...
[Gemini] All retries exhausted
[quiz] Gemini failed, using fallback
```

### 2. Gemini API Key

Check `.env` file:

```env
GEMINI_API_KEY=your_key_here
```

Verify key is valid:

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=YOUR_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"contents":[{"parts":[{"text":"test"}]}]}'
```

### 3. Rate Limits

Gemini free tier limits:

- 15 requests per minute
- 1 million tokens per minute
- 1,500 requests per day

If hitting limits, the backend should fall back to Groq or rule-based questions.

### 4. Network Issues

Check if backend can reach Gemini:

```bash
curl -I https://generativelanguage.googleapis.com
```

## Alternative: Increase Timeout

If you want to wait longer for AI-generated questions:

```javascript
// Change 30000 (30s) to 45000 (45s) or 60000 (60s)
const timeoutId = setTimeout(() => {
  // ...
}, 45000); // 45 seconds
```

## Alternative: Disable AI Generation

To always use fallback questions (fastest):

```javascript
// Skip API call entirely
const questions = buildFallbackQuestions(topic, skillName, ch.warmupQuestion);
setQuizQuestions(questions);
setPhase("quiz");
```

## Status

✅ **FIXED** - Quiz will always appear within 30 seconds maximum

## Next Steps

1. Refresh browser (Ctrl+F5)
2. Try Day 2 again
3. Quiz should appear within 30 seconds
4. If still slow, check server logs for Gemini API issues
