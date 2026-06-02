from fpdf import FPDF

md_path = r'C:\CODING\HACKap\AUTH_BUG_REPORT.md'
pdf_path = r'C:\CODING\HACKap\AUTH_BUG_REPORT.pdf'

with open(md_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

pdf = FPDF()
pdf.set_auto_page_break(auto=True, margin=15)
pdf.add_page()
pdf.set_font('Arial', '', 12)

for raw in lines:
    line = raw.rstrip('\n')
    if line.startswith('# '):
        pdf.set_font('Arial', 'B', 20)
        pdf.multi_cell(0, 10, line[2:])
        pdf.ln(2)
        pdf.set_font('Arial', '', 12)
    elif line.startswith('## '):
        pdf.set_font('Arial', 'B', 16)
        pdf.multi_cell(0, 10, line[3:])
        pdf.ln(1)
        pdf.set_font('Arial', '', 12)
    elif line.startswith('### '):
        pdf.set_font('Arial', 'B', 14)
        pdf.multi_cell(0, 8, line[4:])
        pdf.ln(1)
        pdf.set_font('Arial', '', 12)
    elif line.startswith('- ') or line.startswith('* '):
        pdf.set_x(pdf.get_x() + 5)
        pdf.multi_cell(0, 7, '- ' + line[2:])
    elif line.startswith('```'):
        continue
    elif line.startswith('    '):
        pdf.set_font('Courier', '', 11)
        pdf.multi_cell(0, 6, line.strip())
        pdf.set_font('Arial', '', 12)
    elif line.strip() == '---':
        pdf.ln(2)
    else:
        pdf.multi_cell(0, 7, line)

pdf.output(pdf_path)
print('PDF created:', pdf_path)
