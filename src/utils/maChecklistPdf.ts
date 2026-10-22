import { MA_CATEGORY_LABELS, maChecklistAllItems, maItemScopeNote, type MaCategory, type MaItem } from './maChecklistFields';

const BORDER = '1px solid #9ca3af';

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const buildPage = (logo: string, category: MaCategory) => {
  const sections = maChecklistAllItems(category);
  const itemCount = sections.reduce((n, s) => n + s.items.length + 1, 0);
  // Longer checklists (cleaning) get shorter rows so the sheet still fits one A4 page.
  const rowH = itemCount > 20 ? 21 : 27;
  const cell = (content: string, extra = '') => `<td style="border:${BORDER};padding:2px 8px;height:${rowH}px;${extra}">${content}</td>`;
  const groupRow = (no: number, title: string) =>
    `<tr>${cell(String(no), 'text-align:center')}${cell(`<strong>${title}</strong>`)}${cell('')}${cell('')}</tr>`;
  const itemRow = (item: MaItem) =>
    `<tr>${cell('')}${cell(`- ${item.label}${maItemScopeNote(item) ? ` <span style="color:#6b7280">(${maItemScopeNote(item)})</span>` : ''}`)}${cell('')}${cell('')}</tr>`;
  return `
<div style="width:794px;min-height:1123px;padding:36px 42px;background:#fff;color:#111;font-family:'Prompt',sans-serif;box-sizing:border-box;font-size:${rowH < 27 ? 12 : 13}px">
  <div style="text-align:center">
    ${logo ? `<img src="${logo}" style="height:64px" />` : '<strong style="font-size:22px">OZONE360</strong>'}
    <div style="font-weight:600;margin-top:8px">31 Santitham Rd., Chang Phueak, Mueang, Chiang Mai 50300</div>
    <div style="font-weight:600;margin-top:6px">Tel. 080-000-0001, 080-000-0000, 052-000-634</div>
  </div>
  <div style="display:flex;justify-content:space-between;align-items:flex-end;margin:26px 0 14px">
    <div style="font-size:16px;color:#1e3a5f">เช็คลิสต์บริการดูแลและบำรุงรักษา ................. เดือน<div style="font-size:13px;color:#374151;margin-top:4px">${MA_CATEGORY_LABELS[category]}</div></div>
    <div style="text-align:right;font-size:12px;line-height:1.9">วันที่: ........./ ............/ .............<br/>ชื่อสถานที่: ..........................................</div>
  </div>
  <table style="width:100%;border-collapse:collapse;margin-bottom:14px">
    <tr>
      <th style="border:${BORDER};background:#e5e7eb;padding:4px;width:33.3%">ชื่อรุ่น</th>
      <th style="border:${BORDER};background:#e5e7eb;padding:4px;width:33.3%">หมายเลข PIN/SN</th>
      <th style="border:${BORDER};background:#e5e7eb;padding:4px">หมายเลข MAC</th>
    </tr>
    <tr>${cell('', 'height:24px')}${cell('', 'height:24px')}${cell('', 'height:24px')}</tr>
  </table>
  <table style="width:100%;border-collapse:collapse">
    <tr>
      <th style="border:${BORDER};background:#e5e7eb;padding:4px;width:9%">NO.</th>
      <th style="border:${BORDER};background:#e5e7eb;padding:4px">คำอธิบาย</th>
      <th style="border:${BORDER};background:#e5e7eb;padding:4px;width:18%">เครื่องหมาย</th>
      <th style="border:${BORDER};background:#e5e7eb;padding:4px;width:24%">หมายเหตุ</th>
    </tr>
    ${sections.map((s, i) => groupRow(i + 1, s.title) + s.items.map(itemRow).join('')).join('')}
    <tr>
      <td colspan="2" rowspan="2" style="border:${BORDER};text-align:center;font-weight:700">การทำงานโดยรวม</td>
      ${cell('(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;) ผ่าน')}
      <td rowspan="2" style="border:${BORDER}"></td>
    </tr>
    <tr>${cell('(&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;) ไม่ผ่าน')}</tr>
  </table>
  <div style="margin-top:20px">ปัญหาที่พบเพิ่มเติม</div>
  ${Array.from({ length: rowH < 27 ? 3 : 5 }, () => '<div style="border-bottom:1px dotted #6b7280;height:26px"></div>').join('')}
  <div style="display:flex;justify-content:space-around;margin-top:${rowH < 27 ? 32 : 48}px;text-align:center;font-weight:600">
    <div>ลงชื่อช่างเทคนิค<div style="margin-top:34px">(...........................................................)</div></div>
    <div>ลงชื่อลูกค้า<div style="margin-top:34px">(...........................................................)</div></div>
  </div>
</div>`;
};

/** Downloads the blank MA (maintenance) checklist for one robot category as an A4 PDF file. */
export async function downloadMaChecklistPdf(category: MaCategory): Promise<void> {
  const stage = document.createElement('div');
  try {
    let logo = '';
    try { logo = await blobToDataUrl(await (await fetch('/ozone360-logo-header.png')).blob()); } catch { /* falls back to text */ }
    stage.style.cssText = 'position:fixed;left:-10000px;top:0;';
    stage.innerHTML = buildPage(logo, category);
    document.body.appendChild(stage);
    await document.fonts.ready;
    await Promise.all(Array.from(stage.querySelectorAll('img')).map(img => img.decode().catch(() => undefined)));
    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
    const canvas = await html2canvas(stage.firstElementChild as HTMLElement, { scale: 2, backgroundColor: '#ffffff' });
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    // If the sheet runs taller than A4, shrink it to fit one page rather than cutting a row.
    const heightMm = 210 * canvas.height / canvas.width;
    const scale = Math.min(1, 297 / heightMm);
    doc.addImage(canvas.toDataURL('image/jpeg', 0.95), 'JPEG', (210 - 210 * scale) / 2, 0, 210 * scale, heightMm * scale);
    doc.save(`เช็คลิสต์บริการดูแลและบำรุงรักษา-MA-${category}.pdf`);
  } finally {
    stage.remove();
  }
}
