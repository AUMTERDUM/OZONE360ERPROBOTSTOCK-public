import React, { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api';
import { Upload, FileSpreadsheet, CheckCircle, AlertCircle, Info, Loader, X, Eye, RefreshCw, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import { formatThaiDateTime } from '../utils/thaiDate';

type FileType = 'agent' | 'store' | 'robot' | 'unbound' | 'unknown';
type EntryStatus = 'pending' | 'previewing' | 'previewed' | 'importing' | 'done' | 'error';
type Step = 'select' | 'previewing' | 'confirm' | 'importing' | 'done';

interface FileEntry {
  id: number;
  file: File;
  type: FileType;
  preview: any | null;
  result: any | null;
  error: string | null;
  status: EntryStatus;
}

interface PuduSyncResult {
  modelsCreated: number;
  modelsUpdated: number;
  customersCreated: number;
  customersUpdated: number;
  robotsCreated: number;
  robotsUpdated: number;
  errors: string[];
}

const FILE_TYPE_LABEL: Record<FileType, string> = {
  agent: 'Agent List',
  store: 'Store List',
  robot: 'Installed Machine',
  unbound: 'Unbound Machine',
  unknown: 'ไม่ทราบประเภท',
};

const FILE_TYPE_COLOR: Record<FileType, string> = {
  agent: 'var(--status-info)',
  store: 'var(--color-primary)',
  robot: 'var(--status-success)',
  unbound: 'var(--status-warning)',
  unknown: 'var(--text-muted)',
};

const FILE_TYPE_ORDER: Record<FileType, number> = { agent: 0, store: 1, robot: 2, unbound: 3, unknown: 4 };

const ROUTES: Record<'agent' | 'store' | 'robot' | 'unbound', { preview: string; confirm: string }> = {
  agent: { preview: '/agents/import/preview', confirm: '/agents/import/confirm' },
  store: { preview: '/pudu/preview', confirm: '/pudu/import' },
  robot: { preview: '/pudu/preview', confirm: '/pudu/import' },
  unbound: { preview: '/robots/import-status/preview', confirm: '/robots/import-status/confirm' },
};

const ACTION_COLOR: Record<string, string> = {
  create: 'var(--status-success)',
  update: 'var(--color-primary)',
  skip: 'var(--text-muted)',
  error: 'var(--status-danger)',
  merge: 'var(--status-info)',
};

const ACTION_LABEL: Record<string, string> = {
  create: '+ เพิ่มใหม่',
  update: '~ อัปเดต',
  skip: '– ข้าม',
  error: '! ผิดพลาด',
  merge: '⇄ รวม',
};

const GUIDE_CARDS = [
  { key: 'agent', title: 'Agent List', desc: 'ตัวแทนจำหน่าย', accent: 'var(--status-info)' },
  { key: 'store', title: 'Store List', desc: 'ร้านค้า / ลูกค้า', accent: 'var(--color-primary)' },
  { key: 'robot', title: 'Installed Machine List', desc: 'หุ่นยนต์ที่ติดตั้งแล้ว', accent: 'var(--status-success)' },
  { key: 'unbound', title: 'Unbound Machine List', desc: 'หุ่นยนต์ในคลัง', accent: 'var(--status-warning)' },
] as const;

function detectFileType(name: string): FileType {
  const n = name.toLowerCase();
  if (n.includes('agent')) return 'agent';
  if (n.includes('store') || n.includes('shop')) return 'store';
  if (n.includes('unbound')) return 'unbound';
  if (n.includes('installed') || n.includes('machine')) return 'robot';
  return 'unknown';
}

let nextId = 1;

const PuduImport: React.FC = () => {
  const { showToast } = useToast();
  const [step, setStep] = useState<Step>('select');
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [syncLoading, setSyncLoading] = useState(false);
  const [syncResult, setSyncResult] = useState<PuduSyncResult | null>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((fileList: FileList | File[]) => {
    const newEntries: FileEntry[] = [];
    for (const f of Array.from(fileList)) {
      if (!f.name.match(/\.(xlsx|xls)$/i)) continue;
      newEntries.push({ id: nextId++, file: f, type: detectFileType(f.name), preview: null, result: null, error: null, status: 'pending' });
    }
    if (newEntries.length === 0) { setError('กรุณาเลือกไฟล์ .xlsx หรือ .xls เท่านั้น'); return; }
    setEntries(prev => {
      const all = [...prev, ...newEntries];
      all.sort((a, b) => FILE_TYPE_ORDER[a.type] - FILE_TYPE_ORDER[b.type]);
      return all;
    });
    setError(null);
  }, []);

  const removeEntry = useCallback((id: number) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  const reset = () => {
    setStep('select'); setEntries([]); setError(null); setProgress('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const loadSyncStatus = useCallback(async () => {
    try {
      const res = await api.get('/pudu/sync-status');
      setLastSyncTime(res.data?.lastSyncTime ?? null);
    } catch {
      // Ignore status fetch failures; manual sync remains available.
    }
  }, []);

  const updateEntry = (id: number, patch: Partial<FileEntry>) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, ...patch } : e));
  };

  const doPreviewAll = async () => {
    const valid = entries.filter(e => e.type !== 'unknown');
    if (valid.length === 0) { setError('ไม่พบไฟล์ที่รู้จักประเภท กรุณาตรวจสอบชื่อไฟล์'); return; }
    setStep('previewing'); setError(null);
    let allOk = true;
    for (const entry of valid) {
      setProgress(`กำลังวิเคราะห์ ${entry.file.name}...`);
      updateEntry(entry.id, { status: 'previewing', error: null });
      try {
        const form = new FormData();
        form.append('file', entry.file);
        const route = ROUTES[entry.type as 'agent' | 'store' | 'robot' | 'unbound'];
        const res = await api.post(route.preview, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        updateEntry(entry.id, { status: 'previewed', preview: res.data });
      } catch (e: any) {
        const msg = e.response?.data?.error || e.message || 'ตรวจสอบไฟล์ไม่สำเร็จ';
        updateEntry(entry.id, { status: 'error', error: msg });
        allOk = false;
      }
    }
    setProgress('');
    if (allOk) { setStep('confirm'); } else { setStep('confirm'); setError('บางไฟล์วิเคราะห์ไม่สำเร็จ ดูรายละเอียดด้านล่าง'); }
  };

  const doImportAll = async () => {
    const importable = entries.filter(e => e.status === 'previewed' && e.preview);
    if (importable.length === 0) return;
    setStep('importing'); setError(null);
    for (const entry of importable) {
      setProgress(`กำลังนำเข้า ${FILE_TYPE_LABEL[entry.type]} (${entry.file.name})...`);
      updateEntry(entry.id, { status: 'importing' });
      try {
        const form = new FormData();
        form.append('file', entry.file);
        const route = ROUTES[entry.type as 'agent' | 'store' | 'robot' | 'unbound'];
        const res = await api.post(route.confirm, form, { headers: { 'Content-Type': 'multipart/form-data' } });
        updateEntry(entry.id, { status: 'done', result: res.data });
      } catch (e: any) {
        const msg = e.response?.data?.error || e.message || 'นำเข้าไฟล์ไม่สำเร็จ';
        updateEntry(entry.id, { status: 'error', error: msg });
      }
    }
    setProgress(''); setStep('done');
  };

  const handleSyncPudu = useCallback(async () => {
    setSyncLoading(true);
    setError(null);
    try {
      const res = await api.post('/pudu/sync');
      const result = res.data?.result as PuduSyncResult;
      setSyncResult(result);
      const now = new Date().toISOString();
      setLastSyncTime(now);
      const totalChanged =
        (result?.modelsCreated ?? 0) +
        (result?.modelsUpdated ?? 0) +
        (result?.customersCreated ?? 0) +
        (result?.customersUpdated ?? 0) +
        (result?.robotsCreated ?? 0) +
        (result?.robotsUpdated ?? 0);
      showToast(
        result?.errors?.length
          ? `ซิงก์ข้อมูล Pudu เสร็จแล้ว พร้อมคำเตือน ${result.errors.length} รายการ`
          : `ซิงก์ข้อมูล Pudu สำเร็จ${totalChanged > 0 ? ` (${totalChanged} รายการเปลี่ยนแปลง)` : ''}`,
        result?.errors?.length ? 'warning' : 'success',
      );
      void loadSyncStatus();
    } catch (e: any) {
      const msg = e.response?.data?.error || e.message || 'ซิงก์ไม่สำเร็จ';
      setError(`ซิงก์ข้อมูล Pudu ไม่สำเร็จ: ${msg}`);
      showToast(`ซิงก์ข้อมูล Pudu ไม่สำเร็จ: ${msg}`, 'error');
    } finally {
      setSyncLoading(false);
    }
  }, [loadSyncStatus, showToast]);

  useEffect(() => {
    void loadSyncStatus();
  }, [loadSyncStatus]);

  const stepIndex = (s: Step) => ['select', 'confirm', 'done'].indexOf(s === 'previewing' ? 'select' : s === 'importing' ? 'confirm' : s);
  const hasUnknown = entries.some(e => e.type === 'unknown');
  const totalPreviewChanges = entries.reduce((sum, e) => {
    if (!e.preview) return sum;
    const s = e.preview.summary ?? {};
    return sum + (s.created ?? 0) + (s.updated ?? 0);
  }, 0);
  const totalDone = entries.filter(e => e.status === 'done').length;
  const totalErrors = entries.filter(e => e.status === 'error').length;
  const syncCards = syncResult ? [
    { label: 'ลูกค้าเพิ่ม', value: syncResult.customersCreated, color: 'var(--status-success)' },
    { label: 'ลูกค้าอัปเดต', value: syncResult.customersUpdated, color: 'var(--color-primary)' },
    { label: 'หุ่นยนต์เพิ่ม', value: syncResult.robotsCreated, color: 'var(--status-success)' },
    { label: 'หุ่นยนต์อัปเดต', value: syncResult.robotsUpdated, color: 'var(--color-primary)' },
    { label: 'รุ่นเพิ่ม', value: syncResult.modelsCreated, color: 'var(--status-success)' },
    { label: 'รุ่นอัปเดต', value: syncResult.modelsUpdated, color: 'var(--color-primary)' },
  ] : [];

  const renderPreviewRows = (entry: FileEntry) => {
    const p = entry.preview;
    if (!p) return null;
    const rows: any[] = p.rows ?? p.agents ?? [];
    const isRobot = p.fileType === 'robot' || entry.type === 'robot';
    const isStore = p.fileType === 'store' || entry.type === 'store';
    const isUnbound = entry.type === 'unbound';
    const isAgent = entry.type === 'agent';

    return (
      <div style={{ overflowX: 'auto', border: '1px solid var(--border-color)', borderRadius: 'var(--radius-md)', marginTop: '0.5rem' }}>
        <table style={{ fontSize: '0.76rem' }}>
          <thead>
            <tr style={{ backgroundColor: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}>
              <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', fontWeight: 600, color: 'var(--text-muted)' }}>การดำเนินการ</th>
              {isRobot && <><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>SN</th><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>รุ่น</th><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>เจ้าของ/ตัวแทน</th><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>ร้าน</th></>}
              {isStore && <><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>ชื่อร้าน</th><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>เบอร์โทร</th></>}
              {isUnbound && <><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>SN</th><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>รุ่น</th><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>ตัวแทน</th></>}
              {isAgent && <><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>ชื่อตัวแทน</th><th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>รหัส</th></>}
              <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left' }}>รายละเอียด</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 30).map((r: any, i: number) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border-color)', backgroundColor: i % 2 ? 'var(--bg-secondary)' : 'transparent' }}>
                <td style={{ padding: '0.35rem 0.6rem', fontWeight: 700, color: ACTION_COLOR[r.action] ?? 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: '0.74rem' }}>
                  {ACTION_LABEL[r.action] ?? r.action}
                  {r.newModel && <span style={{ fontWeight: 400, fontSize: '0.65rem', color: 'var(--status-warning)', marginLeft: 3 }}>(+รุ่นใหม่)</span>}
                </td>
                {isRobot && <>
                  <td style={{ padding: '0.35rem 0.6rem', fontVariantNumeric: 'tabular-nums', fontSize: '0.73rem' }}>{r.sn}</td>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{r.modelName || '—'}{r.guessedModel && <span style={{ fontSize: '0.6rem', color: 'var(--status-warning)', marginLeft: 3 }}>⚡</span>}</td>
                  <td style={{ padding: '0.35rem 0.6rem', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.ownerName || r.storeName || '—'}</td>
                  <td style={{ padding: '0.35rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.71rem' }}>{r.storeName || '—'}</td>
                </>}
                {isStore && <>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{r.name}</td>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{r.phone || '—'}</td>
                </>}
                {isUnbound && <>
                  <td style={{ padding: '0.35rem 0.6rem', fontVariantNumeric: 'tabular-nums', fontSize: '0.73rem' }}>{r.sn}</td>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{r.modelName || '—'}{r.guessedModel && <span style={{ fontSize: '0.6rem', color: 'var(--status-warning)', marginLeft: 3 }}>⚡</span>}</td>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{r.agentName || <span style={{ color: 'var(--text-muted)' }}>OZONE</span>}</td>
                </>}
                {isAgent && <>
                  <td style={{ padding: '0.35rem 0.6rem' }}>{r.name}</td>
                  <td style={{ padding: '0.35rem 0.6rem', fontVariantNumeric: 'tabular-nums', fontSize: '0.73rem' }}>{r.code || '—'}</td>
                </>}
                <td style={{ padding: '0.35rem 0.6rem', color: 'var(--text-muted)', fontSize: '0.72rem', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.reason || (r.changes ?? []).join(' | ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 30 && <div style={{ padding: '0.4rem 0.6rem', fontSize: '0.75rem', color: 'var(--text-muted)', borderTop: '1px solid var(--border-color)' }}>แสดง 30 จาก {rows.length} แถว</div>}
      </div>
    );
  };

  return (
    <div style={{ padding: '1.5rem', maxWidth: 1180 }}>
      <div
        className="card"
        style={{
          marginBottom: '1.25rem',
          padding: '1.25rem 1.35rem',
          background: 'linear-gradient(135deg, rgba(32,76,180,0.1), rgba(255,255,255,0.95))',
          border: '1px solid rgba(32,76,180,0.16)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '0.35rem 0.7rem', borderRadius: 999, background: 'rgba(32,76,180,0.1)', color: 'var(--color-primary)', fontSize: '0.78rem', fontWeight: 700, marginBottom: '0.8rem' }}>
              <Upload size={14} />
              ศูนย์นำเข้าข้อมูล PUDU
            </div>
            <h1 style={{ fontSize: '2rem', lineHeight: 1.1, fontWeight: 800, color: 'var(--text-primary)', margin: 0 }}>
              นำเข้าข้อมูล
            </h1>
            <p style={{ color: 'var(--text-muted)', marginTop: '0.55rem', fontSize: '0.96rem', maxWidth: 560 }}>
              อัปโหลดไฟล์ Excel หลายไฟล์พร้อมกัน แล้วระบบจะจัดลำดับวิเคราะห์และนำเข้าให้อัตโนมัติตามชนิดไฟล์
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
              <button className="btn btn-primary" onClick={handleSyncPudu} disabled={syncLoading} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                {syncLoading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={16} />}
                {syncLoading ? 'กำลังซิงก์ Pudu...' : 'ซิงก์ข้อมูล Pudu'}
              </button>
              <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                {lastSyncTime ? `ซิงก์ล่าสุด ${formatThaiDateTime(lastSyncTime)}` : 'ยังไม่มีเวลาซิงก์ล่าสุด'}
              </span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(110px, 1fr))', gap: '0.75rem', minWidth: 'min(100%, 360px)' }}>
            {[
              { label: 'ไฟล์ที่เลือก', value: entries.length, color: 'var(--color-primary)' },
              { label: 'พร้อมนำเข้า', value: totalPreviewChanges, color: 'var(--status-success)' },
              { label: 'นำเข้าแล้ว', value: totalDone, color: 'var(--status-info)' },
            ].map((item) => (
              <div key={item.label} style={{ background: 'rgba(255,255,255,0.88)', border: '1px solid var(--border-color)', borderRadius: 16, padding: '0.85rem 0.9rem' }}>
                <div style={{ fontSize: '1.45rem', fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
                <div style={{ fontSize: '0.74rem', color: 'var(--text-muted)', marginTop: 6 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {(syncResult || syncLoading) && (
        <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', marginBottom: syncCards.length > 0 ? '0.85rem' : 0 }}>
            <div>
              <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.96rem' }}>ผลการซิงก์ Pudu</div>
              <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                {syncLoading ? 'กำลังดึงข้อมูลร้านค้าและหุ่นยนต์จาก Pudu Cloud' : 'สรุปผลจากการซิงก์ล่าสุดบนหน้านี้'}
              </div>
            </div>
            {syncResult?.errors?.length ? (
              <div style={{ fontSize: '0.76rem', color: 'var(--status-warning)', fontWeight: 700 }}>
                พบคำเตือน {syncResult.errors.length} รายการ
              </div>
            ) : null}
          </div>

          {syncLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.84rem', color: 'var(--text-primary)' }}>
              <Loader size={16} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
              กำลังซิงก์ข้อมูลจาก Pudu Cloud...
            </div>
          )}

          {!syncLoading && syncCards.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '0.75rem' }}>
              {syncCards.map((item) => (
                <div key={item.label} style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', borderRadius: 14, padding: '0.75rem 0.85rem' }}>
                  <div style={{ fontSize: '1.2rem', fontWeight: 800, color: item.color, lineHeight: 1 }}>{item.value}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 6 }}>{item.label}</div>
                </div>
              ))}
            </div>
          )}

          {!syncLoading && !!syncResult?.errors?.length && (
            <div style={{ marginTop: '0.85rem', padding: '0.75rem 0.85rem', border: '1px solid var(--status-warning)', background: 'var(--status-warning-bg)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem', color: 'var(--text-primary)' }}>
              <details><summary>ดูข้อผิดพลาดทั้งหมด ({syncResult.errors.length})</summary>
              {syncResult.errors.map((msg, index) => (
                <div key={`${index}-${msg}`}>⚠ {msg}</div>
              ))}
              </details>
            </div>
          )}
        </div>
      )}

      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.1rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '0.75rem' }}>
          {(['select', 'confirm', 'done'] as const).map((s, i) => {
            const current = stepIndex(step);
            const active = current === i;
            const done = current > i;
            return (
              <div
                key={s}
                style={{
                  borderRadius: 16,
                  padding: '0.85rem 0.95rem',
                  border: `1px solid ${done ? 'rgba(22,163,74,0.28)' : active ? 'rgba(32,76,180,0.28)' : 'var(--border-color)'}`,
                  background: done ? 'rgba(22,163,74,0.08)' : active ? 'rgba(32,76,180,0.08)' : 'var(--bg-secondary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 999, display: 'grid', placeItems: 'center',
                    fontSize: '0.82rem', fontWeight: 800,
                    color: done ? 'white' : active ? 'white' : 'var(--text-muted)',
                    background: done ? 'var(--status-success)' : active ? 'var(--color-primary)' : 'rgba(148,163,184,0.2)',
                  }}>
                    {done ? '✓' : i + 1}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, color: done ? 'var(--status-success)' : active ? 'var(--color-primary)' : 'var(--text-secondary)', fontSize: '0.86rem' }}>
                      {s === 'select' ? 'เลือกไฟล์' : s === 'confirm' ? 'ตรวจสอบ & ยืนยัน' : 'เสร็จสิ้น'}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                      {s === 'select' ? 'เลือกและจัดเรียงไฟล์' : s === 'confirm' ? 'ดูผลก่อนนำเข้า' : 'สรุปผลการนำเข้า'}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {step === 'select' && entries.length === 0 && (
        <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.1rem', backgroundColor: 'var(--status-info-bg)', border: '1px solid var(--status-info)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.85rem' }}>
            <Info size={16} style={{ color: 'var(--status-info)', flexShrink: 0 }} />
            <strong style={{ color: 'var(--text-primary)', fontSize: '0.92rem' }}>เลือกไฟล์ทั้งหมดพร้อมกัน</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>ระบบจะเรียงลำดับนำเข้าให้อัตโนมัติ</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '0.75rem' }}>
            {GUIDE_CARDS.map((card, index) => (
              <div key={card.key} style={{ background: 'rgba(255,255,255,0.76)', border: '1px solid rgba(32,76,180,0.18)', borderRadius: 14, padding: '0.9rem 0.95rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem', marginBottom: '0.45rem' }}>
                  <div style={{ width: 24, height: 24, borderRadius: 999, display: 'grid', placeItems: 'center', fontSize: '0.74rem', fontWeight: 800, background: `${card.accent}18`, color: card.accent }}>
                    {index + 1}
                  </div>
                  <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '0.86rem' }}>{card.title}</div>
                </div>
                <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{card.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {(step === 'select' || step === 'previewing') && (
        <div style={{ display: 'grid', gridTemplateColumns: entries.length > 0 ? 'minmax(0, 1.3fr) minmax(320px, 0.9fr)' : '1fr', gap: '1rem', marginBottom: '1rem' }}>
          <div
            onClick={() => step === 'select' && fileInput.current?.click()}
            onDragOver={e => { e.preventDefault(); if (step === 'select') setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className="card"
            style={{
              border: `2px dashed ${dragging ? 'var(--color-primary)' : 'rgba(148,163,184,0.28)'}`,
              borderRadius: 24,
              padding: entries.length > 0 ? '1.4rem 1.2rem' : '2.4rem 1.2rem',
              textAlign: 'center',
              cursor: step === 'select' ? 'pointer' : 'default',
              transition: 'all 0.2s',
              background: dragging ? 'rgba(32,76,180,0.05)' : 'linear-gradient(180deg, rgba(255,255,255,0.96), rgba(243,247,255,0.98))',
              opacity: step === 'previewing' ? 0.6 : 1,
              minHeight: entries.length > 0 ? 240 : 280,
              display: 'grid',
              placeItems: 'center',
            }}
          >
            <input aria-label="เลือกไฟล์ Excel จาก Pudu"
              ref={fileInput}
              type="file"
              accept=".xlsx,.xls"
              multiple
              style={{ display: 'none' }}
              onChange={e => { if (e.target.files?.length) { addFiles(e.target.files); e.target.value = ''; } }}
            />
            <div>
              <div style={{ width: 72, height: 72, borderRadius: 22, margin: '0 auto 0.9rem', background: 'rgba(32,76,180,0.1)', display: 'grid', placeItems: 'center' }}>
                <FileSpreadsheet size={entries.length > 0 ? 30 : 38} style={{ color: 'var(--color-primary)' }} />
              </div>
              <div style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: entries.length > 0 ? '1rem' : '1.1rem' }}>
                {entries.length > 0 ? 'ลากไฟล์เพิ่มเติม หรือคลิกเพื่อเลือก' : 'วางไฟล์ Excel ของคุณที่นี่'}
              </div>
              <div style={{ color: 'var(--text-muted)', fontSize: '0.84rem', marginTop: '0.35rem' }}>
                รองรับ `.xlsx` / `.xls` หลายไฟล์พร้อมกัน
              </div>
            </div>
          </div>

          {entries.length > 0 && (
            <div className="card" style={{ padding: '1rem 1rem 0.9rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.8rem' }}>
                <div>
                  <div style={{ fontWeight: 800, color: 'var(--text-primary)', fontSize: '0.98rem' }}>ไฟล์ที่เลือก</div>
                  <div style={{ fontSize: '0.76rem', color: 'var(--text-muted)', marginTop: 2 }}>{entries.length} ไฟล์ในคิว</div>
                </div>
                <button className="btn btn-secondary" onClick={reset} style={{ paddingInline: '0.8rem' }}>ล้างทั้งหมด</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem', maxHeight: 270, overflowY: 'auto', paddingRight: 4 }}>
                {entries.map((entry, i) => (
                  <div key={entry.id} style={{
                    display: 'flex', alignItems: 'center', gap: '0.75rem',
                    padding: '0.7rem 0.85rem', borderRadius: 14,
                    border: `1px solid ${entry.type === 'unknown' ? 'var(--status-warning)' : 'var(--border-color)'}`,
                    backgroundColor: entry.type === 'unknown' ? 'var(--status-warning-bg)' : 'var(--bg-secondary)',
                  }}>
                    <span style={{ fontWeight: 800, fontSize: '0.76rem', color: 'var(--text-muted)', minWidth: 18, textAlign: 'center' }}>{i + 1}</span>
                    <FileSpreadsheet size={16} style={{ color: FILE_TYPE_COLOR[entry.type], flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.82rem', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {entry.file.name}
                      </div>
                      <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', gap: '0.45rem', marginTop: '0.15rem', flexWrap: 'wrap' }}>
                        <span>{(entry.file.size / 1024).toFixed(1)} KB</span>
                        <span style={{ color: FILE_TYPE_COLOR[entry.type], fontWeight: 700 }}>{FILE_TYPE_LABEL[entry.type]}</span>
                      </div>
                    </div>
                    <button onClick={() => removeEntry(entry.id)} aria-label="ลบไฟล์" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '0.25rem', borderRadius: 6, display: 'flex' }}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
              <button className="btn btn-primary" onClick={doPreviewAll} disabled={entries.length === 0 || hasUnknown} style={{ width: '100%', justifyContent: 'center', marginTop: '0.85rem' }}>
                <Eye size={16} />
                ตรวจสอบทั้งหมด ({entries.length} ไฟล์)
              </button>
            </div>
          )}
        </div>
      )}

      {step === 'select' && hasUnknown && (
        <div style={{ padding: '0.7rem 0.9rem', backgroundColor: 'var(--status-warning-bg)', border: '1px solid var(--status-warning)', borderRadius: 'var(--radius-md)', fontSize: '0.82rem', color: 'var(--text-primary)', marginBottom: '1rem' }}>
          ⚠ ไม่สามารถระบุประเภทบางไฟล์ได้ — ชื่อไฟล์ควรมีคำว่า Agent, Store, Installed หรือ Unbound กรุณาลบไฟล์ที่ไม่รู้จัก
        </div>
      )}

      {(step === 'previewing' || step === 'importing') && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '1rem', padding: '0.75rem 1rem', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', fontSize: '0.875rem', color: 'var(--text-primary)' }}>
          <Loader size={16} style={{ animation: 'spin 1s linear infinite', flexShrink: 0 }} />
          {progress}
        </div>
      )}

      {error && (
        <div className="card" style={{ padding: '0.9rem 1rem', backgroundColor: 'var(--status-danger-bg)', border: '1px solid var(--status-danger)', display: 'flex', gap: '0.75rem', alignItems: 'flex-start', marginBottom: '1rem' }}>
          <AlertCircle size={16} style={{ color: 'var(--status-danger)', flexShrink: 0, marginTop: 2 }} />
          <div style={{ flex: 1, fontSize: '0.83rem', color: 'var(--text-primary)' }}>{error}</div>
          <button onClick={() => setError(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}><X size={15} /></button>
        </div>
      )}

      {step === 'confirm' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {entries.filter(e => e.type !== 'unknown').map(entry => {
            const p = entry.preview;
            const s = p?.summary ?? {};
            const warnings: string[] = p?.warnings ?? [];
            const isExpanded = expandedId === entry.id;

            return (
              <div key={entry.id} className="card" style={{ padding: '1rem', border: entry.error ? '1px solid var(--status-danger)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: entry.error ? '0.5rem' : '0.6rem' }}>
                  <FileSpreadsheet size={16} style={{ color: FILE_TYPE_COLOR[entry.type], flexShrink: 0 }} />
                  <span style={{ fontWeight: 700, fontSize: '0.92rem', color: 'var(--text-primary)', flex: 1 }}>
                    {FILE_TYPE_LABEL[entry.type]}
                    <span style={{ fontWeight: 400, fontSize: '0.78rem', color: 'var(--text-muted)', marginLeft: 8 }}>{entry.file.name}</span>
                  </span>
                  {entry.status === 'previewed' && <span style={{ fontSize: '0.75rem', color: 'var(--status-success)', fontWeight: 600 }}>✓ พร้อม</span>}
                  {entry.status === 'error' && <span style={{ fontSize: '0.75rem', color: 'var(--status-danger)', fontWeight: 600 }}>✗ ผิดพลาด</span>}
                </div>

                {entry.error && (
                  <div style={{ fontSize: '0.82rem', color: 'var(--status-danger)', padding: '0.4rem 0.6rem', backgroundColor: 'var(--status-danger-bg)', borderRadius: 'var(--radius-md)' }}>
                    {entry.error}
                  </div>
                )}

                {p && (
                  <>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {[
                        { label: 'เพิ่มใหม่', val: s.created ?? 0, color: 'var(--status-success)' },
                        { label: 'อัปเดต', val: s.updated ?? 0, color: 'var(--color-primary)' },
                        { label: 'ข้าม', val: s.skipped ?? 0, color: 'var(--text-muted)' },
                        ...((s.errors ?? 0) > 0 ? [{ label: 'ผิดพลาด', val: s.errors, color: 'var(--status-danger)' }] : []),
                      ].map(c => (
                        <div key={c.label} style={{ padding: '0.4rem 0.75rem', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', textAlign: 'center', minWidth: 70 }}>
                          <div style={{ fontSize: '1.15rem', fontWeight: 700, color: c.color }}>{c.val}</div>
                          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>{c.label}</div>
                        </div>
                      ))}
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                        <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginRight: '0.5rem' }}>{p.totalRows ?? (p.rows ?? p.agents ?? []).length} แถว</span>
                        <button onClick={() => setExpandedId(isExpanded ? null : entry.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-primary)', padding: '0.2rem', display: 'flex', alignItems: 'center', gap: 3, fontSize: '0.78rem' }}>
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                          {isExpanded ? 'ซ่อน' : 'ดูรายละเอียด'}
                        </button>
                      </div>
                    </div>

                    {warnings.length > 0 && (
                      <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.7rem', backgroundColor: 'var(--status-warning-bg)', border: '1px solid var(--status-warning)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem' }}>
                        {warnings.map((w, i) => <div key={i}>⚠ {w}</div>)}
                      </div>
                    )}

                    {isExpanded && renderPreviewRows(entry)}
                  </>
                )}
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.25rem' }}>
            {totalPreviewChanges > 0 ? (
              <button className="btn btn-primary" onClick={doImportAll} style={{ flex: 1, justifyContent: 'center' }}>
                <CheckCircle size={16} />
                ยืนยันนำเข้าทั้งหมด ({totalPreviewChanges} รายการ)
              </button>
            ) : (
              <div style={{ flex: 1, fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>ไม่มีข้อมูลที่ต้องอัปเดต</div>
            )}
            <button className="btn btn-secondary" onClick={reset}>เลือกใหม่</button>
          </div>
        </div>
      )}

      {step === 'done' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <div className="card" style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            {totalErrors > 0 || entries.some(e => e.result?.errors?.length) ? <AlertCircle size={22} style={{ color: 'var(--status-warning)', flexShrink: 0 }} /> : <CheckCircle size={22} style={{ color: 'var(--status-success)', flexShrink: 0 }} />}
            <div>
              <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--text-primary)' }}>{totalErrors > 0 || entries.some(e => e.result?.errors?.length) ? 'นำเข้าเสร็จสิ้นพร้อมข้อผิดพลาด' : 'นำเข้าเสร็จสิ้น'}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                สำเร็จ {totalDone} ไฟล์{totalErrors > 0 ? `, ผิดพลาด ${totalErrors} ไฟล์` : ''}
              </div>
            </div>
          </div>

          {entries.filter(e => e.type !== 'unknown').map(entry => {
            const r = entry.result;
            return (
              <div key={entry.id} className="card" style={{ padding: '1rem', border: entry.error ? '1px solid var(--status-danger)' : undefined }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  {entry.status === 'done' ? <CheckCircle size={15} style={{ color: 'var(--status-success)' }} /> : <AlertCircle size={15} style={{ color: 'var(--status-danger)' }} />}
                  <span style={{ fontWeight: 700, fontSize: '0.9rem', color: 'var(--text-primary)' }}>{FILE_TYPE_LABEL[entry.type]}</span>
                  <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>{entry.file.name}</span>
                </div>
                {entry.error && <div style={{ fontSize: '0.82rem', color: 'var(--status-danger)' }}>{entry.error}</div>}
                {r && (
                  <>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      {[
                        { label: 'ทั้งหมด', val: r.totalRows ?? 0, color: 'var(--text-primary)' },
                        { label: 'เพิ่ม', val: r.created ?? 0, color: 'var(--status-success)' },
                        { label: 'อัปเดต', val: r.updated ?? 0, color: 'var(--color-primary)' },
                        { label: 'ข้าม', val: r.skipped ?? 0, color: 'var(--text-muted)' },
                      ].map(c => (
                        <div key={c.label} style={{ padding: '0.4rem 0.65rem', backgroundColor: 'var(--bg-secondary)', borderRadius: 'var(--radius-md)', textAlign: 'center', minWidth: 60 }}>
                          <div style={{ fontSize: '1.1rem', fontWeight: 700, color: c.color }}>{c.val}</div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{c.label}</div>
                        </div>
                      ))}
                    </div>
                    {r.errors?.length > 0 && (
                      <div style={{ marginTop: '0.5rem', padding: '0.5rem 0.7rem', backgroundColor: 'var(--status-warning-bg)', borderRadius: 'var(--radius-md)', fontSize: '0.78rem' }}>
                        <details><summary>{r.errors.length} ปัญหา — กดเพื่อดูทั้งหมด</summary>
                        <ul style={{ margin: '0.2rem 0 0 1rem', padding: 0 }}>{r.errors.map((e: string, i: number) => <li key={i}>{e}</li>)}</ul>
                        </details>
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          <button className="btn btn-secondary" onClick={reset} style={{ justifyContent: 'center', marginTop: '0.25rem' }}>
            <Upload size={15} />
            นำเข้ารอบใหม่
          </button>
        </div>
      )}
    </div>
  );
};

export default PuduImport;
