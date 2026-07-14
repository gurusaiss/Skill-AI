/**
 * textPreprocessor.js — Clean extracted document text before storage and generation.
 *
 * Removes: headers, footers, page numbers, author/reviewer names, version lines,
 * copyright notices, confidentiality labels, document metadata, and filename text.
 * Preserves: all actual learning content — paragraphs, steps, tables, lists, rules.
 */

// Patterns that identify header/footer/metadata lines — never learning content.
const METADATA_LINE_PATTERNS = [
  /^\s*page\s+\d+(\s+of\s+\d+)?\s*$/i,          // "Page 3", "Page 3 of 12"
  /^\s*-+\s*\d+\s*-+\s*$/,                        // "--- 5 ---"
  /^\s*\d+\s*\/\s*\d+\s*$/,                       // "3/12"
  /^\s*(confidential|private\s*&?\s*confidential|internal\s+use\s+only|strictly\s+confidential|for\s+internal\s+use)\s*$/i,
  /^\s*(proprietary|trade\s+secret|not\s+for\s+distribution|draft|working\s+copy)\s*$/i,
  /^\s*(copyright|©).{0,80}$/i,                   // copyright lines
  /^\s*all\s+rights\s+reserved/i,
  /^\s*(author|created\s+by|prepared\s+by|written\s+by|authored\s+by)\s*[:–-]/i,
  /^\s*(reviewed\s+by|approved\s+by|verified\s+by|checked\s+by)\s*[:–-]/i,
  /^\s*(document\s+(id|number|no|ref|code)|doc\s+(id|no|ref))\s*[:–-]/i,
  /^\s*(version|ver|rev|revision)\s*[:–#]?\s*\d/i,
  /^\s*(date|effective\s+date|issue\s+date|last\s+updated|updated\s+on)\s*[:–-]/i,
  /^\s*(printed\s+by|generated\s+by|exported\s+by|downloaded\s+by)\s*/i,
  /^\s*(file\s*name|filename)\s*[:–-]/i,
  /^\s*\[?\s*(header|footer|watermark|logo|image)\s*\]?\s*$/i,
  /^\s*(owner|maintainer|poc|point\s+of\s+contact)\s*[:–-]/i,
  /^\s*classification\s*[:–-]\s*(public|internal|confidential|restricted)/i,
];

// Section headings in JD that signal NON-learning content to discard.
const JD_SKIP_SECTION_PATTERNS = [
  /\b(about\s+(us|the\s+company|our\s+company|acme|organization|organisation))\b/i,
  /\b(who\s+we\s+are|our\s+story|company\s+overview|company\s+profile)\b/i,
  /\b(what\s+we\s+offer|what\s+you('ll|'ll|\s+will)\s+get|employee\s+benefits?|benefits?\s+package|perks)\b/i,
  /\b(compensation|salary|pay|remuneration|ctc|package)\b/i,
  /\b(equal\s+opportunity|eeo|diversity\s+statement|inclusion\s+statement)\b/i,
  /\b(how\s+to\s+apply|application\s+process|apply\s+now|apply\s+here|send\s+your\s+(cv|resume))\b/i,
  /\b(contact\s+(us|information|details|hr))\b/i,
  /\b(about\s+this\s+role\s+—?\s*overview|note\s+to\s+candidates|important\s+notice)\b/i,
  /\b(legal\s+(notice|disclaimer)|terms\s+(and|&)\s+conditions)\b/i,
];

// Section headings in JD that signal LEARNING content to keep.
const JD_KEEP_SECTION_PATTERNS = [
  /\b(responsibilities|key\s+responsibilities|primary\s+responsibilities|core\s+responsibilities|principal\s+duties)\b/i,
  /\b(roles?\s+and\s+responsibilities|role\s+overview|role\s+description|position\s+summary)\b/i,
  /\b(what\s+you('ll|'ll|\s+will)\s+do|day.to.day|key\s+duties|duties\s+and\s+responsibilities)\b/i,
  /\b(requirements?|qualifications?|required\s+qualifications?)\b/i,
  /\b(skills?\s+required|required\s+skills?|technical\s+skills?|core\s+skills?|key\s+skills?)\b/i,
  /\b(must\s+have|essential\s+skills?|mandatory\s+skills?|minimum\s+requirements?)\b/i,
  /\b(experience\s+required|work\s+experience|preferred\s+qualifications?)\b/i,
  /\b(knowledge\s+and\s+skills?|competencies|capabilities)\b/i,
  /\b(job\s+(description|summary|overview|profile|duties))\b/i,
];

/**
 * Remove header/footer/metadata noise from a single line.
 * Returns true if the line should be discarded.
 */
function isMetadataLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Pure numeric lines (page numbers, doc codes)
  if (/^\d+$/.test(trimmed) && trimmed.length < 5) return true;

  // Short lines that match metadata patterns
  for (const pattern of METADATA_LINE_PATTERNS) {
    if (pattern.test(trimmed)) return true;
  }

  return false;
}

/**
 * Clean extracted text: remove metadata lines while preserving all learning content.
 * Works for any document type (SOP, runbook, training manual, etc.).
 */
export function preprocessDocumentText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  const lines = rawText.split('\n');
  const cleaned = [];

  for (const line of lines) {
    if (isMetadataLine(line)) continue;
    cleaned.push(line);
  }

  // Collapse excessive blank lines (3+ → 2)
  return cleaned
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Extract only role-relevant content from a JD.
 * Keeps: responsibilities, required skills, experience, competencies.
 * Removes: about us, benefits, salary, equal opportunity, contact/apply, legal.
 *
 * Strategy: scan for section headings and include/exclude sections based on their heading.
 * If no section structure is detected, fall back to full text (preprocessed).
 */
export function extractJDCoreContent(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  // First apply general metadata cleaning
  const text = preprocessDocumentText(rawText);
  const lines = text.split('\n');

  // Detect if this JD has a recognizable section structure.
  // A "section heading" is a line that: is short (<= 80 chars), ends without
  // punctuation typical of sentences, and is either ALL CAPS or Title Case or
  // followed by a colon.
  const isSectionHeading = (line) => {
    const t = line.trim();
    if (!t || t.length > 80 || t.length < 3) return false;
    return (
      /^[A-Z][A-Z\s&/,()-]{4,}$/.test(t) ||        // ALL CAPS heading
      /^[A-Z][a-zA-Z\s&/,()-]+:?\s*$/.test(t) ||   // Title Case heading
      t.endsWith(':')                                 // ends with colon
    );
  };

  let hasSections = false;
  for (const line of lines) {
    if (isSectionHeading(line)) {
      if (JD_KEEP_SECTION_PATTERNS.some(p => p.test(line)) ||
          JD_SKIP_SECTION_PATTERNS.some(p => p.test(line))) {
        hasSections = true;
        break;
      }
    }
  }

  // No recognizable section structure → return full preprocessed text.
  // (Small / plaintext JDs often have no headings — keep everything.)
  if (!hasSections) return text;

  // Section-aware extraction: keep lines in "keep" sections, discard "skip" sections.
  // Unknown sections (no pattern match) are KEPT — fail-safe to include.
  const result = [];
  let inSkipSection = false;
  let inKeepSection = true; // default: keep content before the first heading

  for (const line of lines) {
    if (isSectionHeading(line)) {
      const isKeep = JD_KEEP_SECTION_PATTERNS.some(p => p.test(line));
      const isSkip = JD_SKIP_SECTION_PATTERNS.some(p => p.test(line));

      if (isKeep) {
        inSkipSection = false;
        inKeepSection = true;
        result.push(line); // keep the heading itself
      } else if (isSkip) {
        inSkipSection = true;
        inKeepSection = false;
        // Don't add the skip heading
      } else {
        // Unknown section — keep it (fail-safe)
        inSkipSection = false;
        inKeepSection = true;
        result.push(line);
      }
      continue;
    }

    if (inKeepSection && !inSkipSection) {
      result.push(line);
    }
  }

  const extracted = result.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  // Safety: if extraction removed too much (< 20% of original), fall back to full text
  if (extracted.length < text.length * 0.2 && text.length > 200) {
    return text;
  }

  return extracted;
}

/**
 * Strip the filename from the beginning of extracted text.
 * Some PDF/DOCX parsers include the filename as the first line.
 */
export function removeFilenameFromText(text, filename) {
  if (!text || !filename) return text;
  // Remove extension and normalize
  const baseName = filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').toLowerCase().trim();
  const firstLine = (text.split('\n')[0] || '').trim().toLowerCase();

  if (
    firstLine === baseName ||
    firstLine.startsWith(baseName) ||
    baseName.startsWith(firstLine.replace(/[^a-z0-9 ]/g, ''))
  ) {
    return text.replace(/^[^\n]+\n/, '').trim();
  }
  return text;
}
