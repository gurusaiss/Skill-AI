const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  AlignmentType, LevelFormat, BorderStyle, WidthType, ShadingType,
  HeadingLevel, VerticalAlign, Header, Footer, PageNumber
} = require('docx');
const fs = require('fs');

// ── Colors ──────────────────────────────────────────────────────────────────
const NAVY   = "1E3A5F";
const ORANGE = "D45B00";  // Amazon-ish accent
const GREY   = "888888";
const LIGHT_BLUE = "DBE8F4";
const MID_BLUE   = "2E6DA4";
const WHITE  = "FFFFFF";

// ── Helpers ──────────────────────────────────────────────────────────────────
const cellBorder = { style: BorderStyle.SINGLE, size: 4, color: "B0C8E0" };
const allBorders = { top: cellBorder, bottom: cellBorder, left: cellBorder, right: cellBorder };
const noBorder   = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const noBorders  = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };

function spacer(pt = 80) {
  return new Paragraph({ children: [], spacing: { before: 0, after: pt } });
}

function sectionHeader(text) {
  return new Paragraph({
    spacing: { before: 180, after: 80 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 8, color: MID_BLUE, space: 4 } },
    children: [
      new TextRun({
        text,
        bold: true,
        size: 26,          // 13pt
        color: NAVY,
        font: "Calibri",
      }),
    ],
  });
}

function body(text, opts = {}) {
  return new Paragraph({
    spacing: { before: 0, after: 60 },
    children: [
      new TextRun({
        text,
        size: 22,          // 11pt
        font: "Calibri",
        ...opts,
      }),
    ],
  });
}

// ── Document ─────────────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22 } },
    },
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0,
          format: LevelFormat.BULLET,
          text: "•",
          alignment: AlignmentType.LEFT,
          style: {
            run: { font: "Calibri", size: 22 },
            paragraph: { indent: { left: 480, hanging: 280 }, spacing: { after: 50 } },
          },
        }],
      },
    ],
  },

  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1080, right: 1080, bottom: 1080, left: 1080 },
      },
    },

    // ── Header ──────────────────────────────────────────────────────────────
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            spacing: { after: 0 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: MID_BLUE, space: 4 } },
            children: [
              new TextRun({ text: "Statement of Purpose  |  Amazon ML Summer School 2026", size: 18, color: GREY, font: "Calibri" }),
              new TextRun({ text: "   Guru Sai Sumith", size: 18, color: NAVY, bold: true, font: "Calibri" }),
            ],
          }),
        ],
      }),
    },

    // ── Footer ──────────────────────────────────────────────────────────────
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            spacing: { before: 0, after: 0 },
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({ text: "~480 words  |  Amazon ML Summer School 2026  |  sumith.guru@hrud.ai", size: 16, color: GREY, font: "Calibri" }),
            ],
          }),
        ],
      }),
    },

    children: [

      // ── TITLE BLOCK ───────────────────────────────────────────────────────
      new Paragraph({
        spacing: { before: 60, after: 40 },
        children: [
          new TextRun({
            text: "Statement of Purpose",
            bold: true,
            size: 34,
            color: NAVY,
            font: "Calibri",
          }),
        ],
      }),
      new Paragraph({
        spacing: { before: 0, after: 20 },
        children: [
          new TextRun({
            text: "Amazon ML Summer School 2026",
            bold: true,
            size: 26,
            color: MID_BLUE,
            font: "Calibri",
          }),
        ],
      }),

      // Divider line via border
      new Paragraph({
        spacing: { before: 0, after: 60 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: ORANGE, space: 4 } },
        children: [
          new TextRun({
            text: "Guru Sai Sumith  |  [YOUR COLLEGE NAME]  |  [B.Tech/M.Tech — BRANCH]  |  Batch: [2027/2028]",
            size: 19,
            color: "555555",
            font: "Calibri",
          }),
        ],
      }),

      spacer(40),

      // ─────────────────────────────────────────────────────────────────────
      // SECTION 1: MY TECHNICAL JOURNEY
      // ─────────────────────────────────────────────────────────────────────
      sectionHeader("1.  My Technical Journey in AI / ML"),

      body(
        "My entry into AI/ML was not through a textbook — it came from a problem I wanted to solve. " +
        "Watching teams struggle to identify skill gaps and assign the right learning paths, I decided to " +
        "build something that used AI to fix it."
      ),

      spacer(40),

      body("What I’ve explored so far:", { bold: true, size: 22, color: NAVY }),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "Integrated large language models (Gemini 2.0 Flash, Groq 70B / 8B) into a production SaaS platform " +
                "— handling prompt design, response parsing, and tiered fallback when models fail",
          size: 22, font: "Calibri",
        })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "Built a multi-tenant AI assessment engine that generates personalised MCQ / subjective questions " +
                "per employee based on their job role and job description — no two employees get the same question set",
          size: 22, font: "Calibri",
        })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "Designed LLM caching logic (24-hour deduplication) to avoid redundant API calls — " +
                "learned the hard way that LLM costs spiral fast without it",
          size: 22, font: "Calibri",
        })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "Shipped SkillForge AI end-to-end: database schema (Supabase / PostgreSQL), REST API design, " +
                "LLM orchestration, and React frontend — live on Render + Vercel",
          size: 22, font: "Calibri",
        })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [
          new TextRun({ text: "[FILL: e.g. “Completed Andrew Ng’s ML Specialisation / NPTEL course on ML / Kaggle competition rank X”]", size: 22, font: "Calibri", color: ORANGE, italics: true }),
        ],
      }),

      spacer(60),

      // ─────────────────────────────────────────────────────────────────────
      // SECTION 2: WHAT I'VE BUILT
      // ─────────────────────────────────────────────────────────────────────
      sectionHeader("2.  What I’ve Built"),

      body(
        "SkillForge AI is my most substantial AI project — a corporate L&D platform where admins assign " +
        "AI-generated assessments to employees, the system scores them, identifies weak skill areas, and " +
        "auto-generates personalised training modules. Every piece of content is LLM-generated on-demand. " +
        "I handled the full stack: database schema, API design, LLM orchestration, and frontend. " +
        "It is live, multi-user, and was built for a national hackathon — " +
        "[FILL: hackathon name, e.g. “Built for XYZ Hackathon 2026”]."
      ),

      spacer(60),

      // ─────────────────────────────────────────────────────────────────────
      // SECTION 3: KNOWLEDGE GAPS TABLE
      // ─────────────────────────────────────────────────────────────────────
      sectionHeader("3.  Where My Gaps Are → What MLSS Will Fix"),

      // Table: 3 columns
      new Table({
        width: { size: 9360, type: WidthType.DXA },
        columnWidths: [2800, 2960, 3600],
        rows: [
          // Header row
          new TableRow({
            tableHeader: true,
            children: [
              new TableCell({
                borders: allBorders,
                width: { size: 2800, type: WidthType.DXA },
                shading: { fill: NAVY, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Current State", bold: true, size: 20, color: WHITE, font: "Calibri" })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 2960, type: WidthType.DXA },
                shading: { fill: ORANGE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Gap  ►", bold: true, size: 20, color: WHITE, font: "Calibri" })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 3600, type: WidthType.DXA },
                shading: { fill: MID_BLUE, type: ShadingType.CLEAR },
                margins: { top: 80, bottom: 80, left: 120, right: 120 },
                verticalAlign: VerticalAlign.CENTER,
                children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "What MLSS Gives Me", bold: true, size: 20, color: WHITE, font: "Calibri" })] })],
              }),
            ],
          }),
          // Row 1
          new TableRow({
            children: [
              new TableCell({
                borders: allBorders,
                width: { size: 2800, type: WidthType.DXA },
                shading: { fill: "F0F6FB", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "I use LLMs via API", size: 20, font: "Calibri" })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 2960, type: WidthType.DXA },
                shading: { fill: "FFF5EE", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Don’t know how transformers work internally", size: 20, font: "Calibri", italics: true })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 3600, type: WidthType.DXA },
                shading: { fill: "EBF4FF", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Attention mechanisms, NLP fundamentals", size: 20, font: "Calibri", bold: true, color: NAVY })] })],
              }),
            ],
          }),
          // Row 2
          new TableRow({
            children: [
              new TableCell({
                borders: allBorders,
                width: { size: 2800, type: WidthType.DXA },
                shading: { fill: "F0F6FB", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "I build ML-integrated products", size: 20, font: "Calibri" })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 2960, type: WidthType.DXA },
                shading: { fill: "FFF5EE", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "No formal training in model training / fine-tuning", size: 20, font: "Calibri", italics: true })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 3600, type: WidthType.DXA },
                shading: { fill: "EBF4FF", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Supervised / unsupervised learning, loss functions", size: 20, font: "Calibri", bold: true, color: NAVY })] })],
              }),
            ],
          }),
          // Row 3
          new TableRow({
            children: [
              new TableCell({
                borders: allBorders,
                width: { size: 2800, type: WidthType.DXA },
                shading: { fill: "F0F6FB", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "I work with data in SQL / JSON", size: 20, font: "Calibri" })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 2960, type: WidthType.DXA },
                shading: { fill: "FFF5EE", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "No hands-on with feature engineering or ML pipelines", size: 20, font: "Calibri", italics: true })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 3600, type: WidthType.DXA },
                shading: { fill: "EBF4FF", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Statistics, probability, model evaluation", size: 20, font: "Calibri", bold: true, color: NAVY })] })],
              }),
            ],
          }),
          // Row 4
          new TableRow({
            children: [
              new TableCell({
                borders: allBorders,
                width: { size: 2800, type: WidthType.DXA },
                shading: { fill: "F0F6FB", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "I apply AI at product level", size: 20, font: "Calibri" })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 2960, type: WidthType.DXA },
                shading: { fill: "FFF5EE", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Haven’t studied RL or recommendation systems", size: 20, font: "Calibri", italics: true })] })],
              }),
              new TableCell({
                borders: allBorders,
                width: { size: 3600, type: WidthType.DXA },
                shading: { fill: "EBF4FF", type: ShadingType.CLEAR },
                margins: { top: 70, bottom: 70, left: 120, right: 120 },
                children: [new Paragraph({ children: [new TextRun({ text: "Amazon-scale real-world ML use cases", size: 20, font: "Calibri", bold: true, color: NAVY })] })],
              }),
            ],
          }),
        ],
      }),

      spacer(60),

      body(
        "I can build systems around ML — but I cannot yet build the ML itself. " +
        "I understand what a model does, but not how to train, evaluate, or improve one from scratch. " +
        "MLSS is exactly the structured foundation I am missing."
      ),

      spacer(60),

      // ─────────────────────────────────────────────────────────────────────
      // SECTION 4: WHY I AM THE RIGHT FIT
      // ─────────────────────────────────────────────────────────────────────
      sectionHeader("4.  Why I Am the Right Fit"),

      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "I learn by building — every concept I’ve picked up has been because I needed it to ship something real, not to pass an exam",
          size: 22, font: "Calibri",
        })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "I already operate at the intersection of AI and product — I understand what makes an ML feature actually useful vs. technically impressive but useless",
          size: 22, font: "Calibri",
        })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "I am not starting from zero: I know linear algebra basics, Python, SQL, and have shipped AI features in production",
          size: 22, font: "Calibri",
        })],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [
          new TextRun({ text: "[FILL: Academic achievement — e.g. “CGPA 8.5/10” / “Top 5% in department” / “Relevant award or scholarship”]", size: 22, font: "Calibri", color: ORANGE, italics: true }),
        ],
      }),
      new Paragraph({
        numbering: { reference: "bullets", level: 0 },
        children: [new TextRun({
          text: "My goal after MLSS: move from “AI integrator” to “ML engineer” — building models, not just calling them",
          size: 22, font: "Calibri",
        })],
      }),

      spacer(80),

      // Closing line — bold, centred, navy box feel
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 60, after: 60 },
        border: {
          top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 6 },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 6 },
        },
        children: [
          new TextRun({
            text: "“I am not applying to learn what AI is. I am applying to learn how to build it.”",
            bold: true,
            size: 24,
            color: NAVY,
            font: "Calibri",
            italics: true,
          }),
        ],
      }),

      spacer(20),
    ],
  }],
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync("C:\\CODING\\HACKap\\amazon-mlss-sop.docx", buf);
  console.log("Done: amazon-mlss-sop.docx");
});
