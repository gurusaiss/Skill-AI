# Backend Fix - GeminiService Import Error

## Error

```
TypeError: GeminiService is not a constructor
at file:///C:/CODING/HACKap/server/routes/session.js:7:16
```

## Root Cause

`server/routes/session.js` was trying to instantiate `GeminiService` with `new GeminiService()`, but `GeminiService.js` exports a singleton instance, not a class constructor.

**GeminiService.js exports**:

```javascript
export default new GeminiService(); // Singleton instance
```

**session.js was incorrectly doing**:

```javascript
import GeminiService from "../services/GeminiService.js";
const gemini = new GeminiService(); // ❌ Error: not a constructor
```

## Fix Applied

**File**: `server/routes/session.js`

**Before**:

```javascript
import GeminiService from "../services/GeminiService.js";

const router = express.Router();
const agent = new SmartAgent();
const gemini = new GeminiService(); // ❌ Wrong
```

**After**:

```javascript
import gemini from "../services/GeminiService.js";

const router = express.Router();
const agent = new SmartAgent();
// gemini is already an instance - no need for 'new'
```

## Why This Works

`GeminiService.js` uses the **Singleton pattern**:

- Only one instance exists throughout the application
- Exported as `export default new GeminiService()`
- Import it directly as an instance, not as a class

## Other Files Using GeminiService Correctly

All other files import and use it correctly:

```javascript
// SmartAgent.js
import GeminiService from '../services/GeminiService.js';
const aiPowered = GeminiService.isEnabled();  // ✅ Correct

// SkillDecomposer.js
import GeminiService from '../services/GeminiService.js';
const result = await GeminiService.generateJSON(prompt);  // ✅ Correct

// Evaluator.js
import GeminiService from '../services/GeminiService.js';
if (GeminiService.isEnabled()) { ... }  // ✅ Correct
```

They all treat the import as an instance, not a constructor.

## Verification

```bash
# Syntax check passed
node --check server/routes/session.js
# Exit Code: 0 ✅

node --check server/index.js
# Exit Code: 0 ✅
```

## Testing

Start the backend server:

```bash
cd server
npm run dev
```

Expected output:

```
🚀 SkillForge AI Server running on http://localhost:3001
✅ All routes registered
📊 Gemini 2.0 Flash: [enabled/disabled]
🔄 Groq fallback: [enabled/disabled]
```

## Status

✅ **FIXED** - Backend should now start without errors
