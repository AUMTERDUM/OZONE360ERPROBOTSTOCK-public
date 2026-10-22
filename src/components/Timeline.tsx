import React, { useState, useEffect } from 'react';
import api from '../api';
import { formatThaiDateTime } from '../utils/thaiDate';

interface TimelineEntry {
  type: string;
  date: string;
  action: string;
  user: string | null;
  details: any;
  oldValues: any;
}

interface Props {
  entityType: string;
  entityId: string;
}

const actionLabels: Record<string, string> = {
  created: 'สร้าง',
  updated: 'แก้ไข',
  deleted: 'ลบ',
  status_changed: 'เปลี่ยนสถานะ',
  attachment_added: 'เพิ่มไฟล์แนบ',
  transferred: 'โอนอะไหล่',
  generated: 'สร้างอัตโนมัติ',
  converted_to_po: 'แปลงเป็น PO',
  maintenance_ticket: 'ประวัติซ่อมบำรุง',
  maintenance_visit: 'เข้าบำรุงรักษา',
  robot_loan: 'ประวัติยืมหุ่นยนต์',
};

const typeColors: Record<string, string> = {
  activity: 'var(--status-info)',
  attachment: '#8b5cf6',
  related: 'var(--status-warning)',
  robot: '#f97316',
  maintenance_visit: '#0ea5e9',
  loan: 'var(--status-success)',
};

export default function Timeline({ entityType, entityId }: Props) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    api.get(`/timeline/${entityType}/${entityId}`)
      .then(({ data }) => { if (!cancelled) setEntries(data); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [entityType, entityId]);

  if (loading) return <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>กำลังโหลด Timeline...</div>;
  if (entries.length === 0) return <div style={{ padding: '1rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>ไม่มีประวัติ</div>;

  return (
    <div style={{ maxHeight: 400, overflowY: 'auto', padding: '0.5rem 0' }}>
      {entries.map((entry, i) => {
        const dateStr = formatThaiDateTime(entry.date, { dateStyle: 'short', timeStyle: 'short' });
        const dotColor = typeColors[entry.type] || 'var(--status-neutral)';
        const baseAction = entry.action.includes('.') ? entry.action.split('.').pop()! : entry.action;
        const label = actionLabels[baseAction] || entry.action;
        const prefix = entry.type === 'related' ? (entry.action.startsWith('ticket.') ? '🎫 ' : entry.action.startsWith('delivery.') ? '📦 ' : '') : '';

        return (
          <div key={i} style={{ display: 'flex', gap: '0.75rem', padding: '0.4rem 0', borderBottom: '1px solid var(--border-color)' }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: dotColor, marginTop: 6, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '0.82rem', fontWeight: 600 }}>
                {prefix}{label}
                {entry.user && <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>โดย {entry.user}</span>}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{dateStr}</div>
              {entry.details && entry.action === 'status_changed' && entry.oldValues?.status && (
                <div style={{ fontSize: '0.78rem', marginTop: 2 }}>
                  <span style={{ color: 'var(--status-danger)' }}>{entry.oldValues.status}</span> → <span style={{ color: 'var(--status-success)' }}>{entry.details.status}</span>
                </div>
              )}
              {entry.details && entry.action === 'attachment_added' && (
                <div style={{ fontSize: '0.78rem', marginTop: 2, color: 'var(--text-secondary)' }}>
                  📎 {entry.details.filename}
                </div>
              )}
              {entry.details?.issueDescription && <div style={{ fontSize: '0.78rem', marginTop: 2 }}>{entry.details.issueDescription}</div>}
              {entry.details?.usedParts?.length > 0 && <div style={{ fontSize: '0.75rem', marginTop: 2, color: 'var(--text-secondary)' }}>🔧 {entry.details.usedParts.map((p: any) => `${p.part} ×${p.quantity}`).join(', ')}</div>}
              {entry.details?.summary && <div style={{ fontSize: '0.78rem', marginTop: 2 }}>{entry.details.summary}</div>}
              {entry.details?.docNumber && <div style={{ fontSize: '0.78rem', marginTop: 2 }}>{entry.details.docNumber} · {entry.details.borrowerName}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
