import React, { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, Trash2, Download, Truck, SprayCan, Search, ArrowLeft, Eraser, Hash, Type, AlignLeft, ListChecks, ChevronDown, Camera, Upload, X } from 'lucide-react';
import api from '../api';
import { useData } from '../context/DataContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import PageHeader from '../components/PageHeader';
import { EmptyState, TableSkeleton } from '../components/UIUtils';
import { ThaiDateInput } from '../components/ThaiDateInput';
import AttachmentPanel from '../components/AttachmentPanel';
import { surveySections, type SurveyFormType, type SurveyField } from '../utils/siteSurveyFields';
import { downloadSiteSurveyPdf } from '../utils/siteSurveyPdf';

interface SiteSurveyRow {
  id: string;
  formType: SurveyFormType;
  siteName: string;
  surveyDate?: string | null;
  engineerName?: string | null;
  zone?: string | null;
  customerId?: string | null;
  siteId?: string | null;
  answers: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface DraftHeader { siteName: string; surveyDate: string; engineerName: string; zone: string; customerId: string; siteId: string }
interface Draft { id: string | null; header: DraftHeader; answers: Record<string, unknown> }
const blankHeader: DraftHeader = { siteName: '', surveyDate: '', engineerName: '', zone: '', customerId: '', siteId: '' };
const blankDraft = (): Draft => ({ id: null, header: { ...blankHeader }, answers: {} });

type Tab = 'amr' | 'cleaning' | 'list';

// Small icon per field kind, purely decorative — gives each field card a bit of visual weight
// instead of a bare label-over-input pair.
const FIELD_ICONS: Record<SurveyField['kind'], React.ReactNode> = {
  text: <Type size={14} />,
  number: <Hash size={14} />,
  textarea: <AlignLeft size={14} />,
  select: <ChevronDown size={14} />,
  checks: <ListChecks size={14} />,
};

const FormField: React.FC<{ field: SurveyField; value: unknown; onChange: (value: unknown) => void }> = ({ field, value, onChange }) => {
  const label = (
    <label className="form-label survey-field-label">
      <span className="survey-field-icon">{FIELD_ICONS[field.kind]}</span>
      {field.label}{'unit' in field && field.unit ? <span className="survey-field-unit">({field.unit})</span> : null}
    </label>
  );
  if (field.kind === 'textarea') {
    return <div className="survey-field"><div className="form-group">{label}<textarea className="form-control" rows={2} value={String(value ?? '')} onChange={e => onChange(e.target.value)} /></div></div>;
  }
  if (field.kind === 'select') {
    return (
      <div className="survey-field"><div className="form-group">{label}
        <select className="form-control" value={String(value ?? '')} onChange={e => onChange(e.target.value)}>
          <option value="">-- เลือก --</option>
          {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      </div></div>
    );
  }
  if (field.kind === 'checks') {
    const selected = new Set(Array.isArray(value) ? value as string[] : []);
    const toggle = (opt: string) => {
      const next = new Set(selected);
      if (next.has(opt)) next.delete(opt); else next.add(opt);
      onChange([...next]);
    };
    return (
      <div className="survey-field"><div className="form-group">{label}
        <div className="survey-check-group">
          {field.options.map(opt => (
            <label key={opt} className={`survey-check-chip ${selected.has(opt) ? 'checked' : ''}`}>
              <input type="checkbox" checked={selected.has(opt)} onChange={() => toggle(opt)} /> {opt}
            </label>
          ))}
        </div>
      </div></div>
    );
  }
  return (
    <div className="survey-field"><div className="form-group">{label}
      <input className="form-control" type={field.kind === 'number' ? 'number' : 'text'} value={String(value ?? '')} placeholder={'placeholder' in field ? field.placeholder : undefined} onChange={e => onChange(e.target.value)} />
    </div></div>
  );
};

// A section title like "1. ข้อมูลมิติพื้นที่ ... (Physical Layout & Clearance)" — split into
// the number badge and the rest so the number renders as a round chip instead of plain text.
const splitSectionTitle = (title: string): [string, string] => {
  const match = title.match(/^(\d+)\.\s*(.+)$/);
  return match ? [match[1], match[2]] : ['•', title];
};

// Lets the survey be photographed while it's still being filled in, before it has an id to
// attach files to — photos are held in memory and uploaded right after the first save.
const PendingPhotoPicker: React.FC<{ photos: File[]; onAdd: (files: FileList | null) => void; onRemove: (index: number) => void }> = ({ photos, onAdd, onRemove }) => {
  const previews = useMemo(() => photos.map(f => URL.createObjectURL(f)), [photos]);
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews]);

  return (
    <div style={{ border: '1px solid var(--border-color)', borderRadius: 8, overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.75rem 1rem', background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
        <Camera size={15} />
        <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>รูปภาพหน้างาน</span>
        <span className="badge info" style={{ marginLeft: 'auto', fontSize: '0.7rem' }}>{photos.length}</span>
      </div>
      <div style={{ padding: '0.75rem 1rem' }}>
        {photos.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))', gap: 8, marginBottom: '0.75rem' }}>
            {previews.map((src, i) => (
              <div key={i} style={{ position: 'relative', aspectRatio: '1', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                <button type="button" onClick={() => onRemove(i)} aria-label="ลบรูปนี้" style={{ position: 'absolute', top: 3, right: 3, background: 'rgba(0,0,0,0.6)', border: 'none', borderRadius: '50%', width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}>
                  <X size={13} color="#fff" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <label className="btn btn-primary" style={{ cursor: 'pointer', fontSize: '0.82rem', padding: '0.3rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Camera size={13} /> ถ่ายภาพ
            <input type="file" accept="image/*" capture="environment" multiple style={{ display: 'none' }} onChange={e => { onAdd(e.target.files); e.target.value = ''; }} />
          </label>
          <label className="btn btn-outline" style={{ cursor: 'pointer', fontSize: '0.82rem', padding: '0.3rem 0.75rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <Upload size={13} /> แนบไฟล์
            <input type="file" accept="image/*" multiple style={{ display: 'none' }} onChange={e => { onAdd(e.target.files); e.target.value = ''; }} />
          </label>
        </div>
        <p className="text-muted" style={{ fontSize: 12, margin: '0.5rem 0 0' }}>รูปเหล่านี้จะถูกอัปโหลดทันทีที่กด "บันทึกแบบสำรวจ"</p>
      </div>
    </div>
  );
};

// Links the survey to an existing customer (and one of its sites). Picking one fills the site
// name when it is still empty, so the survey shows up in that customer's history.
const CustomerSitePicker: React.FC<{ header: DraftHeader; onHeaderChange: (header: DraftHeader) => void }> = ({ header, onHeaderChange }) => {
  const { customers } = useData();
  // Keyed by customer so a stale list never shows after the customer changes.
  const [loadedSites, setLoadedSites] = useState<{ customerId: string; list: { id: string; name: string }[] }>({ customerId: '', list: [] });
  useEffect(() => {
    if (!header.customerId) return;
    let alive = true;
    const customerId = header.customerId;
    api.get(`/customers/${customerId}/sites`)
      .then(r => { if (alive) setLoadedSites({ customerId, list: r.data }); })
      .catch(() => { if (alive) setLoadedSites({ customerId, list: [] }); });
    return () => { alive = false; };
  }, [header.customerId]);
  const sites = header.customerId && loadedSites.customerId === header.customerId ? loadedSites.list : [];
  const sortedCustomers = useMemo(() => [...customers].sort((a, b) => a.name.localeCompare(b.name)), [customers]);
  return (
    <>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">ลูกค้าในระบบ (ถ้ามี)</label>
        <select className="form-control" value={header.customerId} onChange={e => {
          const customer = customers.find(c => c.id === e.target.value);
          onHeaderChange({ ...header, customerId: e.target.value, siteId: '', siteName: header.siteName || customer?.name || '' });
        }}>
          <option value="">— ลูกค้าใหม่ / ยังไม่อยู่ในระบบ —</option>
          {sortedCustomers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      {sites.length > 0 && (
        <div className="form-group" style={{ margin: 0 }}>
          <label className="form-label">สาขา/สถานที่ของลูกค้า</label>
          <select className="form-control" value={header.siteId} onChange={e => {
            const site = sites.find(x => x.id === e.target.value);
            onHeaderChange({ ...header, siteId: e.target.value, siteName: site?.name || header.siteName });
          }}>
            <option value="">— ไม่ระบุ —</option>
            {sites.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
          </select>
        </div>
      )}
    </>
  );
};

// Full form body shared by "create" tabs and the "view/edit" detail screen.
const SurveyFormBody: React.FC<{
  formType: SurveyFormType;
  header: DraftHeader;
  answers: Record<string, unknown>;
  onHeaderChange: (header: DraftHeader) => void;
  onAnswerChange: (key: string, value: unknown) => void;
}> = ({ formType, header, answers, onHeaderChange, onAnswerChange }) => (
  <div className="survey-form">
    <div className="card survey-header-card">
      <CustomerSitePicker header={header} onHeaderChange={onHeaderChange} />
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">ชื่อโรงงาน/คลังสินค้า *</label>
        <input className="form-control" value={header.siteName} onChange={e => onHeaderChange({ ...header, siteName: e.target.value })} />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">วันที่เข้าสำรวจ</label>
        <ThaiDateInput className="form-control" value={header.surveyDate} onChange={e => onHeaderChange({ ...header, surveyDate: e.target.value })} />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">วิศวกรผู้สำรวจ</label>
        <input className="form-control" value={header.engineerName} onChange={e => onHeaderChange({ ...header, engineerName: e.target.value })} />
      </div>
      <div className="form-group" style={{ margin: 0 }}>
        <label className="form-label">อาคาร/โซนพื้นที่</label>
        <input className="form-control" value={header.zone} onChange={e => onHeaderChange({ ...header, zone: e.target.value })} />
      </div>
    </div>

    {surveySections(formType).map(section => {
      const [num, rest] = splitSectionTitle(section.title);
      return (
        <div key={section.title} className="card survey-section">
          <h3 className="survey-section-title"><span className="survey-section-badge">{num}</span>{rest}</h3>
          <div className="survey-fields-grid">
            {section.fields.map(field => (
              <FormField key={field.key} field={field} value={answers[field.key]} onChange={v => onAnswerChange(field.key, v)} />
            ))}
          </div>
        </div>
      );
    })}
  </div>
);

const SiteSurvey: React.FC = () => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [tab, setTab] = useState<Tab>('amr');

  const [surveys, setSurveys] = useState<SiteSurveyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [listSearch, setListSearch] = useState('');
  const [listTypeFilter, setListTypeFilter] = useState<'All' | SurveyFormType>('All');
  const [detailRow, setDetailRow] = useState<SiteSurveyRow | null>(null);
  const [detailHeader, setDetailHeader] = useState<DraftHeader>(blankHeader);
  const [detailAnswers, setDetailAnswers] = useState<Record<string, unknown>>({});

  const [drafts, setDrafts] = useState<Record<'amr' | 'cleaning', Draft>>({ amr: blankDraft(), cleaning: blankDraft() });
  const [pendingPhotos, setPendingPhotos] = useState<Record<'amr' | 'cleaning', File[]>>({ amr: [], cleaning: [] });
  const [saving, setSaving] = useState(false);
  const [exportingId, setExportingId] = useState<string | null>(null);

  const addPendingPhotos = (formType: 'amr' | 'cleaning', files: FileList | null) => {
    if (!files || files.length === 0) return;
    setPendingPhotos(prev => ({ ...prev, [formType]: [...prev[formType], ...Array.from(files)] }));
  };
  const removePendingPhoto = (formType: 'amr' | 'cleaning', index: number) =>
    setPendingPhotos(prev => ({ ...prev, [formType]: prev[formType].filter((_, i) => i !== index) }));

  const uploadPhoto = (elementId: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('elementType', 'SiteSurvey');
    fd.append('elementId', elementId);
    fd.append('attachmentType', 'photo');
    return api.post('/attachments', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  };

  const fetchSurveys = () => {
    setLoading(true);
    api.get<SiteSurveyRow[]>('/site-surveys')
      .then(res => setSurveys(res.data))
      .catch(() => setSurveys([]))
      .finally(() => setLoading(false));
  };
  useEffect(fetchSurveys, []);

  const filtered = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return surveys.filter(s => {
      if (listTypeFilter !== 'All' && s.formType !== listTypeFilter) return false;
      if (!q) return true;
      return s.siteName.toLowerCase().includes(q) || (s.engineerName || '').toLowerCase().includes(q) || (s.zone || '').toLowerCase().includes(q);
    });
  }, [surveys, listSearch, listTypeFilter]);

  // ── Create tabs (AMR / cleaning) ──────────────────────────────────────────
  const currentDraft = tab === 'amr' || tab === 'cleaning' ? drafts[tab] : null;
  const setDraft = (formType: 'amr' | 'cleaning', updater: (d: Draft) => Draft) =>
    setDrafts(prev => ({ ...prev, [formType]: updater(prev[formType]) }));

  const handleSaveDraft = async (formType: 'amr' | 'cleaning') => {
    const draft = drafts[formType];
    if (!draft.header.siteName.trim()) { showToast('กรุณากรอกชื่อโรงงาน/คลังสินค้า', 'error'); return; }
    setSaving(true);
    try {
      const payload = { formType, ...draft.header, answers: draft.answers };
      const res = draft.id ? await api.put(`/site-surveys/${draft.id}`, payload) : await api.post('/site-surveys', payload);
      const newId = res.data.id as string;
      setDraft(formType, () => ({ id: newId, header: draft.header, answers: draft.answers }));

      const photosToUpload = pendingPhotos[formType];
      if (photosToUpload.length > 0) {
        const results = await Promise.allSettled(photosToUpload.map(file => uploadPhoto(newId, file)));
        // Keep only the photos that failed, so saving again retries just those.
        const failedFiles = photosToUpload.filter((_, i) => results[i].status === 'rejected');
        const failed = failedFiles.length;
        setPendingPhotos(prev => ({ ...prev, [formType]: failedFiles }));
        if (failed > 0) showToast(`บันทึกแบบสำรวจแล้ว แต่อัปโหลดรูปไม่สำเร็จ ${failed} รูป`, 'error');
        else showToast('บันทึกแบบสำรวจและรูปภาพแล้ว', 'success');
      } else {
        showToast(draft.id ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกแบบสำรวจแล้ว ถ่ายรูปเพิ่มหรือดูรายการทั้งหมดได้ที่แถบ "รายการที่บันทึกไว้"', 'success');
      }
      fetchSurveys();
    } catch (err) {
      const response = (err as { response?: { data?: { error?: string } } }).response;
      showToast(response?.data?.error || 'บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetDraft = async (formType: 'amr' | 'cleaning') => {
    const draft = drafts[formType];
    const hasContent = Object.values(draft.header).some(v => String(v ?? '').trim())
      || Object.keys(draft.answers).length > 0 || pendingPhotos[formType].length > 0;
    if (hasContent && !await confirm(
      draft.id ? 'เริ่มฉบับใหม่? ฉบับนี้บันทึกไว้แล้ว แต่การแก้ไขและรูปที่ยังไม่ได้บันทึกจะหายไป' : 'เริ่มฉบับใหม่? คำตอบและรูปที่ยังไม่ได้บันทึกจะหายทั้งหมด',
      { title: 'ล้างแบบสำรวจ', danger: true, confirmLabel: 'เริ่มฉบับใหม่' },
    )) return;
    setDraft(formType, () => blankDraft());
    setPendingPhotos(prev => ({ ...prev, [formType]: [] }));
  };

  const handleExport = async (row: { id: string; formType: SurveyFormType; siteName: string; surveyDate?: string | null; engineerName?: string | null; zone?: string | null; answers: Record<string, unknown> }) => {
    setExportingId(row.id);
    try {
      let photoUrls: string[] = [];
      try {
        const res = await api.get<{ url: string; mimeType?: string; originalName: string }[]>(`/attachments/SiteSurvey/${row.id}`);
        photoUrls = res.data.filter(a => a.mimeType?.startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(a.originalName)).map(a => a.url);
      } catch { /* ไม่มีรูปแนบก็ export ต่อได้ */ }
      await downloadSiteSurveyPdf(row, photoUrls);
    } catch {
      showToast('สร้างไฟล์ PDF ไม่สำเร็จ', 'error');
    } finally {
      setExportingId(null);
    }
  };

  // ── List / detail tab ──────────────────────────────────────────────────────
  const openDetail = (row: SiteSurveyRow) => {
    setDetailRow(row);
    setDetailHeader({ siteName: row.siteName, surveyDate: row.surveyDate || '', engineerName: row.engineerName || '', zone: row.zone || '', customerId: row.customerId || '', siteId: row.siteId || '' });
    setDetailAnswers(row.answers || {});
  };
  const closeDetail = () => setDetailRow(null);

  const handleSaveDetail = async () => {
    if (!detailRow) return;
    if (!detailHeader.siteName.trim()) { showToast('กรุณากรอกชื่อโรงงาน/คลังสินค้า', 'error'); return; }
    setSaving(true);
    try {
      const res = await api.put(`/site-surveys/${detailRow.id}`, { ...detailHeader, answers: detailAnswers });
      setDetailRow(res.data);
      showToast('บันทึกการแก้ไขแล้ว', 'success');
      fetchSurveys();
    } catch {
      showToast('บันทึกไม่สำเร็จ', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (row: SiteSurveyRow) => {
    if (!await confirm(`ลบแบบสำรวจ "${row.siteName}"?`, { title: 'ยืนยันการลบ', danger: true })) return;
    try {
      await api.delete(`/site-surveys/${row.id}`);
      showToast('ลบแล้ว', 'success');
      if (detailRow?.id === row.id) closeDetail();
      fetchSurveys();
    } catch { showToast('ลบไม่สำเร็จ', 'error'); }
  };

  return (
    <div className="page-container">
      <PageHeader
        title={<><ClipboardList size={26} style={{ verticalAlign: 'middle', marginRight: 8 }} />Site Survey</>}
        subtitle="แบบสำรวจหน้างานก่อนติดตั้งหุ่นยนต์ — กรอกข้อมูล ถ่ายรูปหน้างาน แล้วนำออกเป็น PDF"
      />

      <div className="survey-tabs">
        {([
          ['amr', <Truck size={16} key="i" />, 'สำรวจ AMR ขนส่ง'],
          ['cleaning', <SprayCan size={16} key="i" />, 'สำรวจหุ่นยนต์ทำความสะอาด'],
          ['list', <Search size={16} key="i" />, `รายการที่บันทึกไว้ (${surveys.length})`],
        ] as const).map(([key, icon, title]) => (
          <button key={key} onClick={() => setTab(key)} className={`survey-tab ${tab === key ? 'active' : ''}`}>
            {icon} {title}
          </button>
        ))}
      </div>

      {(tab === 'amr' || tab === 'cleaning') && currentDraft && (
        <>
          <SurveyFormBody
            formType={tab}
            header={currentDraft.header}
            answers={currentDraft.answers}
            onHeaderChange={h => setDraft(tab, d => ({ ...d, header: h }))}
            onAnswerChange={(key, value) => setDraft(tab, d => ({ ...d, answers: { ...d.answers, [key]: value } }))}
          />

          <div style={{ marginTop: '1rem' }}>
            {currentDraft.id ? (
              <AttachmentPanel elementType="SiteSurvey" elementId={currentDraft.id} />
            ) : (
              <PendingPhotoPicker
                photos={pendingPhotos[tab]}
                onAdd={files => addPendingPhotos(tab, files)}
                onRemove={index => removePendingPhoto(tab, index)}
              />
            )}
          </div>

          <div className="survey-actions">
            <button className="btn btn-ghost" onClick={() => void resetDraft(tab)}><Eraser size={15} /> เริ่มฉบับใหม่</button>
            {currentDraft.id && (
              <button className="btn btn-outline" onClick={() => handleExport({ id: currentDraft.id!, formType: tab, ...currentDraft.header, answers: currentDraft.answers })} disabled={exportingId === currentDraft.id}>
                <Download size={15} /> {exportingId === currentDraft.id ? 'กำลังสร้าง...' : 'ดาวน์โหลด PDF'}
              </button>
            )}
            <button className="btn btn-primary" onClick={() => handleSaveDraft(tab)} disabled={saving}>
              <Plus size={15} /> {saving ? 'กำลังบันทึก...' : currentDraft.id ? 'บันทึกการแก้ไข' : 'บันทึกแบบสำรวจ'}
            </button>
          </div>
        </>
      )}

      {tab === 'list' && !detailRow && (
        <>
          <div className="survey-list-toolbar">
            <div style={{ position: 'relative', flex: '1 1 240px' }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="form-control" style={{ paddingLeft: 32 }} value={listSearch} onChange={e => setListSearch(e.target.value)} placeholder="ค้นหาชื่อโรงงาน วิศวกร หรือโซน" />
            </div>
            {(['All', 'amr', 'cleaning'] as const).map(t => (
              <button key={t} className={`btn ${listTypeFilter === t ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setListTypeFilter(t)}>
                {t === 'All' ? 'ทั้งหมด' : t === 'amr' ? 'AMR ขนส่ง' : 'ทำความสะอาด'}
              </button>
            ))}
          </div>

          <div className="card">
            {loading ? <TableSkeleton cols={6} rows={4} /> : filtered.length === 0 ? (
              <EmptyState icon={<ClipboardList size={40} />} title="ยังไม่มีแบบสำรวจ" description="ไปที่แถบสำรวจ AMR หรือทำความสะอาดเพื่อเริ่มกรอกแบบสำรวจ" />
            ) : (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th>ประเภท</th>
                      <th>ชื่อโรงงาน/สถานที่</th>
                      <th>วันที่สำรวจ</th>
                      <th>วิศวกร</th>
                      <th>โซน</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(row => (
                      <tr key={row.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(row)}>
                        <td><span className={`badge ${row.formType === 'amr' ? 'info' : 'success'}`}>{row.formType === 'amr' ? 'AMR ขนส่ง' : 'ทำความสะอาด'}</span></td>
                        <td style={{ fontWeight: 600 }}>{row.siteName}</td>
                        <td>{row.surveyDate ? new Date(row.surveyDate).toLocaleDateString('th-TH') : '-'}</td>
                        <td>{row.engineerName || '-'}</td>
                        <td>{row.zone || '-'}</td>
                        <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleExport(row)} disabled={exportingId === row.id} title="ดาวน์โหลด PDF">
                            <Download size={15} /> {exportingId === row.id ? 'กำลังสร้าง...' : 'PDF'}
                          </button>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(row)} title="ลบ"><Trash2 size={15} /></button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === 'list' && detailRow && (
        <>
          <button className="btn btn-ghost" style={{ marginBottom: '1rem' }} onClick={closeDetail}><ArrowLeft size={15} /> กลับไปที่รายการ</button>

          <SurveyFormBody
            formType={detailRow.formType}
            header={detailHeader}
            answers={detailAnswers}
            onHeaderChange={setDetailHeader}
            onAnswerChange={(key, value) => setDetailAnswers(a => ({ ...a, [key]: value }))}
          />

          <div className="card" style={{ marginTop: '1rem' }}>
            <h3 style={{ fontSize: 14, marginTop: 0, marginBottom: '0.75rem' }}>รูปภาพหน้างาน</h3>
            <AttachmentPanel elementType="SiteSurvey" elementId={detailRow.id} />
          </div>

          <div className="survey-actions">
            <button className="btn btn-ghost" onClick={() => handleDelete(detailRow)}><Trash2 size={15} /> ลบแบบสำรวจนี้</button>
            <button className="btn btn-outline" onClick={() => handleExport({ ...detailRow, ...detailHeader, answers: detailAnswers })} disabled={exportingId === detailRow.id}>
              <Download size={15} /> {exportingId === detailRow.id ? 'กำลังสร้าง...' : 'ดาวน์โหลด PDF'}
            </button>
            <button className="btn btn-primary" onClick={handleSaveDetail} disabled={saving}>
              {saving ? 'กำลังบันทึก...' : 'บันทึกการแก้ไข'}
            </button>
          </div>
        </>
      )}
    </div>
  );
};

export default SiteSurvey;
