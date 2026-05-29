import express from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as pdfParse from 'pdf-parse';
import SmartAgent from '../agent/SmartAgent.js';
import { authenticate } from '../middleware/auth.js';
import UserStore from '../services/UserStore.js';

// Lazy-import Socket.io emitter to avoid circular dependency at startup
let _emitToUser;
async function emitToUser(userId, event, data) {
  if (!_emitToUser) {
    try { ({ emitToUser: _emitToUser } = await import('../index.js')); } catch { /* no-op */ }
  }
  _emitToUser?.(userId, event, data);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
const agent = new SmartAgent();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    // Create uploads directory if it doesn't exist
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Only allow PDF files
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  }
});

// Helper function to extract text from PDF
const extractTextFromPDF = async (filePath) => {
  try {
    const dataBuffer = fs.readFileSync(filePath);
    const data = await pdfParse(dataBuffer);
    return data.text;
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to process PDF file');
  }
};

/**
 * POST /api/goal
 * Submit learning goal and get skill tree + diagnostic questions
 * Supports both JSON requests and multipart/form-data for PDF uploads
 * Requires authentication - uses learningUUID from authenticated user
 */
router.post('/', authenticate, upload.single('jobDescriptionFile'), async (req, res) => {
  let uploadedFilePath = null;
  
  try {
    const { goalText, profilingData } = req.body;
    
    // Extract learningUUID from authenticated user
    const userId = req.user.learningUUID;

    // Validate goal text
    if (!goalText || goalText.length < 5 || goalText.length > 500) {
      return res.status(400).json({
        success: false,
        data: null,
        error: 'Goal text must be between 5 and 500 characters'
      });
    }

    let jobDescriptionText = null;
    
    // Process PDF file if uploaded
    if (req.file) {
      uploadedFilePath = req.file.path;
      try {
        jobDescriptionText = await extractTextFromPDF(uploadedFilePath);
        console.log(`Extracted ${jobDescriptionText.length} characters from PDF`);
      } catch (pdfError) {
        console.error('PDF processing error:', pdfError);
        // Don't fail the request if PDF processing fails, just log it
        jobDescriptionText = null;
      }
    }

    // Emit real-time progress events to the user's socket room
    const authUserId = req.user.userId;
    emitToUser(authUserId, 'agent:progress', { stage: 'decomposing', message: 'Analyzing goal and building skill tree…' });

    // Process goal with learningUUID from authenticated user
    // Also pass authUserId to link the session to the authenticated user
    const result = await agent.processGoal(
      goalText, 
      userId, 
      profilingData || null,
      req.user.userId, // Pass authUserId for session linking
      jobDescriptionText // Pass extracted job description text
    );
    
    res.json({
      success: true,
      data: result,
      error: null
    });
  } catch (error) {
    console.error('[POST /api/goal]', error);
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  } finally {
    // Clean up uploaded file
    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupError) {
        console.error('Error cleaning up uploaded file:', cleanupError);
      }
    }
  }
});

/**
 * GET /api/goal/:userId
 * Get full session data
 * Requires authentication - users can only access their own data
 * Admins can access any user's data
 */
router.get('/:userId', authenticate, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Authorization check: users can only access their own data, admins can access any
    if (req.user.role !== 'admin' && req.user.userId !== userId) {
      return res.status(403).json({
        success: false,
        data: null,
        error: 'Access denied: You can only access your own learning data'
      });
    }
    
    // Get the learningUUID for the user
    const storedUser = await UserStore.getUserById(req.user.userId);
    const learningUUID = storedUser.learningUUID;
    
    const session = await agent.loadSession(learningUUID);

    res.json({
      success: true,
      data: session,
      error: null
    });
  } catch (error) {
    console.error('[GET /api/goal/:userId]', error);
    
    if (error.message.includes('not found')) {
      return res.status(404).json({
        success: false,
        data: null,
        error: error.message
      });
    }
    
    res.status(500).json({
      success: false,
      data: null,
      error: error.message
    });
  }
});

export default router;
