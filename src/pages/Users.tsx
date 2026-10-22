import React, { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ShieldCheck, Mail } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useConfirm } from '../context/ConfirmContext';
import { TableSkeleton, EmptyState, useEscapeKey, Modal, FormSubmitButton, useTableSort, SortableTh } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';

interface UserRecord { id: string; username: string; role: string; googleEmail?: string | null; }

const Users: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const confirm = useConfirm();

  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const sort = useTableSort<UserRecord>({
    username: u => u.username,
    role: u => u.role,
    googleEmail: u => u.googleEmail || '',
  });
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [formData, setFormData] = useState({ username: '', password: '', role: 'ADMIN', googleEmail: '' });
  const [currentPassword, setCurrentPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user?.role !== 'ADMIN') { navigate('/'); return; }
    fetchUsers();
  }, [user]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/users');
      setUsers(res.data); setLoadError(false);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const openForm = (u?: UserRecord) => {
    setCurrentPassword('');
    if (u) {
      setEditingUser(u);
      setFormData({ username: u.username, password: '', role: 'ADMIN', googleEmail: u.googleEmail ?? '' });
    } else {
      setEditingUser(null);
      setFormData({ username: '', password: '', role: 'ADMIN', googleEmail: '' });
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      if (editingUser) {
        const isSelf = editingUser.id === user?.id;
        if (isSelf && formData.password) {
          await api.post('/auth/change-password', { currentPassword, newPassword: formData.password });
          showToast('เปลี่ยนรหัสผ่านสำเร็จ', 'success');
        } else {
          const payload: Record<string, string | null> = { username: formData.username, role: 'ADMIN', googleEmail: formData.googleEmail || null };
          await api.put(`/users/${editingUser.id}`, payload);
          showToast('แก้ไขข้อมูลผู้ใช้งานสำเร็จ', 'success');
        }
      } else {
        await api.post('/users', { username: formData.username, password: formData.password, role: formData.role, googleEmail: formData.googleEmail || null });
        showToast('เพิ่มผู้ใช้งานใหม่สำเร็จ', 'success');
      }
      setIsModalOpen(false);
      setCurrentPassword('');
      fetchUsers();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (deleting) return;
    if (!await confirm('ลบผู้ใช้งานนี้?', { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    try {
      setDeleting(true);
      await api.delete(`/users/${id}`);
      showToast('ลบผู้ใช้งานเรียบร้อยแล้ว', 'success');
      fetchUsers();
    } catch (e: any) {
      showToast(e?.response?.data?.error || 'ลบไม่สำเร็จ', 'error');
    } finally { setDeleting(false); }
  };

  useEscapeKey(() => setIsModalOpen(false), isModalOpen);

  return (
    <div>
      {loadError && <div role="alert" className="card" style={{ color: 'var(--status-danger)', marginBottom: '1rem' }}>โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={loading} onClick={fetchUsers}>ลองใหม่</button></div>}
      <PageHeader
        title="จัดการผู้ใช้งาน"
        subtitle={`แสดงผู้ใช้งานทั้งหมด ${users.length} คน — ลบผู้ใช้อื่นได้ แต่เปลี่ยนรหัสผ่านได้เฉพาะบัญชีตัวเอง`}
        actions={<button className="btn btn-primary" onClick={() => openForm()}>
          <Plus size={16} /> เพิ่มผู้ใช้
        </button>}
      />

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <SortableTh {...sort.th('username')}>ชื่อผู้ใช้</SortableTh>
                <SortableTh {...sort.th('role')}>บทบาท</SortableTh>
                <SortableTh {...sort.th('googleEmail')}>บัญชี Google</SortableTh>
                <th>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={4} />}
              {!loading && !loadError && users.length === 0 && (
                <EmptyState icon={<ShieldCheck size={40} />} title="ไม่พบผู้ใช้งาน" description="ยังไม่มีผู้ใช้งานในระบบ" colSpan={4} />
              )}
              {!loading && sort.apply(users).map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 600 }}>{u.username}</td>
                  <td>
                    <span className="badge danger" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                      <ShieldCheck size={12} />
                      {u.role}
                    </span>
                  </td>
                  <td style={{ fontSize: '0.82rem', color: u.googleEmail ? 'var(--status-success)' : 'var(--text-muted)' }}>
                    {u.googleEmail
                      ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Mail size={12} />{u.googleEmail}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>-</span>}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openForm(u)} aria-label={`แก้ไขผู้ใช้ ${u.username}`}>
                        <Edit2 size={14} />
                      </button>
                      {u.id !== user?.id && (
                        <button className="btn" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-danger)' }} disabled={deleting} onClick={() => handleDelete(u.id)} aria-label={`ลบผู้ใช้ ${u.username}`}>
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingUser ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้'} width={380} describedById="users-form-description">
        <p id="users-form-description" style={{ marginTop: 0, marginBottom: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          {editingUser && editingUser.id !== user?.id
            ? 'แก้ไขข้อมูลบัญชีอื่นได้เฉพาะชื่อผู้ใช้และอีเมล สามารถลบบัญชีอื่นได้ แต่ห้ามเปลี่ยนรหัสผ่านของผู้อื่น'
            : 'เปลี่ยนรหัสผ่านได้เฉพาะบัญชีของตัวเอง โดยต้องกรอกรหัสผ่านปัจจุบัน'}
        </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label className="form-label" htmlFor="usr-name">ชื่อผู้ใช้</label>
                <input
                  id="usr-name"
                  required
                  className="form-control"
                  type="text"
                  autoComplete="off"
                  value={formData.username}
                  onChange={e => setFormData({ ...formData, username: e.target.value })}
                />
              </div>
              {(!editingUser || editingUser.id === user?.id) && <div>
                <label className="form-label" htmlFor="usr-pw">
                  {editingUser ? 'รหัสผ่านใหม่' : 'รหัสผ่าน'}
                </label>
                <input
                  id="usr-pw"
                  className="form-control"
                  type="password"
                  required={!editingUser}
                  autoComplete="new-password"
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                />
              </div>}
              {editingUser?.id === user?.id && formData.password && <div>
                <label className="form-label" htmlFor="usr-current-pw">รหัสผ่านปัจจุบัน</label>
                <input id="usr-current-pw" className="form-control" type="password" required autoComplete="current-password" value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
              </div>}
              <div>
                <label className="form-label" htmlFor="usr-role">บทบาท</label>
                <select id="usr-role" className="form-control" value={formData.role} disabled={!!editingUser} onChange={e => setFormData({ ...formData, role: e.target.value })}>
                  <option value="ADMIN">ADMIN</option>
                </select>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>ADMIN: ผู้ดูแลระบบ จัดการข้อมูลและผู้ใช้งานได้ (API รองรับบทบาทนี้เท่านั้น)</div>
              </div>
              <div>
                <label className="form-label" htmlFor="usr-email">อีเมล Google <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>(สำหรับเข้าสู่ระบบด้วย Google)</span></label>
                <input
                  id="usr-email"
                  className="form-control"
                  type="email"
                  placeholder="user@gmail.com (ไม่บังคับ)"
                  value={formData.googleEmail}
                  readOnly={editingUser?.id === user?.id}
                  onChange={e => setFormData({ ...formData, googleEmail: e.target.value })}
                />
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 4 }}>ใส่ email Google เพื่อให้ user นี้ login ด้วย Google ได้</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>ยกเลิก</button>
                <FormSubmitButton loading={submitting} type="submit">
                  {editingUser ? 'บันทึกการแก้ไข' : 'สร้าง'}
                </FormSubmitButton>
              </div>
            </form>
      </Modal>
    </div>
  );
};

export default Users;
