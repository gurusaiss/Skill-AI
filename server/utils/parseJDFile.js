/**
 * parseJDFile.js — Extract text content from uploaded JD files
 * Supports: PDF, DOCX, TXT, RTF (reads as text)
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

/**
 * Extract text from a JD file for use in assessment generation
 * @param {string} filePath - Absolute path to the file
 * @param {string} originalName - Original filename (for extension detection)
 * @returns {Promise<string>} Extracted text content
 */
export async function parseJDFile(filePath, originalName = '') {
  if (!filePath || !existsSync(filePath)) return '';

  const ext = path.extname(originalName || filePath).toLowerCase();

  try {
    // PDF
    if (ext === '.pdf') {
      try {
        const pdfParse = (await import('pdf-parse')).default;
        const buffer = readFileSync(filePath);
        const data = await pdfParse(buffer);
        return (data.text || '').trim();
      } catch (e) {
        console.warn('[parseJDFile] PDF parse failed:', e.message);
        return '';
      }
    }

    // DOCX
    if (ext === '.docx') {
      try {
        const mammoth = await import('mammoth').catch(() => null);
        if (mammoth) {
          const result = await mammoth.extractRawText({ path: filePath });
          return (result.value || '').trim();
        }
      } catch {}
      // Fallback: read buffer and extract printable text
      try {
        const buf = readFileSync(filePath);
        // Basic text extraction from OOXML zip — look for text between XML tags
        const str = buf.toString('utf8', 0, Math.min(buf.length, 200000));
        const matches = str.match(/<w:t[^>]*>([^<]+)<\/w:t>/g) || [];
        return matches.map(m => m.replace(/<[^>]+>/g, '')).join(' ').trim();
      } catch (e) {
        return '';
      }
    }

    // DOC (legacy binary — limited support, extract printable ASCII)
    if (ext === '.doc') {
      try {
        const buf = readFileSync(filePath);
        // Extract printable ASCII sequences of 4+ chars from binary doc
        const text = buf.toString('latin1')
          .replace(/[^\x20-\x7E\n\r\t]/g, ' ')
          .replace(/\s{3,}/g, ' ')
          .trim();
        return text.length > 50 ? text.slice(0, 10000) : '';
      } catch { return ''; }
    }

    // TXT, RTF, and other text-based formats
    const text = readFileSync(filePath, 'utf8');
    return text.trim();

  } catch (e) {
    console.warn('[parseJDFile] Failed to parse:', e.message);
    return '';
  }
}

/**
 * Extract skills/keywords from JD text for assessment prompting
 */
export function extractSkillsFromJDText(text) {
  if (!text || text.length < 20) return [];

  // Common tech skill patterns
  const techPatterns = [
    /\b(React|Angular|Vue|Node\.?js|Express|Django|Flask|Spring|Laravel)\b/gi,
    /\b(Python|Java|JavaScript|TypeScript|C\+\+|C#|Go|Rust|Kotlin|Swift)\b/gi,
    /\b(SQL|MySQL|PostgreSQL|MongoDB|Redis|DynamoDB|Cassandra)\b/gi,
    /\b(AWS|Azure|GCP|Docker|Kubernetes|CI\/CD|DevOps|Linux)\b/gi,
    /\b(Machine Learning|Deep Learning|NLP|Data Science|TensorFlow|PyTorch)\b/gi,
    /\b(REST|GraphQL|gRPC|Microservices|API|OAuth|JWT)\b/gi,
    /\b(Git|Agile|Scrum|Jira|Confluence|Figma|Postman)\b/gi,
  ];

  const skills = new Set();
  for (const pattern of techPatterns) {
    const matches = text.match(pattern) || [];
    matches.forEach(m => skills.add(m.trim()));
  }

  // Also extract capitalized multi-word phrases (likely technologies/tools)
  const phraseMatches = text.match(/\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){1,3}\b/g) || [];
  phraseMatches.slice(0, 10).forEach(m => {
    if (m.length > 4 && m.length < 40) skills.add(m);
  });

  return [...skills].slice(0, 20);
}
