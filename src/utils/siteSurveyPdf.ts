import { surveySections, SURVEY_TITLES, type SurveyFormType } from './siteSurveyFields';
import { todayISO } from './thaiDate';
import { fetchAttachmentBlob } from './attachmentBlob';

const blobToDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export interface SiteSurveyRecord {
  formType: SurveyFormType;
  siteName: string;
  surveyDate?: string | null;
  engineerName?: string | null;
  zone?: string | null;
  answers: Record<string, unknown>;
}

const formatAnswer = (value: unknown): string => {
  if (Array.isArray(value)) return value.length ? value.map(v => escapeHtml(String(v))).join(', ') : '<span style="color:#9ca3af">-</span>';
  if (value === undefined || value === null || value === '') return '<span style="color:#9ca3af">-</span>';
  return escapeHtml(String(value));
};

/** Builds and downloads the filled site-survey questionnaire (with attached photos) as an A4 PDF. */
export async function downloadSiteSurveyPdf(survey: SiteSurveyRecord, photoUrls: string[]): Promise<void> {
  const stage = document.createElement('div');
  try {
    const [logo, ...photos] = await Promise.all([
      (async () => { try { return await blobToDataUrl(await (await fetch('/ozone360-logo-header.png')).blob()); } catch { return ''; } })(),
      ...photoUrls.map(async url => { try { return await blobToDataUrl(await fetchAttachmentBlob(url)); } catch { return ''; } }),
    ]);
    const validPhotos = photos.filter(Boolean);
    const sections = surveySections(survey.formType);
    const dateLabel = survey.surveyDate ? new Date(survey.surveyDate).toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' }) : '-';

    const headerHtml = `
      <div style="text-align:center;margin-bottom:6px">
        ${logo ? `<img src="${logo}" style="height:56px" />` : '<strong style="font-size:20px">OZONE360</strong>'}
      </div>
      <div style="font-size:17px;font-weight:700;text-align:center;color:#1e3a5f;margin-bottom:14px">${escapeHtml(SURVEY_TITLES[survey.formType])}</div>
      <table style="width:100%;border-collapse:collapse;margin-bottom:16px;font-size:12px">
        <tr>
          <td style="border:1px solid #9ca3af;padding:5px 8px;width:25%;background:#f3f4f6"><strong>ชื่อโรงงาน/คลังสินค้า</strong></td>
          <td style="border:1px solid #9ca3af;padding:5px 8px;width:25%">${escapeHtml(survey.siteName || '-')}</td>
          <td style="border:1px solid #9ca3af;padding:5px 8px;width:25%;background:#f3f4f6"><strong>วันที่เข้าสำรวจ</strong></td>
          <td style="border:1px solid #9ca3af;padding:5px 8px;width:25%">${dateLabel}</td>
        </tr>
        <tr>
          <td style="border:1px solid #9ca3af;padding:5px 8px;background:#f3f4f6"><strong>วิศวกรผู้สำรวจ</strong></td>
          <td style="border:1px solid #9ca3af;padding:5px 8px">${escapeHtml(survey.engineerName || '-')}</td>
          <td style="border:1px solid #9ca3af;padding:5px 8px;background:#f3f4f6"><strong>โซนพื้นที่</strong></td>
          <td style="border:1px solid #9ca3af;padding:5px 8px">${escapeHtml(survey.zone || '-')}</td>
        </tr>
      </table>`;

    const sectionsHtml = sections.map(section => `
      <div style="margin-bottom:10px;break-inside:avoid">
        <div style="background:#1e3a5f;color:#fff;padding:5px 10px;font-weight:600;font-size:12.5px;border-radius:4px 4px 0 0">${escapeHtml(section.title)}</div>
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          ${section.fields.map(f => `
            <tr>
              <td style="border:1px solid #d1d5db;padding:5px 8px;width:42%;background:#f9fafb">${escapeHtml(f.label)}${'unit' in f && f.unit ? ` (${escapeHtml(f.unit)})` : ''}</td>
              <td style="border:1px solid #d1d5db;padding:5px 8px">${formatAnswer(survey.answers[f.key])}</td>
            </tr>`).join('')}
        </table>
      </div>`).join('');

    const photosHtml = validPhotos.length ? `
      <div style="margin-top:14px;break-inside:avoid">
        <div style="background:#1e3a5f;color:#fff;padding:5px 10px;font-weight:600;font-size:12.5px;border-radius:4px 4px 0 0">รูปภาพหน้างาน</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:8px;border:1px solid #d1d5db;border-top:none">
          ${validPhotos.map(src => `<div style="height:150px;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;display:flex;align-items:center;justify-content:center"><img src="${src}" style="max-width:100%;max-height:100%;object-fit:contain" /></div>`).join('')}
        </div>
      </div>` : '';

    stage.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;';
    stage.innerHTML = `<div style="width:794px;padding:32px 36px;background:#fff;color:#111;font-family:'Prompt',sans-serif;box-sizing:border-box">
      ${headerHtml}${sectionsHtml}${photosHtml}
    </div>`;
    document.body.appendChild(stage);
    await document.fonts.ready;
    await Promise.all(Array.from(stage.querySelectorAll('img')).map(img => img.decode().catch(() => undefined)));

    const [{ jsPDF }, { default: html2canvas }] = await Promise.all([import('jspdf'), import('html2canvas')]);
    const content = stage.firstElementChild as HTMLElement;
    const canvas = await html2canvas(content, { scale: 2, backgroundColor: '#ffffff', windowWidth: 794 });
    const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
    const pageHeightPx = (297 / 210) * canvas.width;
    const pageCount = Math.ceil(canvas.height / pageHeightPx);
    for (let i = 0; i < pageCount; i++) {
      const sliceCanvas = document.createElement('canvas');
      sliceCanvas.width = canvas.width;
      sliceCanvas.height = Math.min(pageHeightPx, canvas.height - i * pageHeightPx);
      const ctx = sliceCanvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height);
      ctx.drawImage(canvas, 0, -i * pageHeightPx);
      if (i > 0) doc.addPage();
      const sliceHeightMm = (sliceCanvas.height / canvas.width) * 210;
      doc.addImage(sliceCanvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, 210, sliceHeightMm);
    }
    const safeName = survey.siteName.replace(/[\\/:*?"<>|]/g, '-').trim() || 'site-survey';
    doc.save(`site-survey-${safeName}-${todayISO()}.pdf`);
  } finally {
    stage.remove();
  }
}
