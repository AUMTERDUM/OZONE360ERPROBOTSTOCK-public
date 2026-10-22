import React, { useState, useMemo } from 'react';
import ModelAvatar from '../components/ModelAvatar';
import { useToast } from '../context/ToastContext';
import { useData, type RobotModel } from '../context/DataContext';
import { MA_CATEGORIES, MA_CATEGORY_LABELS, guessMaCategory } from '../utils/maChecklistFields';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { Plus, Edit2, Trash2, Search, X } from 'lucide-react';
import api from '../api';
import Pagination from '../components/Pagination';
import { Modal, FormSubmitButton, TableSkeleton, useUrlSearch, useTableSort, SortableTh } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import ZoomableImage from '../components/ZoomableImage';
import CameraScanButton from '../components/CameraScanButton';

const parseSkuList = (value?: string | null) =>
  Array.from(new Set(
    String(value || '')
      .split(/[\n,]+/)
      .map(item => item.trim())
      .filter(Boolean)
  ));

const Models: React.FC = () => {
  const { models, loading, addModel, updateModel, deleteModel } = useData();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const confirm = useConfirm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingModel, setEditingModel] = useState<RobotModel | null>(null);
  const [search, setSearch] = useUrlSearch();
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
    const filtered = useMemo(() => !search ? models : models.filter(m =>
    m.name.toLowerCase().includes(search.toLowerCase()) ||
    m.type.toLowerCase().includes(search.toLowerCase()) ||
    parseSkuList(m.sku).some(sku => sku.toLowerCase().includes(search.toLowerCase()))
  ), [models, search]);
  const sort = useTableSort<typeof filtered[0]>({
    sku: m => m.sku || '',
    name: m => m.name,
    type: m => m.type,
    payloadCapacity: m => m.payloadCapacity,
    batteryLife: m => m.batteryLife,
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);

  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    type: '',
    payloadCapacity: '',
    batteryLife: '',
    imageUrl: '',
    maCategory: ''
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const { showToast } = useToast();

  const openForm = (model?: RobotModel) => {
    if (model) {
      setEditingModel(model);
      setFormData({
        sku: model.sku || '',
        name: model.name,
        type: model.type,
        payloadCapacity: model.payloadCapacity,
        batteryLife: model.batteryLife,
        imageUrl: model.imageUrl || '',
        maCategory: model.maCategory || ''
      });
    } else {
      setEditingModel(null);
      setFormData({ sku: '', name: '', type: '', payloadCapacity: '', batteryLife: '', imageUrl: '', maCategory: '' });
    }
    setImageFile(null);
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (uploading) return;
    // One lock for the whole save (image upload + model save), so it can't be submitted twice.
    setUploading(true);
    try {
      const finalData = { ...formData };
      if (imageFile) {
        try {
          const fd = new FormData();
          fd.append('image', imageFile);
          const res = await api.post('/upload', fd);
          finalData.imageUrl = res.data.url;
        } catch {
          showToast('อัปโหลดรูปไม่สำเร็จ — ลองใหม่ หรือเอารูปออกแล้วบันทึก', 'error');
          return;
        }
      }
      if (editingModel) {
        await updateModel(editingModel.id, finalData);
      } else {
        await addModel(finalData);
      }
      setIsModalOpen(false);
    } catch {
      // addModel/updateModel already showed why the save failed; keep the form open.
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('ยืนยันการลบ', { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    await deleteModel(id);
  };

  return (
    <div className="page-container">
      <PageHeader
        title="รุ่นหุ่นยนต์"
        subtitle={`แสดง ${filtered.length} จาก ${models.length} รุ่น และแต่ละรุ่นผูกได้หลาย SKU`}
        actions={<div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ position: 'relative' }}>
            <Search size={14} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input aria-label="ค้นหารุ่น..." className="form-control" style={{ paddingLeft: '2rem', paddingRight: '2rem', minWidth: 140 }} placeholder="ค้นหารุ่น..." value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
            {!search && <CameraScanButton variant="inline" onScan={v => { setSearch(v); setPage(1); }} />}
            {search && (
              <button
                type="button"
                onClick={() => { setSearch(''); setPage(1); }}
                aria-label="ล้างคำค้นหารุ่นหุ่นยนต์"
                title="ล้างคำค้นหา"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', padding: 0 }}
              >
                <X size={13} />
              </button>
            )}
          </div>
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => openForm()}>
              <Plus size={16}/> เพิ่มรุ่น
            </button>
          )}
        </div>}
      />

      <div className="card">
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th>รูปภาพ</th>
                <SortableTh {...sort.th('sku')}>SKU</SortableTh>
                <SortableTh {...sort.th('name')}>ชื่อ</SortableTh>
                <SortableTh {...sort.th('type')}>ประเภท</SortableTh>
                <SortableTh {...sort.th('payloadCapacity')}>น้ำหนักบรรทุก</SortableTh>
                <SortableTh {...sort.th('batteryLife')}>อายุแบตเตอรี่</SortableTh>
                {isAdmin && <th>การดำเนินการ</th>}
              </tr>
            </thead>
            <tbody>
              {paginated.map(model => (
                <tr key={model.id}>
                  <td>
                    {model.imageUrl
                      ? <ZoomableImage src={model.imageUrl} alt={model.name} style={{ width: 44, height: 44, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border-color)' }} />
                      : <ModelAvatar name={model.name} size={44} />
                    }
                  </td>
                  <td style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12, fontWeight: 600 }}>
                    {parseSkuList(model.sku).join(', ') || '—'}
                  </td>
                  <td style={{ fontWeight: 600 }}>{model.name}</td>
                  <td>{model.type}</td>
                  <td>{model.payloadCapacity}</td>
                  <td>{model.batteryLife}</td>
                  {isAdmin && (
                    <td>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openForm(model)} aria-label={`แก้ไขรุ่น ${model.name}`} title="แก้ไขรุ่น">
                          <Edit2 size={14}/>
                        </button>
                        <button className="btn" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-danger)' }} onClick={() => handleDelete(model.id)} aria-label={`ลบรุ่น ${model.name}`} title="ลบรุ่น">
                          <Trash2 size={14}/>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {loading && models.length === 0 && <TableSkeleton cols={isAdmin ? 7 : 6} />}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={isAdmin ? 7 : 6} className="text-center text-muted">ไม่พบรุ่นหุ่นยนต์</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={size => { setPageSize(size); setPage(1); }} />
      </div>

      <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingModel ? 'แก้ไขรุ่น' : 'เพิ่มรุ่น'} width={400} describedById="models-form-description">
        <p id="models-form-description" style={{ marginTop: 0, marginBottom: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          จัดการ SKU หลายรายการ ชื่อรุ่น ประเภท น้ำหนักบรรทุก อายุแบตเตอรี่ และรูปภาพประกอบของรุ่นหุ่นยนต์
        </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
              <div>
                <label className="form-label" htmlFor="mdl-sku">SKU</label>
                <textarea
                  id="mdl-sku"
                  className="form-control"
                  rows={3}
                  value={formData.sku}
                  onChange={e => setFormData({...formData, sku: e.target.value})}
                  placeholder={`เช่น BBP-01\n21501-000081\nหรือคั่นด้วย ,`}
                />
                <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                  1 รุ่นสามารถมีหลาย SKU ได้ โดยแยกด้วยบรรทัดใหม่หรือเครื่องหมายจุลภาค
                </div>
              </div>
              <div>
                <label className="form-label" htmlFor="mdl-name">ชื่อ</label>
                <input id="mdl-name" required className="form-control" type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="mdl-type">ประเภท (เช่น AMR, AGV)</label>
                <input id="mdl-type" required className="form-control" type="text" value={formData.type} onChange={e => setFormData({...formData, type: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="mdl-ma">ประเภทใบงาน MA</label>
                <select id="mdl-ma" className="form-control" value={formData.maCategory} onChange={e => setFormData({...formData, maCategory: e.target.value})}>
                  <option value="">อัตโนมัติจากชื่อรุ่น ({MA_CATEGORY_LABELS[guessMaCategory(formData.name)]})</option>
                  {MA_CATEGORIES.map(c => <option key={c} value={c}>{MA_CATEGORY_LABELS[c]}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="mdl-payload">น้ำหนักบรรทุก</label>
                <input id="mdl-payload" required className="form-control" type="text" value={formData.payloadCapacity} onChange={e => setFormData({...formData, payloadCapacity: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="mdl-battery">อายุแบตเตอรี่</label>
                <input id="mdl-battery" required className="form-control" type="text" value={formData.batteryLife} onChange={e => setFormData({...formData, batteryLife: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="mdl-img">รูปภาพ</label>
                {formData.imageUrl && !imageFile && (
                  <img src={formData.imageUrl} alt={`รูปปัจจุบันของ ${formData.name}`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, marginBottom: 6, border: '1px solid var(--border-color)' }} />
                )}
                {imageFile && (
                  <img src={URL.createObjectURL(imageFile)} alt={`ตัวอย่างรูปที่จะอัปโหลด`} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, marginBottom: 6, border: '1px solid var(--accent-primary)' }} />
                )}
                <input id="mdl-img" className="form-control" type="file" accept="image/*" onChange={e => setImageFile(e.target.files?.[0] || null)} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>ยกเลิก</button>
                <FormSubmitButton loading={uploading} type="submit">
                  {editingModel ? 'บันทึกการแก้ไข' : 'สร้าง'}
                </FormSubmitButton>
              </div>
            </form>
      </Modal>
    </div>
  );
};

export default Models;
