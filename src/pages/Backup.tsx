import React, { useState, useEffect } from 'react';
import { Database, FolderArchive, Download, Upload, RefreshCw, Info, CheckCircle, AlertTriangle, Server, HardDrive, Clock, Play, Trash2 } from 'lucide-react';
import api from '../api';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import PageHeader from '../components/PageHeader';
import { formatThaiDateTime } from '../utils/thaiDate';

interface BackupInfo {
  dbSize: number;
  dbModified: string | null;
  uploadCount: number;
  uploadSize: number;
}

interface AutoBackupFile {
  filename: string;
  size: number;
  createdAt: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function formatDate(d: string | null): string {
  if (!d) return '-';
  return formatThaiDateTime(d, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

export default function Backup() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [info, setInfo] = useState<BackupInfo | null>(null);
  const [loadingInfo, setLoadingInfo] = useState(true);
  const [downloadingDb, setDownloadingDb] = useState(false);
  const [downloadingUploads, setDownloadingUploads] = useState(false);
  const [restoringDb, setRestoringDb] = useState(false);
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const [autoBackups, setAutoBackups] = useState<AutoBackupFile[]>([]);
  const [autoError, setAutoError] = useState(false);
  const [loadingAuto, setLoadingAuto] = useState(true);
  const [runningNow, setRunningNow] = useState(false);
  const [downloadingAuto, setDownloadingAuto] = useState<string | null>(null);

  const fetchInfo = async () => {
    setLoadingInfo(true);
    try {
      const { data } = await api.get<BackupInfo>('/backup/info');
      setInfo(data);
    } catch {
      showToast('ไม่สามารถโหลดข้อมูล backup ได้', 'error');
    } finally {
      setLoadingInfo(false);
    }
  };

  const fetchAutoBackups = async () => {
    setLoadingAuto(true);
    try {
      const { data } = await api.get<AutoBackupFile[]>('/backup/auto/list');
      setAutoBackups(data); setAutoError(false);
    } catch {
      setAutoError(true);
    } finally {
      setLoadingAuto(false);
    }
  };

  const handleRunNow = async () => {
    setRunningNow(true);
    try {
      const { data } = await api.post<AutoBackupFile>('/backup/auto/run', {});
      showToast(`Backup สำเร็จ: ${data.filename}`, 'success');
      await fetchAutoBackups();
    } catch (err: any) {
      showToast(`Backup ล้มเหลว: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setRunningNow(false);
    }
  };

  const handleDeleteAutoBackup = async (filename: string) => {
    const ok = await confirm(`ลบ ${filename} ?`, { danger: true, confirmLabel: 'ลบ' });
    if (!ok) return;
    try {
      await api.delete(`/backup/auto/${filename}`);
      showToast('ลบสำเร็จ', 'success');
      setAutoBackups(prev => prev.filter(f => f.filename !== filename));
    } catch (err: any) {
      showToast(`ลบล้มเหลว: ${err.response?.data?.error || err.message}`, 'error');
    }
  };

  useEffect(() => { fetchInfo(); fetchAutoBackups(); }, []);

  const downloadWithAuth = async (url: string, filename: string, setLoading: (v: boolean) => void) => {
    setLoading(true);
    try {
      const base = import.meta.env.VITE_API_URL || '/api';
      const res = await fetch(`${base}${url}`, {
        credentials: 'include', // send HttpOnly cookie
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
      showToast(`ดาวน์โหลด ${filename} สำเร็จ`, 'success');
    } catch (err: any) {
      showToast(`ดาวน์โหลดล้มเหลว: ${err.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const today = new Date().toISOString().slice(0, 10);

  const handleDownloadDb = () =>
    downloadWithAuth('/backup/db', `ozone360-backup-${today}.db`, setDownloadingDb);

  const handleDownloadUploads = () =>
    downloadWithAuth('/backup/uploads', `ozone360-uploads-${today}.zip`, setDownloadingUploads);

  const handleDownloadAutoBackup = (filename: string) => {
    setDownloadingAuto(filename);
    downloadWithAuth(
      `/backup/auto/download/${encodeURIComponent(filename)}`,
      filename,
      (v) => { if (!v) setDownloadingAuto(null); }
    );
  };

  const handleRestoreDb = async () => {
    if (!restoreFile) return;
    const ok = await confirm(
      `กู้คืนฐานข้อมูลจากไฟล์ ${restoreFile.name}?`,
      {
        title: 'ยืนยันการ Restore ฐานข้อมูล',
        danger: true,
        confirmLabel: 'Restore',
        requireText: 'RESTORE',
        description: 'การกระทำนี้จะเขียนทับฐานข้อมูลปัจจุบัน ระบบจะสำรองไฟล์เดิมไว้อัตโนมัติก่อน',
      },
    );
    if (!ok) return;
    setRestoringDb(true);
    try {
      const formData = new FormData();
      formData.append('file', restoreFile);
      await api.post('/backup/restore/db', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      showToast('Restore สำเร็จ — กำลังโหลดข้อมูลใหม่...', 'success');
      setRestoreFile(null);
      await fetchInfo();
      setTimeout(() => window.location.reload(), 2500);
    } catch (err: any) {
      showToast(`Restore ล้มเหลว: ${err.response?.data?.error || err.message}`, 'error');
    } finally {
      setRestoringDb(false);
    }
  };

  return (
    <div className="page-container">
      <PageHeader
        title="สำรองและกู้คืนข้อมูล"
        subtitle="สำรองและกู้คืนข้อมูลระบบ สำหรับการย้าย server หรือกู้เหตุขัดข้อง"
        actions={<button className="btn btn-ghost" onClick={() => { fetchInfo(); fetchAutoBackups(); }} disabled={loadingInfo}>
          <RefreshCw size={16} className={loadingInfo ? 'spin' : ''} />
          <span>รีเฟรช</span>
        </button>}
      />

      {/* Info Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16, marginBottom: 24 }}>
        {/* DB Card */}
        <div className="stat-card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'var(--accent-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <Database size={24} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>ฐานข้อมูล (SQLite)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              {loadingInfo ? '...' : formatBytes(info?.dbSize ?? 0)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              แก้ไขล่าสุด: {loadingInfo ? '...' : formatDate(info?.dbModified ?? null)}
            </div>
          </div>
        </div>

        {/* Uploads Card */}
        <div className="stat-card" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'var(--status-info-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}>
            <FolderArchive size={24} style={{ color: 'var(--status-info)' }} />
          </div>
          <div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 2 }}>ไฟล์แนบ (Uploads)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)' }}>
              {loadingInfo ? '...' : `${info?.uploadCount ?? 0} ไฟล์`}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              รวม: {loadingInfo ? '...' : formatBytes(info?.uploadSize ?? 0)}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
        {/* Download Section */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <Download size={20} style={{ color: 'var(--accent-primary)' }} />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>สำรองข้อมูล (Backup)</h2>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* DB Backup */}
            <div style={{
              border: '1px solid var(--border-primary)', borderRadius: 10, padding: 16,
              background: 'var(--bg-secondary)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                    <Database size={14} style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--accent-primary)' }} />
                    ฐานข้อมูล (.db)
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    SQLite database — ข้อมูลทั้งหมดในระบบ
                    {info && <span style={{ marginLeft: 6, color: 'var(--accent-primary)', fontWeight: 500 }}>
                      ({formatBytes(info.dbSize)})
                    </span>}
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  onClick={handleDownloadDb}
                  disabled={downloadingDb || loadingInfo}
                  style={{ flexShrink: 0 }}
                >
                  {downloadingDb
                    ? <><RefreshCw size={14} className="spin" /><span>กำลังดาวน์โหลด...</span></>
                    : <><Download size={14} /><span>ดาวน์โหลด</span></>}
                </button>
              </div>
            </div>

            {/* Uploads Backup */}
            <div style={{
              border: '1px solid var(--border-primary)', borderRadius: 10, padding: 16,
              background: 'var(--bg-secondary)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)', marginBottom: 4 }}>
                    <FolderArchive size={14} style={{ marginRight: 6, verticalAlign: 'middle', color: 'var(--status-info)' }} />
                    ไฟล์แนบทั้งหมด (.zip)
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                    รูปภาพและเอกสารที่อัพโหลด
                    {info && <span style={{ marginLeft: 6, color: 'var(--status-info)', fontWeight: 500 }}>
                      ({info.uploadCount} ไฟล์, {formatBytes(info.uploadSize)})
                    </span>}
                  </div>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={handleDownloadUploads}
                  disabled={downloadingUploads || loadingInfo}
                  style={{ flexShrink: 0 }}
                >
                  {downloadingUploads
                    ? <><RefreshCw size={14} className="spin" /><span>กำลัง ZIP...</span></>
                    : <><Download size={14} /><span>ดาวน์โหลด</span></>}
                </button>
              </div>
            </div>
          </div>

          {/* Tip */}
          <div style={{
            marginTop: 16, padding: 12, borderRadius: 8,
            background: 'var(--status-success-bg)', border: '1px solid var(--status-success)',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <CheckCircle size={16} style={{ color: 'var(--status-success)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--status-success)' }}>แนะนำ:</strong> ดาวน์โหลดทั้ง .db และ .zip ไว้พร้อมกัน เพื่อให้ครบถ้วนเมื่อย้าย server
            </div>
          </div>
        </div>

        {/* Restore Section */}
        <div className="card" style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
            <Upload size={20} style={{ color: 'var(--status-warning)' }} />
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>กู้คืนข้อมูล (Restore)</h2>
          </div>

          {/* Warning */}
          <div style={{
            marginBottom: 16, padding: 12, borderRadius: 8,
            background: 'var(--status-warning-bg)', border: '1px solid var(--status-warning)',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <AlertTriangle size={16} style={{ color: 'var(--status-warning)', flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              <strong style={{ color: 'var(--status-warning)' }}>คำเตือน:</strong> การ restore จะเขียนทับฐานข้อมูลปัจจุบัน ระบบจะสำรองไฟล์เดิมไว้อัตโนมัติก่อน
            </div>
          </div>

          {/* File picker */}
          <div style={{
            border: '2px dashed var(--border-primary)', borderRadius: 10, padding: 20,
            textAlign: 'center', marginBottom: 16, background: 'var(--bg-secondary)',
            cursor: 'pointer', transition: 'border-color 0.2s',
          }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const f = e.dataTransfer.files[0];
              if (f) setRestoreFile(f);
            }}
          >
            <HardDrive size={28} style={{ color: 'var(--text-tertiary)', marginBottom: 8 }} />
            <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', marginBottom: 4 }}>
              {restoreFile ? restoreFile.name : 'เลือกไฟล์ .db สำหรับ restore'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 12 }}>
              {restoreFile
                ? <span style={{ color: 'var(--status-success)', fontWeight: 500 }}>{formatBytes(restoreFile.size)}</span>
                : 'ลากไฟล์มาวาง หรือคลิกเลือก'}
            </div>
            <label style={{ cursor: 'pointer' }}>
              <input
                type="file"
                accept=".db"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) setRestoreFile(f); }}
              />
              <span className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 14px' }}>
                เลือกไฟล์
              </span>
            </label>
          </div>

          <button
            className="btn btn-danger"
            style={{ width: '100%', justifyContent: 'center' }}
            onClick={handleRestoreDb}
            disabled={!restoreFile || restoringDb}
          >
            {restoringDb
              ? <><RefreshCw size={14} className="spin" /><span>กำลังกู้คืน...</span></>
              : <><Upload size={14} /><span>กู้คืนฐานข้อมูล</span></>}
          </button>
        </div>
      </div>

      {/* Migration Guide */}
      <div className="card" style={{ padding: 24, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Server size={20} style={{ color: 'var(--accent-primary)' }} />
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>วิธีย้าย Server</h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
          {[
            {
              step: 1,
              title: 'Backup บน server เดิม',
              items: ['ดาวน์โหลดไฟล์ .db (ฐานข้อมูล)', 'ดาวน์โหลดไฟล์ .zip (Uploads)'],
              color: 'var(--accent-primary)',
              bg: 'var(--accent-subtle)',
            },
            {
              step: 2,
              title: 'ติดตั้ง server ใหม่',
              items: ['Clone โปรเจค', 'ตั้งค่า docker-compose.yml', 'รัน docker compose up -d'],
              color: 'var(--status-info)',
              bg: 'var(--status-info-bg)',
            },
            {
              step: 3,
              title: 'Restore ข้อมูล',
              items: ['เข้าหน้า Backup บน server ใหม่', 'อัพโหลดไฟล์ .db เพื่อ restore', 'แตก .zip ใส่ใน ./server/uploads/'],
              color: 'var(--status-warning)',
              bg: 'var(--status-warning-bg)',
            },
            {
              step: 4,
              title: 'ยืนยันข้อมูล',
              items: ['Restart server หลัง restore', 'ตรวจสอบว่าข้อมูลครบ', 'ทดสอบการทำงาน'],
              color: 'var(--status-success)',
              bg: 'var(--status-success-bg)',
            },
          ].map(({ step, title, items, color, bg }) => (
            <div key={step} style={{ borderRadius: 10, padding: 16, background: bg, border: `1px solid ${color}20` }}>
              <div style={{
                width: 28, height: 28, borderRadius: '50%', background: color,
                color: 'var(--text-on-accent)', fontWeight: 700, fontSize: 13,
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10,
              }}>
                {step}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text-primary)', marginBottom: 8 }}>{title}</div>
              <ul style={{ margin: 0, paddingLeft: 16, listStyle: 'disc' }}>
                {items.map((item, i) => (
                  <li key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 3, lineHeight: 1.5 }}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* CLI alternative */}
        <div style={{
          marginTop: 20, padding: 16, borderRadius: 10,
          background: '#1e293b', border: '1px solid #334155',
        }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10, fontWeight: 500 }}>
            <Info size={13} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            วิธีทำ Backup ผ่าน Docker (สำหรับ admin):
          </div>
          <pre style={{ margin: 0, fontSize: 11, color: 'var(--border-color)', lineHeight: 1.8, overflowX: 'auto' }}>{`# Copy database file from container
docker cp aigogle-server-1:/app/dev.db ./backup-$(date +%F).db

# Copy uploads folder
docker cp aigogle-server-1:/app/uploads ./uploads-backup-$(date +%F)

# Or via docker volume (host path)
cp ./server/dev.db ./backup-$(date +%F).db
cp -r ./server/uploads ./uploads-backup-$(date +%F)`}</pre>
        </div>
      </div>

      {/* Auto Backup History */}
      <div className="card" style={{ padding: 24, marginTop: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Clock size={20} style={{ color: 'var(--status-success)' }} />
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>ประวัติสำรองข้อมูลอัตโนมัติ</h2>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>ทุกวันตอนเที่ยงคืน — เก็บ 7 วัน</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost" onClick={fetchAutoBackups} disabled={loadingAuto}>
              <RefreshCw size={14} className={loadingAuto ? 'spin' : ''} />
              <span>รีเฟรช</span>
            </button>
            <button className="btn btn-success" onClick={handleRunNow} disabled={runningNow}>
              {runningNow
                ? <><RefreshCw size={14} className="spin" /><span>กำลังสำรองข้อมูล...</span></>
                : <><Play size={14} /><span>สำรองข้อมูลตอนนี้เลย</span></>}
            </button>
          </div>
        </div>

        {autoError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={loadingAuto} onClick={fetchAutoBackups}>ลองใหม่</button></div>}
        {loadingAuto ? (
          <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-secondary)' }}>
            <RefreshCw size={20} className="spin" style={{ marginBottom: 8 }} />
            <div style={{ fontSize: 13 }}>กำลังโหลด...</div>
          </div>
        ) : autoError && autoBackups.length === 0 ? null : autoBackups.length === 0 ? (
          <div style={{
            textAlign: 'center', padding: '40px 0',
            border: '1px dashed var(--border-primary)', borderRadius: 10,
            background: 'var(--bg-secondary)',
          }}>
            <Clock size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>
              ยังไม่มี auto backup
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              จะเริ่มสำรองอัตโนมัติทุกคืนเที่ยงคืน หรือกด "Backup ตอนนี้เลย"
            </div>
          </div>
        ) : (
          <div style={{ border: '1px solid var(--border-primary)', borderRadius: 10, overflow: 'hidden', overflowX: 'auto' }}>
            <table>
              <thead>
                <tr style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-primary)' }}>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>ชื่อไฟล์</th>
                  <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>ขนาด</th>
                  <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>เวลา</th>
                  <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {autoBackups.map((f, idx) => (
                  <tr key={f.filename} style={{
                    borderBottom: idx < autoBackups.length - 1 ? '1px solid var(--border-primary)' : 'none',
                    background: idx === 0 ? 'var(--status-success-bg)' : 'transparent',
                  }}>
                    <td style={{ padding: '10px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Database size={14} style={{ color: 'var(--accent-primary)', flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>{f.filename}</span>
                        {idx === 0 && (
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
                            background: 'var(--status-success)', color: 'var(--text-on-accent)', letterSpacing: 0.5,
                          }}>ล่าสุด</span>
                        )}
                      </div>
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {formatBytes(f.size)}
                    </td>
                    <td style={{ padding: '10px 16px', fontSize: 13, color: 'var(--text-secondary)' }}>
                      {formatDate(f.createdAt)}
                    </td>
                    <td style={{ padding: '10px 16px', textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 10px', fontSize: 12 }}
                          onClick={() => handleDownloadAutoBackup(f.filename)}
                          disabled={downloadingAuto === f.filename}
                        >
                          {downloadingAuto === f.filename
                            ? <RefreshCw size={13} className="spin" />
                            : <Download size={13} />}
                          <span>ดาวน์โหลด</span>
                        </button>
                        <button
                          className="btn btn-ghost"
                          style={{ padding: '4px 8px', fontSize: 12, color: 'var(--status-danger)' }}
                          onClick={() => handleDeleteAutoBackup(f.filename)}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
