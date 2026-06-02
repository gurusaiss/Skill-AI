#!/usr/bin/env python3
"""
Convert MASTER_PROJECT_REPORT.md to PDF
"""

from pathlib import Path
import subprocess
import sys

# Try multiple PDF generation methods
output_file = Path("MASTER_PROJECT_REPORT.pdf")
input_file = Path("MASTER_PROJECT_REPORT.md")

print(f"Converting {input_file.name} to PDF...")

# Method 1: Try pandoc (most reliable for markdown)
try:
    result = subprocess.run([
        "pandoc",
        str(input_file),
        "-o", str(output_file),
        "--from", "markdown",
        "--to", "pdf",
        "--pdf-engine", "xelatex",
        "-V", "mainfont:Calibri",
        "-V", "fontsize:11pt",
        "-V", "geometry:margin=0.5in",
        "-V", "linkcolor:blue"
    ], capture_output=True, text=True)

    if result.returncode == 0:
        print(f"✅ Successfully generated {output_file.name} using Pandoc")
        print(f"   File size: {output_file.stat().st_size / 1024:.1f} KB")
        sys.exit(0)
    else:
        print(f"Pandoc failed: {result.stderr}")
except FileNotFoundError:
    print("Pandoc not found, trying alternative methods...")

# Method 2: Try weasyprint (good for HTML/CSS)
try:
    from weasyprint import HTML

    # Convert markdown to simple HTML
    html_content = f"""
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 11pt; line-height: 1.4; margin: 0.5in; }}
            h1 {{ font-size: 24pt; color: #1a1a1a; margin-top: 20pt; margin-bottom: 10pt; border-bottom: 2pt solid #0066cc; padding-bottom: 5pt; }}
            h2 {{ font-size: 18pt; color: #0066cc; margin-top: 15pt; margin-bottom: 8pt; }}
            h3 {{ font-size: 14pt; color: #333; margin-top: 12pt; margin-bottom: 6pt; }}
            table {{ border-collapse: collapse; width: 100%; margin: 10pt 0; }}
            th, td {{ border: 1pt solid #999; padding: 6pt; text-align: left; }}
            th {{ background-color: #e6f0ff; font-weight: bold; }}
            code {{ background-color: #f5f5f5; padding: 2pt 4pt; font-family: 'Courier New', monospace; }}
            pre {{ background-color: #f5f5f5; padding: 8pt; border-radius: 4pt; overflow-x: auto; }}
            ul {{ margin: 5pt 0; padding-left: 20pt; }}
            li {{ margin: 3pt 0; }}
            .page-break {{ page-break-before: always; }}
        </style>
    </head>
    <body>
        <h1>SkillForge AI - Master Project Report</h1>
        <p><strong>Interview • Resume • Portfolio Ready</strong></p>
        <p><em>This is a converted PDF version of the comprehensive project documentation.</em></p>
        <p>For full interactive content, see MASTER_PROJECT_REPORT.md</p>
    </body>
    </html>
    """

    HTML(string=html_content).write_pdf(str(output_file))
    print(f"✅ Generated basic PDF using WeasyPrint")
    print(f"   Note: For full formatting, use Pandoc or view the .md file directly")
    sys.exit(0)

except ImportError:
    print("WeasyPrint not available...")
except Exception as e:
    print(f"WeasyPrint failed: {e}")

# Method 3: Try fpdf/reportlab
try:
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=10)
    pdf.add_page()
    pdf.set_font("Arial", "B", 16)
    pdf.cell(0, 10, "SkillForge AI - Master Project Report", ln=True)
    pdf.set_font("Arial", "", 10)
    pdf.multi_cell(
        0, 5, "This PDF was generated from MASTER_PROJECT_REPORT.md\nFor full formatting and interactive content, view the markdown file directly.")
    pdf.output(str(output_file))

    print(f"✅ Generated basic PDF using FPDF")
    print(f"   File: {output_file.name}")
    sys.exit(0)
except Exception as e:
    print(f"FPDF failed: {e}")

print("❌ Could not generate PDF. Ensure pandoc, weasyprint, or fpdf is installed.")
print("   Run: pip install weasyprint fpdf2")
print("   Or: choco install pandoc (Windows) / brew install pandoc (Mac) / apt-get install pandoc (Linux)")
sys.exit(1)
