/**
 * Opens a styled print window and triggers the browser's print dialog.
 * The browser renders fonts (including Thai/Prompt) correctly.
 * User can "Save as PDF" from the print dialog.
 */
/** Escape user/external text before interpolating it into printPDF's HTML. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!));
}

export function printPDF(htmlContent: string, title = 'Document') {
  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;

  win.document.write(`<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8" />
  <title>${title}</title>
  <base href="${window.location.origin}/" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link href="https://fonts.googleapis.com/css2?family=Prompt:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Prompt', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; background: #fff; }
    /* Remove browser-added header / footer (URL, title, page-number).
       @page must be at top level — NOT inside @media print — to work in Chrome/Edge/Firefox. */
    @page { size: A4 portrait; margin: 0; }
    @media print {
      body { font-size: 10pt; }
      .no-print { display: none !important; }
      * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      .page { width: 210mm !important; min-height: 297mm !important; padding: 8mm 10mm !important; }
    }
    /* --- layout --- */
    .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 12mm 14mm; background: #fff; }
    /* --- header --- */
    .doc-header { display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1.5px solid #d1d5db; margin-bottom: 20px; }
    .logo-wrap { display: flex; align-items: center; gap: 10px; }
    .logo-ring { width: 48px; height: 48px; }
    .logo-text h1 { font-size: 18pt; font-weight: 700; color: #1e3a8a; letter-spacing: -0.5px; line-height: 1.1; }
    .logo-text p  { font-size: 8pt; color: #1e40af; letter-spacing: 2px; font-weight: 400; }
    .doc-title-block { text-align: right; }
    .doc-title-block .doc-type { font-size: 16pt; font-weight: 700; color: #1e3a8a; letter-spacing: 0.5px; }
    .doc-title-block .doc-meta { font-size: 9pt; color: #6b7280; margin-top: 4px; line-height: 1.7; }
    /* --- info grid --- */
    .info-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-bottom: 22px; }
    .info-box h3 { font-size: 9pt; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: 1px; margin-bottom: 6px; }
    .info-box p  { font-size: 10.5pt; line-height: 1.65; color: #111827; }
    /* --- table --- */
    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 10pt; }
    thead th { background: #1e3a8a; color: #fff; font-weight: 600; padding: 8px 10px; text-align: left; font-size: 10pt; }
    tbody td { padding: 7px 10px; border: 1px solid #e5e7eb; vertical-align: top; line-height: 1.5; }
    tbody tr:nth-child(even) td { background: #f9fafb; }
    /* --- summary box --- */
    .summary-box { background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 12px 16px; margin-bottom: 20px; }
    .summary-box h3 { font-size: 9pt; font-weight: 600; text-transform: uppercase; color: #6b7280; letter-spacing: 1px; margin-bottom: 8px; }
    .summary-box p  { font-size: 10.5pt; color: #111827; line-height: 1.65; }
    /* --- signatures --- */
    .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 40px; margin-top: 36px; padding-top: 20px; border-top: 1px solid #e5e7eb; }
    .sig-box { text-align: center; }
    .sig-box .sig-line { border-bottom: 1px dashed #9ca3af; height: 32px; margin-bottom: 6px; }
    .sig-box .sig-label { font-size: 9pt; color: #6b7280; }
    /* --- print button --- */
    .print-btn { display: block; margin: 20px auto 0; padding: 10px 32px; background: #1e3a8a; color: #fff; border: none; border-radius: 6px; font-family: 'Prompt', sans-serif; font-size: 11pt; cursor: pointer; }
    .print-btn:hover { background: #1e40af; }
  </style>
</head>
<body>
<div class="page">
${htmlContent}
</div>
<button class="print-btn no-print" onclick="window.print()">พิมพ์ / บันทึก PDF</button>
</body>
</html>`);

  win.document.close();
}

// Logo image for embedding in print templates
export const logoSVG = `<img src="/ozone360-logo-real.png" alt="OZONE360" style="height:52px;width:auto;object-fit:contain;display:block;" />`;  
