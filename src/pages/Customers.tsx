import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { useData, type Customer } from '../context/DataContext';
import { useAuth } from '../context/AuthContext';
import { useConfirm } from '../context/ConfirmContext';
import { useToast } from '../context/ToastContext';
import { ThaiDateInput } from '../components/ThaiDateInput';
import { Plus, Edit2, Trash2, Search, X, Bot, ChevronRight, Wifi, Battery, Weight, CalendarClock, Wrench, StickyNote, ShieldCheck, Link2, CheckCircle, Download, Upload, FileSpreadsheet, RefreshCw, SkipForward, AlertCircle, Users, Package, MapPin } from 'lucide-react';
import Pagination from '../components/Pagination';
import api from '../api';
import { useEscapeKey, Modal, FormSubmitButton, TableSkeleton, useUrlSearch, useTableSort, SortableTh, hasPopulatedColumn, BodyPortal } from '../components/UIUtils';
import PageHeader from '../components/PageHeader';
import { formatThaiDate } from '../utils/thaiDate';

const Customers: React.FC = () => {
  const { fetchData, customers, robots, models, tickets, loading, addCustomer, updateCustomer, deleteCustomer, addRobot, updateRobot, deleteRobot } = useData();
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const confirm = useConfirm();
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const [search, setSearch] = useUrlSearch();
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [tab, setTab] = useState<'customer' | 'agent'>('customer');
  const [isRobotModalOpen, setIsRobotModalOpen] = useState(false);
  const [robotMode, setRobotMode] = useState<'new' | 'existing'>('new');
  const [robotSaving, setRobotSaving] = useState(false);
  const [robotFormErrors, setRobotFormErrors] = useState<Record<string, string>>({});
  const [robotForm, setRobotForm] = useState({
    existingRobotId: '',
    serialNumber: '',
    modelId: '',
    purchaseDate: new Date().toISOString().split('T')[0],
    warrantyExpiresAt: '',
    notes: '',
  });

  // Part transfer history
  type PartTransferLog = { id: string; entityName: string | null; performedAt: string; performedBy: string | null; newValues: string | null; oldValues?: string | null; };
  const [partHistory, setPartHistory] = useState<{ loading: boolean; logs: PartTransferLog[] }>({ loading: false, logs: [] });
  type CustomerSparePart = { id: string; sku: string; name: string; stock: number };
  type SparePartItem = { id: string; sparePartId: string; serialNumber: string; receivedDate: string };
  const [expandedRobotId, setExpandedRobotId] = useState<string | null>(null);
  const [robotParts, setRobotParts] = useState<Record<string, { loading: boolean; logs: PartTransferLog[] }>>({});
  const [addPartOpen, setAddPartOpen] = useState(false);
  const [sparePartCatalog, setSparePartCatalog] = useState<CustomerSparePart[]>([]);
  const [addPartItems, setAddPartItems] = useState<SparePartItem[]>([]);
  const [addPartForm, setAddPartForm] = useState({ partId: '', quantity: '1', serialNumbers: [] as string[] });
  const [addPartLoading, setAddPartLoading] = useState(false);
  const [addPartItemsLoading, setAddPartItemsLoading] = useState(false);

  // Contact / Site state
  interface Contact { id: string; name: string; role: string; email: string; phone: string; lineId: string; isPrimary: boolean; }
  interface Site { id: string; name: string; address: string; province: string; notes: string; }
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [contactsLoading, setContactsLoading] = useState(false);
  // Records from other modules linked to this customer (site surveys, travel claims).
  const [linkedSurveys, setLinkedSurveys] = useState<{ id: string; siteName: string; formType: string; surveyDate?: string | null }[]>([]);
  const [linkedClaims, setLinkedClaims] = useState<{ id: string; docNumber: string; status: string; totalReimbursed: number; totalAdvance: number }[]>([]);

  // Portal token state
  const [portalToken, setPortalToken] = useState<string | null>(null);
  const [portalGenerating, setPortalGenerating] = useState(false);

  const sectionCustomerId = useRef<string | null>(null);
  const [sectionErrors, setSectionErrors] = useState<Record<string, boolean>>({});
  const [sectionBusy, setSectionBusy] = useState<Record<string, boolean>>({});
  const loadSection = async (section: string, customerId: string) => {
    setSectionBusy(prev => ({ ...prev, [section]: true }));
    try {
      const urls: Record<string, string> = { contacts: '/customers/' + customerId + '/contacts', sites: '/customers/' + customerId + '/sites', surveys: '/site-surveys', claims: '/travel-expenses' };
      const res = await api.get(urls[section], { params: { customerId } });
      if (sectionCustomerId.current !== customerId) return;
      if (section === 'contacts') setContacts(res.data);
      if (section === 'sites') setSites(res.data);
      if (section === 'surveys') setLinkedSurveys(res.data);
      if (section === 'claims') setLinkedClaims(res.data);
      setSectionErrors(prev => ({ ...prev, [section]: false }));
    } catch { if (sectionCustomerId.current === customerId) setSectionErrors(prev => ({ ...prev, [section]: true })); }
    finally { if (sectionCustomerId.current === customerId) setSectionBusy(prev => ({ ...prev, [section]: false })); }
  };
  const sectionError = (section: string) => sectionErrors[section] ? <div role="alert" style={{ color: 'var(--status-danger)', marginBottom: 8 }}>{({ contacts: 'ผู้ติดต่อ', sites: 'สถานที่', surveys: 'แบบสำรวจหน้างาน', claims: 'ใบเบิกค่าเดินทาง' } as Record<string, string>)[section]}: โหลดไม่สำเร็จ <button className="btn btn-outline" disabled={sectionBusy[section]} onClick={() => selectedCustomer && loadSection(section, selectedCustomer.id)}>ลองใหม่</button></div> : null;
  useEffect(() => {
    sectionCustomerId.current = selectedCustomer?.id || null;
    setSectionBusy({});
    setContacts([]); setSites([]); setLinkedSurveys([]); setLinkedClaims([]); setSectionErrors({});
    if (!selectedCustomer) { setPortalToken(null); return; }
    setContactsLoading(true);
    Promise.all(['contacts', 'sites', 'surveys', 'claims'].map(section => loadSection(section, selectedCustomer.id))).finally(() => setContactsLoading(false));
    setPortalToken((selectedCustomer as any).portalToken || null);
    return () => { sectionCustomerId.current = null; };
  }, [selectedCustomer?.id]);

  const generatePortalToken = async () => {
    if (!selectedCustomer) return;
    setPortalGenerating(true);
    try {
      const res = await api.post(`/customers/${selectedCustomer.id}/portal-token`);
      setPortalToken(res.data.portalToken);
      showToast('สร้างลิงก์พอร์ทัลสำเร็จ', 'success');
    } catch { showToast('สร้างลิงก์ไม่สำเร็จ', 'error'); }
    finally { setPortalGenerating(false); }
  };

  const loadRobotParts = async (robotId: string) => {
    if (!selectedCustomer) return;
    setRobotParts(prev => ({ ...prev, [robotId]: { loading: true, logs: prev[robotId]?.logs || [] } }));
    try {
      const res = await api.get(`/customers/${selectedCustomer.id}/robots/${robotId}/part-transfers`);
      setRobotParts(prev => ({ ...prev, [robotId]: { loading: false, logs: res.data } }));
    } catch {
      setRobotParts(prev => ({ ...prev, [robotId]: { loading: false, logs: [] } }));
      showToast('โหลดอะไหล่ของ Unit ไม่สำเร็จ', 'error');
    }
  };

  const toggleRobotParts = (robotId: string) => {
    if (expandedRobotId === robotId) { setExpandedRobotId(null); return; }
    setExpandedRobotId(robotId);
    void loadRobotParts(robotId);
  };

  const openAddPartForCustomer = () => {
    setAddPartForm({ partId: '', quantity: '1', serialNumbers: [] });
    setAddPartItems([]);
    setAddPartOpen(true);
    if (sparePartCatalog.length === 0) {
      api.get('/spare-parts').then(res => setSparePartCatalog(res.data)).catch(() => showToast('โหลดรายการอะไหล่ไม่สำเร็จ', 'error'));
    }
  };

  const handleAddPartSelection = async (partId: string) => {
    setAddPartForm(prev => ({ ...prev, partId, serialNumbers: [] }));
    setAddPartItems([]);
    if (!partId) return;
    setAddPartItemsLoading(true);
    try {
      const res = await api.get(`/spare-parts/${partId}/items`);
      setAddPartItems(res.data.items || []);
    } catch { showToast('โหลดรายการ SN ไม่สำเร็จ', 'error'); }
    finally { setAddPartItemsLoading(false); }
  };

  const handleAddPart = async () => {
    if (!selectedCustomer || !addPartForm.partId) { showToast('กรุณาเลือกอะไหล่', 'error'); return; }
    const part = sparePartCatalog.find(item => item.id === addPartForm.partId);
    const tracked = addPartItems.length > 0;
    const quantity = tracked ? addPartForm.serialNumbers.length : parseInt(addPartForm.quantity) || 0;
    if (quantity <= 0) { showToast(tracked ? 'กรุณาเลือก SN' : 'กรุณาระบุจำนวน', 'error'); return; }
    if (quantity > (part?.stock || 0)) { showToast(`สต๊อกไม่พอ (คงเหลือ ${part?.stock || 0})`, 'error'); return; }
    setAddPartLoading(true);
    try {
      await api.post(`/spare-parts/${addPartForm.partId}/transfer`, {
        customerId: selectedCustomer.id,
        quantity,
        serialNumbers: tracked ? addPartForm.serialNumbers : undefined,
        note: 'เพิ่มให้อยู่ในอะไหล่ของลูกค้า',
      });
      showToast('เพิ่มอะไหล่ให้ลูกค้าสำเร็จ', 'success');
      const customerParts = await api.get(`/customers/${selectedCustomer.id}/part-transfers`);
      setPartHistory({ loading: false, logs: customerParts.data });
      setAddPartOpen(false);
    } catch (err: any) { showToast(err?.response?.data?.error || 'เพิ่มอะไหล่ไม่สำเร็จ', 'error'); }
    finally { setAddPartLoading(false); }
  };

  // Agent import state
  const { showToast } = useToast();
  const [agentImportOpen, setAgentImportOpen] = useState(false);
  const [agentImportStep, setAgentImportStep] = useState<'select' | 'preview' | 'done'>('select');
  const [agentImportFile, setAgentImportFile] = useState<File | null>(null);
  const [agentImportLoading, setAgentImportLoading] = useState(false);
  const [agentImportPreview, setAgentImportPreview] = useState<any>(null);
  const [agentImportResult, setAgentImportResult] = useState<any>(null);
  const agentFileRef = useRef<HTMLInputElement>(null);
  useEscapeKey(() => { if (!agentImportLoading) setAgentImportOpen(false); }, agentImportOpen);

  const openAgentImport = useCallback(() => {
    setAgentImportStep('select'); setAgentImportFile(null);
    setAgentImportPreview(null); setAgentImportResult(null);
    setAgentImportOpen(true);
  }, []);

  const handleAgentFile = useCallback(async (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !['xlsx', 'xls'].includes(ext)) { showToast('รองรับเฉพาะไฟล์ .xlsx หรือ .xls', 'error'); return; }
    setAgentImportFile(file); setAgentImportLoading(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await api.post('/agents/import/preview', fd);
      setAgentImportPreview(res.data); setAgentImportStep('preview');
    } catch (e: any) { showToast(e?.response?.data?.error || 'อัปโหลดไม่สำเร็จ', 'error'); }
    finally { setAgentImportLoading(false); }
  }, [showToast]);

  const handleAgentConfirm = useCallback(async () => {
    if (!agentImportFile) return;
    setAgentImportLoading(true);
    try {
      const fd = new FormData(); fd.append('file', agentImportFile);
      const res = await api.post('/agents/import/confirm', fd);
      setAgentImportResult(res.data); setAgentImportStep('done');
      await fetchData();
      showToast(`นำเข้าตัวแทนสำเร็จ: เพิ่ม ${res.data.created} / อัปเดต ${res.data.updated}`, 'success');
    } catch (e: any) { showToast(e?.response?.data?.error || 'นำเข้าไม่สำเร็จ', 'error'); }
    finally { setAgentImportLoading(false); }
  }, [agentImportFile, fetchData, showToast]);

  // keep drawer in sync after fetchData
  useEffect(() => {
    if (selectedCustomer) {
      const updated = customers.find(c => c.id === selectedCustomer.id);
      if (updated) setSelectedCustomer(updated);
    }
  }, [customers]);

  // fetch part transfer history when a customer is selected
  useEffect(() => {
    if (!selectedCustomer) { setPartHistory({ loading: false, logs: [] }); return; }
    setPartHistory({ loading: true, logs: [] });
    api.get(`/customers/${selectedCustomer.id}/part-transfers`)
      .then(res => setPartHistory({ loading: false, logs: res.data }))
      .catch(() => setPartHistory({ loading: false, logs: [] }));
  }, [selectedCustomer?.id]);

  const [formData, setFormData] = useState({
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    address: ''
  });

  const openForm = (customer?: Customer) => {
    if (customer) {
      setEditingCustomer(customer);
      setFormData({
        name: customer.name,
        contactPerson: customer.contactPerson,
        email: customer.email,
        phone: customer.phone,
        address: customer.address
      });
    } else {
      setEditingCustomer(null);
      setFormData({ name: '', contactPerson: '', email: '', phone: '', address: '' });
    }
    setIsModalOpen(true);
  };

  const [formSaving, setFormSaving] = useState(false);

  const modelById = useMemo(() => new Map(models.map(model => [model.id, model])), [models]);
  const availableRobots = useMemo(
    () => robots.filter(robot => !robot.customerId),
    [robots]
  );

  const openRobotModal = () => {
    setRobotMode('new');
    setRobotFormErrors({});
    setRobotForm({
      existingRobotId: availableRobots[0]?.id || '',
      serialNumber: '',
      modelId: models[0]?.id || '',
      purchaseDate: new Date().toISOString().split('T')[0],
      warrantyExpiresAt: '',
      notes: '',
    });
    setIsRobotModalOpen(true);
  };

  const closeRobotModal = () => {
    if (robotSaving) return;
    setIsRobotModalOpen(false);
  };

  const handleAddRobotToCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomer) return;
    const errors: Record<string, string> = {};
    if (robotMode === 'existing') {
      if (!robotForm.existingRobotId) errors.existingRobotId = 'กรุณาเลือกหุ่นยนต์';
    } else {
      if (!robotForm.serialNumber.trim()) errors.serialNumber = 'กรุณากรอก Serial Number';
      if (!robotForm.modelId) errors.modelId = 'กรุณาเลือกรุ่นหุ่นยนต์';
    }
    if (Object.keys(errors).length > 0) {
      setRobotFormErrors(errors);
      return;
    }

    setRobotFormErrors({});
    setRobotSaving(true);
    try {
      if (robotMode === 'existing') {
        const selectedRobotRecord = availableRobots.find(robot => robot.id === robotForm.existingRobotId);
        if (!selectedRobotRecord) {
          setRobotFormErrors({ existingRobotId: 'ไม่พบหุ่นยนต์ที่เลือก' });
          return;
        }
        const nextStatus = selectedRobotRecord.status === 'In Stock' ? 'Assigned' : selectedRobotRecord.status;
        await updateRobot(selectedRobotRecord.id, {
          customerId: selectedCustomer.id,
          status: nextStatus,
        });
      } else {
        await addRobot({
          serialNumber: robotForm.serialNumber.trim(),
          modelId: robotForm.modelId,
          status: 'Assigned',
          customerId: selectedCustomer.id,
          purchaseDate: robotForm.purchaseDate,
          warrantyExpiresAt: robotForm.warrantyExpiresAt || undefined,
          notes: robotForm.notes.trim() || undefined,
        });
      }
      setIsRobotModalOpen(false);
    } finally {
      setRobotSaving(false);
    }
  };

  const handleDetachRobot = async (robotId: string) => {
    const robot = robots.find(item => item.id === robotId);
    if (!robot) return;
    if (!await confirm(`นำหุ่นยนต์ ${robot.serialNumber} ออกจากลูกค้านี้?`, { title: 'ยืนยันการนำออก', danger: true, confirmLabel: 'นำออก' })) return;
    await updateRobot(robot.id, {
      customerId: undefined,
      status: robot.status === 'Assigned' ? 'In Stock' : robot.status,
    });
  };

  const handleDeleteRobot = async (robotId: string) => {
    const robot = robots.find(item => item.id === robotId);
    if (!robot) return;
    if (!await confirm(`ลบหุ่นยนต์ ${robot.serialNumber} ออกจากระบบ?`, { title: 'ยืนยันการลบหุ่นยนต์', danger: true, confirmLabel: 'ลบ' })) return;
    await deleteRobot(robot.id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormSaving(true);
    try {
      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, formData);
      } else {
        await addCustomer(formData);
      }
      setIsModalOpen(false);
    } finally {
      setFormSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!await confirm('ลบข้อมูลลูกค้านี้?', { title: 'ยืนยันการลบ', danger: true, confirmLabel: 'ลบ' })) return;
    await deleteCustomer(id);
  };

  const exportCSV = () => {
    const header = ['ชื่อบริษัท', 'ผู้ติดต่อ', 'อีเมล', 'โทรศัพท์', 'ที่อยู่', 'รหัสร้าน Pudu'];
    const rows = filtered.map(c => [
      `"${c.name.replace(/"/g, '""')}"`,
      `"${(c.contactPerson || '').replace(/"/g, '""')}"`,
      c.email || '',
      c.phone || '',
      `"${(c.address || '').replace(/"/g, '""')}"`,
      c.puduShopId || '',
    ]);
    const csv = [header, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `customers-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filtered = useMemo(() => customers.filter(c => {
    const typeMatch = (c.type || 'customer') === tab;
    const searchMatch = !search ||
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.contactPerson.toLowerCase().includes(search.toLowerCase()) ||
      (c.agentCode || '').toLowerCase().includes(search.toLowerCase());
    return typeMatch && searchMatch;
  }), [customers, search, tab]);
  const robotCountByCustomerId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const robot of robots) {
      if (!robot.customerId) continue;
      counts.set(robot.customerId, (counts.get(robot.customerId) || 0) + 1);
    }
    return counts;
  }, [robots]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  useEffect(() => { setPage(1); }, [search, tab]);
  const sort = useTableSort<typeof filtered[0]>({
    name: c => c.name,
    agentCode: c => c.agentCode || '',
    contactPerson: c => c.contactPerson,
    phone: c => (c.phone === '-' ? '' : c.phone),
    robots: c => robotCountByCustomerId.get(c.id) || 0,
  });
  const paginated = sort.apply(filtered).slice((page - 1) * pageSize, page * pageSize);
  const showContact = hasPopulatedColumn(paginated, c => c.contactPerson);
  const showPhone = hasPopulatedColumn(paginated, c => c.phone);

  return (
    <div className="page-container">
      <PageHeader
        title="ลูกค้าและพันธมิตร"
        subtitle={tab === 'agent' ? `กำลังแสดงตัวแทน ${filtered.length} รายการ` : `กำลังแสดงลูกค้า ${filtered.length} รายการ`}
        meta={<div className="responsive-action-group" style={{ gap: '0.25rem', background: 'var(--surface-2)', borderRadius: 8, padding: '0.2rem' }}>
          <button
            onClick={() => setTab('customer')}
            style={{ padding: '0.35rem 0.85rem', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit',
              background: tab === 'customer' ? 'var(--accent-primary)' : 'transparent',
              color: tab === 'customer' ? 'var(--text-on-accent)' : 'var(--text-muted)' }}
          >
            ลูกค้า
          </button>
          <button
            onClick={() => setTab('agent')}
            style={{ padding: '0.35rem 0.85rem', borderRadius: 6, border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600, fontFamily: 'inherit',
              background: tab === 'agent' ? 'var(--accent-primary)' : 'transparent',
              color: tab === 'agent' ? 'var(--text-on-accent)' : 'var(--text-muted)' }}
          >
            <Users size={13} style={{ marginRight: 4, verticalAlign: -2 }} />ตัวแทน
          </button>
        </div>}
        actions={<div className="responsive-action-group" style={{ gap: '0.75rem' }}>
          <div className="responsive-toolbar-search">
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input aria-label="ค้นหาลูกค้า"
              className="form-control"
              style={{ paddingLeft: '2rem', paddingRight: search ? '2rem' : undefined }}
              placeholder={tab === 'agent' ? 'ค้นหาตัวแทน...' : 'ค้นหาชื่อ...'}
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label={tab === 'agent' ? 'ล้างคำค้นหาตัวแทน' : 'ล้างคำค้นหาลูกค้า'}
                title="ล้างคำค้นหา"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', border: 'none', background: 'transparent', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 2, color: 'var(--text-muted)', cursor: 'pointer' }}
              >
                <X size={14} />
              </button>
            )}
          </div>
          {isAdmin && tab === 'agent' && (
            <button className="btn btn-outline" onClick={openAgentImport} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <FileSpreadsheet size={15}/> นำเข้าตัวแทน
            </button>
          )}
          {isAdmin && (
            <button className="btn btn-primary" onClick={() => openForm()}>
              <Plus size={16}/> {tab === 'agent' ? 'เพิ่มตัวแทน' : 'เพิ่มลูกค้า'}
            </button>
          )}
          <button className="btn btn-outline" onClick={exportCSV} title="ส่งออก CSV">
            <Download size={15}/> CSV
          </button>
        </div>}
      />

      <div className="card">
        <div className="table-container table-responsive-cards">
          <table>
            <thead>
              <tr>
                <SortableTh {...sort.th('name')}>{tab === 'agent' ? 'ชื่อตัวแทน' : 'บริษัท / ชื่อลูกค้า'}</SortableTh>
                {tab === 'agent' && <SortableTh {...sort.th('agentCode')}>รหัสตัวแทน</SortableTh>}
                {showContact && <SortableTh {...sort.th('contactPerson')}>ผู้ติดต่อ</SortableTh>}
                {showPhone && <SortableTh {...sort.th('phone')}>โทรศัพท์</SortableTh>}
                <SortableTh {...sort.th('robots')}>หุ่นยนต์</SortableTh>
                <th>{tab === 'agent' ? 'สถานะ' : 'แหล่งข้อมูล'}</th>
                <th>การดำเนินการ</th>
              </tr>
            </thead>
            <tbody>
              {paginated.map(customer => {
                const assignedCount = robotCountByCustomerId.get(customer.id) || 0;
                return (
                  <tr key={customer.id}>
                    <td data-label={tab === 'agent' ? 'ชื่อตัวแทน' : 'บริษัท / ชื่อลูกค้า'} style={{ fontWeight: 600 }}>
                      <button
                        onClick={() => setSelectedCustomer(customer)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent-primary)', fontWeight: 600, fontSize: 'inherit', textAlign: 'left' }}
                      >
                        {customer.name}
                      </button>
                    </td>
                    {tab === 'agent' && (
                      <td data-label="รหัสตัวแทน">
                        {customer.agentCode ? (
                          <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.82rem', background: 'var(--accent-subtle)', color: 'var(--accent-primary)', padding: '0.15rem 0.45rem', borderRadius: 4 }}>{customer.agentCode}</span>
                        ) : <span className="text-muted">–</span>}
                      </td>
                    )}
                    {showContact && <td data-label="ผู้ติดต่อ">{customer.contactPerson}</td>}
                    {showPhone && <td data-label="โทรศัพท์">{customer.phone === '-' ? <span className="text-muted">–</span> : customer.phone}</td>}
                    <td data-label="หุ่นยนต์">
                      <button
                        onClick={() => setSelectedCustomer(customer)}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        <span className="badge info" style={{ cursor: 'pointer' }}>{assignedCount} เครื่อง</span>
                      </button>
                    </td>
                    <td data-label={tab === 'agent' ? 'สถานะ' : 'แหล่งข้อมูล'}>
                      {tab === 'agent'
                        ? <span className="badge" style={{ background: 'var(--status-success-bg)', color: 'var(--status-success)', fontSize: '0.7rem' }}>ใช้งานอยู่</span>
                        : <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: '0.7rem' }}>กรอกเอง</span>
                      }
                    </td>
                    <td data-label="การดำเนินการ">
                      <div className="responsive-table-actions" style={{ justifyContent: 'flex-start' }}>
                        {isAdmin && (
                          <>
                            <button className="btn btn-outline" style={{ padding: '0.25rem 0.5rem' }} onClick={() => openForm(customer)} aria-label={`แก้ไข ${customer.name}`} title={`แก้ไข ${customer.name}`}>
                              <Edit2 size={14}/>
                            </button>
                            <button className="btn" style={{ padding: '0.25rem 0.5rem', color: 'var(--status-danger)' }} onClick={() => handleDelete(customer.id)} aria-label={`ลบ ${customer.name}`} title={`ลบ ${customer.name}`}>
                              <Trash2 size={14}/>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
              {loading && customers.length === 0 && <TableSkeleton cols={tab === 'agent' ? 7 : 6} />}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={tab === 'agent' ? 7 : 6} style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    {tab === 'agent' ? 'ไม่พบตัวแทน' : 'ไม่พบลูกค้า'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPageChange={setPage} onPageSizeChange={setPageSize} />
      </div>

      {/* Customer Robot Detail Drawer */}
      {selectedCustomer && (() => {
        const custRobots = robots.filter(r => r.customerId === selectedCustomer.id);
        const statusColor: Record<string, string> = {
          'In Stock': 'var(--status-success)',
          'Assigned': 'var(--accent-primary)',
          'In Maintenance': 'var(--status-warning)',
        };
        const statusBg: Record<string, string> = {
          'In Stock': 'var(--status-success-bg)',
          'Assigned': 'rgba(59,130,246,0.12)',
          'In Maintenance': 'var(--status-warning-bg)',
        };
        const inMaintCount = custRobots.filter(r => r.status === 'In Maintenance').length;
        const drawerSectionStyle: React.CSSProperties = {
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-color)',
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: 'var(--shadow-sm)',
        };
        return (
          <BodyPortal>
          <div
            style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15,30,80,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 1100 }}
            onClick={() => setSelectedCustomer(null)}
          >
            <div
              className="detail-sheet"
              style={{ width: '600px', maxWidth: '96vw', maxHeight: '88vh', backgroundColor: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(30,58,138,0.2)', overflowY: 'auto', borderRadius: 12, border: '1px solid var(--border-color)' }}
              onClick={e => e.stopPropagation()}
            >
              {/* Drawer Header */}
              <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.3rem' }}>
                    <span>ลูกค้า</span>
                    <ChevronRight size={12} />
                    <span>หุ่นยนต์</span>
                  </div>
                  <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>{selectedCustomer.name}</h2>
                  <p className="text-muted" style={{ fontSize: '0.82rem', marginTop: '0.2rem', marginBottom: 0 }}>
                    {selectedCustomer.contactPerson}
                    {selectedCustomer.phone && selectedCustomer.phone !== '-' && ` · ${selectedCustomer.phone}`}
                    {selectedCustomer.address && <><br />{selectedCustomer.address}</>}
                  </p>
                </div>
                <button className="btn btn-ghost" style={{ padding: '0.3rem' }} onClick={() => setSelectedCustomer(null)} aria-label="ปิดรายละเอียดลูกค้า" title="ปิดรายละเอียดลูกค้า">
                  <X size={18} />
                </button>
              </div>

              <div style={{ padding: '1rem', background: 'var(--bg-primary)', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                {/* Summary bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem' }}>
                  <div style={{ ...drawerSectionStyle, padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                      <Bot size={14} color="var(--accent-primary)" />
                      <span>หุ่นยนต์ทั้งหมด</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>{custRobots.length}</div>
                  </div>
                  <div style={{ ...drawerSectionStyle, padding: '0.85rem 1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', color: 'var(--text-muted)', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
                      <Wrench size={14} color="var(--status-warning)" />
                      <span>ซ่อมบำรุง</span>
                    </div>
                    <div style={{ fontWeight: 700, fontSize: '1.2rem', color: inMaintCount > 0 ? 'var(--status-warning)' : 'var(--text-primary)' }}>{inMaintCount}</div>
                  </div>
                </div>

                {/* Robot list */}
                <div style={drawerSectionStyle}>
                  <div style={{ padding: '0.9rem 1rem 0.65rem', borderBottom: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.2rem' }}>
                      <Bot size={15} color="var(--accent-primary)" />
                      <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>หุ่นยนต์ของลูกค้า</span>
                    </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>ดูสถานะ, serial number, ประกัน, และประวัติซ่อมของหุ่นยนต์แต่ละตัว</div>
                  </div>
                  {isAdmin && (
                    <div style={{ padding: '0 1rem 1rem' }}>
                      <button className="btn btn-primary" onClick={openRobotModal} disabled={models.length === 0 && availableRobots.length === 0}>
                        <Plus size={15} /> เพิ่มหุ่นยนต์
                      </button>
                    </div>
                  )}
                  <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
                {custRobots.length === 0 ? (
                  <div className="empty-state" style={{ padding: '3rem 1rem' }}>
                    <Bot size={36} style={{ opacity: 0.25, marginBottom: '0.6rem' }} />
                    <p>ยังไม่มีหุ่นยนต์ที่ assign ให้ลูกค้านี้</p>
                  </div>
                ) : custRobots.map(robot => {
                  const model = models.find(m => m.id === robot.modelId);
                  const robotTickets = tickets.filter(t => t.robotId === robot.id);
                  const activeTickets = robotTickets.filter(t => t.status !== 'Completed');
                  const lastTicket = robotTickets.sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0];
                  const unitPartState = robotParts[robot.id];
                  const isWarrantyExpired = robot.warrantyExpiresAt ? new Date(robot.warrantyExpiresAt) < new Date() : false;
                  const warrantyDaysLeft = robot.warrantyExpiresAt
                    ? Math.ceil((new Date(robot.warrantyExpiresAt).getTime() - Date.now()) / 86400000)
                    : null;

                  return (
                    <div
                      key={robot.id}
                      style={{
                        backgroundColor: 'var(--bg-primary)',
                        border: `1px solid ${robot.status === 'In Maintenance' ? 'rgba(245,158,11,0.4)' : 'var(--border-color)'}`,
                        borderRadius: 'var(--radius-md)',
                        overflow: 'hidden',
                      }}
                    >
                      {/* Card top: image + title + status */}
                      <div style={{ display: 'flex', gap: '0.85rem', padding: '0.9rem 1rem 0.75rem' }}>
                        {model?.imageUrl ? (
                          <img src={model.imageUrl} alt={model.name} style={{ width: 60, height: 60, objectFit: 'contain', borderRadius: 8, flexShrink: 0, background: 'var(--bg-secondary)', padding: '4px' }} />
                        ) : (
                          <div style={{ width: 60, height: 60, borderRadius: 8, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <Bot size={26} color="var(--text-muted)" />
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.2rem' }}>
                            <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{model?.name || 'ไม่ทราบรุ่น'}</span>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                              <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.2rem 0.55rem', borderRadius: 999, backgroundColor: statusBg[robot.status] || 'var(--surface-2)', color: statusColor[robot.status] || 'var(--text-muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                {robot.status === 'In Stock' ? 'ในคลัง' : robot.status === 'Assigned' ? 'ติดตั้งแล้ว' : robot.status === 'Missing' ? 'สูญหาย' : 'ซ่อมบำรุง'}
                              </span>
                              {isAdmin && (
                                <>
                                  <button className="btn btn-outline" style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem' }} onClick={() => handleDetachRobot(robot.id)}>
                                    เอาออก
                                  </button>
                                  <button className="btn" style={{ padding: '0.2rem 0.45rem', fontSize: '0.72rem', color: 'var(--status-danger)' }} onClick={() => handleDeleteRobot(robot.id)}>
                                    <Trash2 size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                          {model?.type && (
                            <div className="text-muted" style={{ fontSize: '0.78rem', marginBottom: '0.2rem' }}>{model.type}</div>
                          )}
                          <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8rem', color: 'var(--text-secondary)', letterSpacing: '0.03em' }}>SN: {robot.serialNumber}</div>
                        </div>
                      </div>

                      {/* Divider */}
                      <div style={{ height: 1, backgroundColor: 'var(--border-color)', margin: '0 1rem' }} />

                      {/* Detail grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem 1rem', padding: '0.75rem 1rem' }}>
                        <div>
                          <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <CalendarClock size={11} /> รับเข้า
                          </div>
                          <div style={{ fontSize: '0.83rem', fontWeight: 500 }}>{robot.purchaseDate || '–'}</div>
                        </div>
                        <div>
                          <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                            <ShieldCheck size={11} /> ประกัน
                          </div>
                          {robot.warrantyExpiresAt ? (
                            <div style={{ fontSize: '0.83rem', fontWeight: 500, color: isWarrantyExpired ? 'var(--status-danger)' : warrantyDaysLeft! <= 90 ? 'var(--status-warning)' : 'inherit' }}>
                              {robot.warrantyExpiresAt}
                              <span style={{ fontSize: '0.72rem', marginLeft: '0.3rem', opacity: 0.75 }}>
                                {isWarrantyExpired ? '(หมดแล้ว)' : `(${warrantyDaysLeft} วัน)`}
                              </span>
                            </div>
                          ) : <div style={{ fontSize: '0.83rem' }} className="text-muted">–</div>}
                        </div>
                        {robot.puduMac && (
                          <div>
                            <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Wifi size={11} /> MAC Address
                            </div>
                            <div style={{ fontSize: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>{robot.puduMac}</div>
                          </div>
                        )}
                        {model?.payloadCapacity && (
                          <div>
                            <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Weight size={11} /> รับน้ำหนัก
                            </div>
                            <div style={{ fontSize: '0.83rem', fontWeight: 500 }}>{model.payloadCapacity}</div>
                          </div>
                        )}
                        {model?.batteryLife && (
                          <div>
                            <div className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                              <Battery size={11} /> แบตเตอรี่
                            </div>
                            <div style={{ fontSize: '0.83rem', fontWeight: 500 }}>{model.batteryLife}</div>
                          </div>
                        )}
                      </div>

                      {/* Unit spare parts */}
                      <div style={{ borderTop: '1px solid var(--border-color)', padding: '0.7rem 1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <button className="btn btn-ghost" style={{ padding: '0.25rem 0', fontSize: '0.8rem', fontWeight: 600 }} onClick={() => toggleRobotParts(robot.id)}>
                            <Package size={13} /> อะไหล่ของ Unit {unitPartState && `(${unitPartState.logs.length})`}
                          </button>
                        </div>
                        {expandedRobotId === robot.id && (
                          <div style={{ marginTop: '0.55rem' }}>
                            {unitPartState?.loading ? (
                              <div className="text-muted" style={{ fontSize: '0.78rem' }}>กำลังโหลดอะไหล่...</div>
                            ) : !unitPartState || unitPartState.logs.length === 0 ? (
                              <div className="text-muted" style={{ fontSize: '0.78rem' }}>ยังไม่มีอะไหล่ที่ส่งให้ Unit นี้</div>
                            ) : (
                              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                                {unitPartState.logs.map(log => {
                                  let values: { serialNumbers?: string[]; transferredQty?: number } = {};
                                  try { values = JSON.parse(log.newValues || '{}'); } catch { /* ignore malformed legacy log */ }
                                  const sns = Array.isArray(values.serialNumbers) ? values.serialNumbers : [];
                                  return (
                                    <div key={log.id} style={{ background: 'var(--bg-secondary)', borderRadius: 7, padding: '0.5rem 0.65rem', fontSize: '0.78rem' }}>
                                      <div style={{ fontWeight: 600 }}>{log.entityName || 'อะไหล่ไม่ระบุชื่อ'} <span className="text-muted" style={{ fontWeight: 400 }}>({values.transferredQty || sns.length || 0} ชิ้น)</span></div>
                                      <div className="text-muted" style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.72rem', marginTop: 3 }}>{sns.length ? `SN: ${sns.join(', ')}` : 'ไม่มี SN'}</div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Maintenance summary */}
                      {robotTickets.length > 0 && (
                        <>
                          <div style={{ height: 1, backgroundColor: 'var(--border-color)', margin: '0 1rem' }} />
                          <div style={{ padding: '0.65rem 1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.8rem' }}>
                              <Wrench size={13} color="var(--text-muted)" />
                              <span className="text-muted">ประวัติซ่อมบำรุง:</span>
                              <span style={{ fontWeight: 600 }}>{robotTickets.length} ครั้ง</span>
                              {activeTickets.length > 0 && (
                                <span style={{ fontSize: '0.7rem', fontWeight: 600, padding: '0.1rem 0.45rem', borderRadius: 999, backgroundColor: 'var(--status-warning-bg)', color: 'var(--status-warning)' }}>
                                  {activeTickets.length} active
                                </span>
                              )}
                            </div>
                            {lastTicket && (
                              <span className="text-muted" style={{ fontSize: '0.72rem' }}>ล่าสุด: {lastTicket.reportDate}</span>
                            )}
                          </div>
                        </>
                      )}

                      {/* Notes */}
                      {robot.notes && (
                        <>
                          <div style={{ height: 1, backgroundColor: 'var(--border-color)', margin: '0 1rem' }} />
                          <div style={{ padding: '0.6rem 1rem', display: 'flex', gap: '0.4rem', alignItems: 'flex-start' }}>
                            <StickyNote size={13} color="var(--text-muted)" style={{ marginTop: '0.15rem', flexShrink: 0 }} />
                            <span className="text-muted" style={{ fontSize: '0.8rem', lineHeight: 1.5 }}>{robot.notes}</span>
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
                  </div>
                </div>

              {/* Customer Spare Parts */}
              <div style={drawerSectionStyle}>
                <div style={{ padding: '0.9rem 1.5rem 0.5rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Package size={14} color="var(--accent-primary)" />
                    <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>อะไหล่</span>
                    {partHistory.logs.length > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.1rem 0.5rem', borderRadius: 999, background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>{partHistory.logs.length} รายการ</span>}
                  </div>
                  {isAdmin && <button className="btn btn-primary" style={{ padding: '0.3rem 0.55rem', fontSize: '0.75rem' }} onClick={openAddPartForCustomer}><Plus size={13} /> เพิ่มอะไหล่</button>}
                </div>
                {partHistory.loading ? (
                  <div style={{ padding: '1rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>กำลังโหลด…</div>
                ) : partHistory.logs.length === 0 ? (
                  <div style={{ padding: '0.75rem 1.5rem 1.25rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>ยังไม่มีอะไหล่ของลูกค้านี้</div>
                ) : (
                  <div style={{ overflowX: 'auto', paddingBottom: '1rem' }}>
                    <table style={{ fontSize: '0.8rem' }}>
                      <thead>
                        <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <th style={{ textAlign: 'left', padding: '0.4rem 1.5rem', color: 'var(--text-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>วันที่</th>
                          <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>ชื่ออะไหล่</th>
                          <th style={{ textAlign: 'center', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>จำนวน</th>
                          <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>SN</th>
                          <th style={{ textAlign: 'left', padding: '0.4rem 0.5rem', color: 'var(--text-muted)', fontWeight: 600 }}>หมายเหตุ</th>
                          <th style={{ textAlign: 'left', padding: '0.4rem 1rem', color: 'var(--text-muted)', fontWeight: 600 }}>โดย</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partHistory.logs.map(log => {
                          const nv = (() => { try { return JSON.parse(log.newValues || '{}'); } catch { return {}; } })();
                          const ov = (() => { try { return JSON.parse(log.oldValues || '{}'); } catch { return {}; } })();
                          const displaySerialNumbers = Array.isArray(nv.serialNumbers) ? nv.serialNumbers : (ov.serialNumber ? [ov.serialNumber] : []);
                          const dateStr = log.performedAt ? formatThaiDate(log.performedAt, { year: '2-digit', month: 'short', day: 'numeric' }) : '–';
                          return (
                            <tr key={log.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                              <td style={{ padding: '0.45rem 1.5rem', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{dateStr}</td>
                              <td style={{ padding: '0.45rem 0.5rem', fontWeight: 500 }}>{log.entityName || '–'}</td>
                              <td style={{ padding: '0.45rem 0.5rem', textAlign: 'center' }}>
                                <span style={{ fontWeight: 700, color: 'var(--accent-primary)' }}>{nv.transferredQty ?? (displaySerialNumbers.length || 1)}</span>
                              </td>
                              <td style={{ padding: '0.45rem 0.5rem', fontVariantNumeric: 'tabular-nums', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                                {displaySerialNumbers.length ? displaySerialNumbers.join(', ') : '–'}
                              </td>
                              <td style={{ padding: '0.45rem 0.5rem', color: 'var(--text-muted)', maxWidth: 140, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nv.note || '–'}</td>
                              <td style={{ padding: '0.45rem 1rem', color: 'var(--text-muted)' }}>{log.performedBy || '–'}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Contacts & Sites */}
              <div style={drawerSectionStyle}>
                <div style={{ padding: '0.9rem 1.5rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <Users size={14} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>ผู้ติดต่อ</span>
                  {sectionError('contacts')}
                  {contacts.length > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.1rem 0.5rem', borderRadius: 999, background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>{contacts.length}</span>}
                </div>
                {contactsLoading ? (
                  <div style={{ padding: '0.75rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>กำลังโหลด…</div>
                ) : sectionErrors.contacts && contacts.length === 0 ? null : contacts.length === 0 ? (
                  <div style={{ padding: '0.5rem 1.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>ยังไม่มีผู้ติดต่อ</div>
                ) : (
                  <div style={{ padding: '0 1.25rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {contacts.map(c => (
                      <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.4rem 0.5rem', background: 'var(--bg-primary)', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: '0.82rem' }}>
                        <div>
                          <span style={{ fontWeight: 600 }}>{c.name}</span>
                          {c.isPrimary && <span style={{ marginLeft: 6, fontSize: '0.7rem', padding: '1px 5px', borderRadius: 4, background: 'var(--status-success-bg)', color: 'var(--status-success)' }}>หลัก</span>}
                          {c.role && <span style={{ color: 'var(--text-muted)', marginLeft: 6, fontSize: '0.78rem' }}>{c.role}</span>}
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem', textAlign: 'right' }}>
                          {c.phone && <div>{c.phone}</div>}
                          {c.email && <div>{c.email}</div>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div style={{ padding: '0.5rem 1.5rem 0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <MapPin size={14} color="var(--accent-primary)" />
                  <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>สถานที่ติดตั้ง</span>
                  {sectionError('sites')}
                  {sites.length > 0 && <span style={{ fontSize: '0.72rem', fontWeight: 600, padding: '0.1rem 0.5rem', borderRadius: 999, background: 'var(--accent-subtle)', color: 'var(--accent-primary)' }}>{sites.length}</span>}
                </div>
                {contactsLoading ? (
                  <div style={{ padding: '0.75rem 1.5rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>กำลังโหลด…</div>
                ) : sectionErrors.sites && sites.length === 0 ? null : sites.length === 0 ? (
                  <div style={{ padding: '0.5rem 1.5rem 0.75rem', color: 'var(--text-muted)', fontSize: '0.82rem' }}>ยังไม่มีสถานที่</div>
                ) : (
                  <div style={{ padding: '0 1.25rem 0.75rem', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                    {sites.map(s => (
                      <div key={s.id} style={{ padding: '0.4rem 0.5rem', background: 'var(--bg-primary)', borderRadius: 6, border: '1px solid var(--border-color)', fontSize: '0.82rem' }}>
                        <div style={{ fontWeight: 600 }}>{s.name}</div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{s.address}{s.province && ` · ${s.province}`}</div>
                        {s.notes && <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: 2 }}>{s.notes}</div>}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Linked records from other modules */}
              {sectionError('surveys')}
              {sectionError('claims')}
              {(linkedSurveys.length > 0 || linkedClaims.length > 0) && (
                <div style={{ ...drawerSectionStyle, padding: '0.9rem 1.5rem', fontSize: '0.82rem', display: 'grid', gap: '0.5rem' }}>
                  {linkedSurveys.length > 0 && (
                    <div>
                      <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 4 }}>แบบสำรวจหน้างาน ({linkedSurveys.length})</div>
                      {linkedSurveys.map(s => (
                        <div key={s.id} style={{ color: 'var(--text-muted)' }}>
                          {s.formType === 'cleaning' ? 'หุ่นทำความสะอาด' : 'AMR'} · {s.siteName}{s.surveyDate ? ` · ${s.surveyDate}` : ''}
                        </div>
                      ))}
                    </div>
                  )}
                  {linkedClaims.length > 0 && (() => {
                    const active = linkedClaims.filter(c => c.status !== 'Cancelled');
                    const sum = (key: 'totalAdvance' | 'totalReimbursed') => active.reduce((n, c) => n + (Number(c[key]) || 0), 0);
                    const baht = (n: number) => `฿${n.toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;
                    return (
                      <div>
                        <div style={{ fontWeight: 600, fontSize: '0.88rem', marginBottom: 4 }}>ค่าเดินทางที่ผูกกับลูกค้านี้</div>
                        <div style={{ color: 'var(--text-muted)' }}>
                          {active.length} ใบ · เงินยืมทดรอง {baht(sum('totalAdvance'))} · เบิกจ่าย {baht(sum('totalReimbursed'))}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* Portal Token */}
              {isAdmin && (
                <div style={{ ...drawerSectionStyle, padding: '0.9rem 1.5rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                    <Link2 size={14} color="var(--accent-primary)" />
                    <span style={{ fontWeight: 600, fontSize: '0.88rem' }}>พอร์ทัลลูกค้า</span>
                  </div>
                  {portalToken ? (
                    <div style={{ fontSize: '0.82rem' }}>
                      <div style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.78rem', background: 'var(--bg-primary)', padding: '0.4rem 0.6rem', borderRadius: 6, border: '1px solid var(--border-color)', wordBreak: 'break-all' }}>
                        {window.location.origin}/portal/{portalToken}
                      </div>
                      <button
                        className="btn btn-outline"
                        style={{ marginTop: '0.4rem', fontSize: '0.78rem', padding: '0.25rem 0.5rem' }}
                        onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/portal/${portalToken}`); showToast('คัดลอกลิงก์แล้ว', 'success'); }}
                      >คัดลอกลิงก์</button>
                    </div>
                  ) : (
                    <button
                      className="btn btn-outline"
                      style={{ fontSize: '0.82rem', padding: '0.3rem 0.6rem' }}
                      disabled={portalGenerating}
                      onClick={generatePortalToken}
                    >{portalGenerating ? 'กำลังสร้าง...' : 'สร้างลิงก์พอร์ทัล'}</button>
                  )}
                </div>
              )}
              </div>
            </div>
          </div>
          </BodyPortal>
        );
      })()}

      {isModalOpen && (
        <Modal open={isModalOpen} onClose={() => setIsModalOpen(false)} title={editingCustomer ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้า'} width={400} describedById="customer-form-description">
            <p id="customer-form-description" style={{ marginTop: 0, marginBottom: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              กรอกข้อมูลบริษัท ผู้ติดต่อ อีเมล เบอร์โทร และที่อยู่ของลูกค้าหรือตัวแทนในระบบ
            </p>
            <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '0.5rem' }}>
              <div>
                <label className="form-label" htmlFor="cust-name">บริษัท / ชื่อลูกค้า</label>
                <input id="cust-name" required className="form-control" type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="cust-contact">ผู้ติดต่อ</label>
                <input id="cust-contact" required className="form-control" type="text" value={formData.contactPerson} onChange={e => setFormData({...formData, contactPerson: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="cust-email">อีเมล</label>
                <input id="cust-email" required className="form-control" type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="cust-phone">โทรศัพท์</label>
                <input id="cust-phone" required className="form-control" type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} />
              </div>
              <div>
                <label className="form-label" htmlFor="cust-address">ที่อยู่</label>
                <textarea id="cust-address" required className="form-control" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} />
              </div>
              <div className="responsive-action-group" style={{ justifyContent: 'flex-end', marginTop: '0.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setIsModalOpen(false)}>ยกเลิก</button>
                <FormSubmitButton loading={formSaving}>{editingCustomer ? 'บันทึกการแก้ไข' : 'สร้าง'}</FormSubmitButton>
              </div>
            </form>
        </Modal>
      )}

      {selectedCustomer && (
        <Modal
          open={isRobotModalOpen}
          onClose={closeRobotModal}
          title={`จัดการหุ่นยนต์: ${selectedCustomer.name}`}
          width={520}
          preventClose={robotSaving}
          describedById="customer-robot-form-description"
        >
          <p id="customer-robot-form-description" style={{ marginTop: 0, marginBottom: '0.85rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
            เพิ่มหุ่นยนต์ใหม่เข้าระบบแล้วผูกกับลูกค้าทันที หรือเลือกหุ่นยนต์ที่ยังไม่ผูกกับลูกค้ารายใดมาเพิ่มให้ลูกค้านี้
          </p>
          <div style={{ display: 'flex', gap: '0.4rem', background: 'var(--surface-2)', borderRadius: 8, padding: '0.25rem', marginBottom: '1rem' }}>
            <button
              type="button"
              onClick={() => setRobotMode('new')}
              style={{ flex: 1, padding: '0.45rem 0.75rem', borderRadius: 6, border: 'none', cursor: 'pointer', background: robotMode === 'new' ? 'var(--accent-primary)' : 'transparent', color: robotMode === 'new' ? 'var(--text-on-accent)' : 'var(--text-muted)', fontWeight: 600, fontFamily: 'inherit' }}
            >
              เพิ่มใหม่
            </button>
            <button
              type="button"
              onClick={() => setRobotMode('existing')}
              style={{ flex: 1, padding: '0.45rem 0.75rem', borderRadius: 6, border: 'none', cursor: 'pointer', background: robotMode === 'existing' ? 'var(--accent-primary)' : 'transparent', color: robotMode === 'existing' ? 'var(--text-on-accent)' : 'var(--text-muted)', fontWeight: 600, fontFamily: 'inherit' }}
            >
              เพิ่มจากในระบบ
            </button>
          </div>

          <form onSubmit={handleAddRobotToCustomer} style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {robotMode === 'existing' ? (
              <div>
                <label className="form-label" htmlFor="customer-existing-robot">เลือกหุ่นยนต์</label>
                <select
                  id="customer-existing-robot"
                  className="form-control"
                  value={robotForm.existingRobotId}
                  onChange={e => setRobotForm(prev => ({ ...prev, existingRobotId: e.target.value }))}
                >
                  {availableRobots.length === 0 ? (
                    <option value="">ไม่มีหุ่นยนต์ว่างในระบบ</option>
                  ) : (
                    <>
                      <option value="">เลือกหุ่นยนต์</option>
                      {availableRobots.map(robot => (
                        <option key={robot.id} value={robot.id}>
                          {robot.serialNumber} - {modelById.get(robot.modelId)?.name || 'ไม่ทราบรุ่น'} ({robot.status === 'In Stock' ? 'ในคลัง' : robot.status === 'Assigned' ? 'ติดตั้งแล้ว' : robot.status === 'Missing' ? 'สูญหาย' : 'ซ่อมบำรุง'})
                        </option>
                      ))}
                    </>
                  )}
                </select>
                {robotFormErrors.existingRobotId && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{robotFormErrors.existingRobotId}</div>}
              </div>
            ) : (
              <>
                <div>
                  <label className="form-label" htmlFor="customer-robot-serial">หมายเลขซีเรียล (SN)</label>
                  <input
                    id="customer-robot-serial"
                    className="form-control"
                    value={robotForm.serialNumber}
                    onChange={e => setRobotForm(prev => ({ ...prev, serialNumber: e.target.value }))}
                  />
                  {robotFormErrors.serialNumber && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{robotFormErrors.serialNumber}</div>}
                </div>
                <div>
                  <label className="form-label" htmlFor="customer-robot-model">รุ่นหุ่นยนต์</label>
                  <select
                    id="customer-robot-model"
                    className="form-control"
                    value={robotForm.modelId}
                    onChange={e => setRobotForm(prev => ({ ...prev, modelId: e.target.value }))}
                  >
                    <option value="">เลือกรุ่นหุ่นยนต์</option>
                    {models.map(model => (
                      <option key={model.id} value={model.id}>{model.name}</option>
                    ))}
                  </select>
                  {robotFormErrors.modelId && <div style={{ color: 'var(--status-danger)', fontSize: 11, marginTop: 3 }}>{robotFormErrors.modelId}</div>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                  <div>
                    <label className="form-label" htmlFor="customer-robot-purchase-date">วันที่ซื้อ</label>
                    <ThaiDateInput
                      id="customer-robot-purchase-date"
                      className="form-control"
                      value={robotForm.purchaseDate}
                      onChange={e => setRobotForm(prev => ({ ...prev, purchaseDate: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="form-label" htmlFor="customer-robot-warranty">วันหมดประกัน</label>
                    <ThaiDateInput
                      id="customer-robot-warranty"
                      className="form-control"
                      value={robotForm.warrantyExpiresAt}
                      onChange={e => setRobotForm(prev => ({ ...prev, warrantyExpiresAt: e.target.value }))}
                    />
                  </div>
                </div>
                <div>
                  <label className="form-label" htmlFor="customer-robot-notes">หมายเหตุ</label>
                  <textarea
                    id="customer-robot-notes"
                    className="form-control"
                    rows={3}
                    value={robotForm.notes}
                    onChange={e => setRobotForm(prev => ({ ...prev, notes: e.target.value }))}
                  />
                </div>
              </>
            )}

            <div className="responsive-action-group" style={{ justifyContent: 'flex-end', marginTop: '0.25rem' }}>
              <button type="button" className="btn btn-outline" onClick={closeRobotModal}>ยกเลิก</button>
              <FormSubmitButton loading={robotSaving} disabled={robotMode === 'existing' && availableRobots.length === 0}>
                {robotMode === 'existing' ? 'เพิ่มหุ่นยนต์ให้ลูกค้า' : 'สร้างและเพิ่มหุ่นยนต์'}
              </FormSubmitButton>
            </div>
          </form>
        </Modal>
      )}

      {selectedCustomer && addPartOpen && (
        <Modal open={addPartOpen} onClose={() => !addPartLoading && setAddPartOpen(false)} title={`เพิ่มอะไหล่ให้ลูกค้า ${selectedCustomer.name}`} width={520} preventClose={addPartLoading}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
            <div className="text-muted" style={{ fontSize: '0.82rem' }}>รายการนี้จะถูกผูกกับลูกค้าโดยรวม ไม่ได้ระบุ Unit</div>
            <div>
              <label className="form-label" htmlFor="customer-unit-part">อะไหล่ <span style={{ color: 'var(--status-danger)' }}>*</span></label>
              <select id="customer-unit-part" className="form-control" value={addPartForm.partId} onChange={e => void handleAddPartSelection(e.target.value)}>
                <option value="">— เลือกอะไหล่ —</option>
                {sparePartCatalog.filter(part => part.stock > 0).map(part => <option key={part.id} value={part.id}>{part.sku} · {part.name} (เหลือ {part.stock})</option>)}
              </select>
            </div>
            {addPartItemsLoading ? (
              <div className="text-muted" style={{ fontSize: '0.82rem' }}>กำลังโหลดรายการ SN...</div>
            ) : addPartItems.length > 0 ? (
              <div>
                <span id="customers-sn-label" className="form-label">เลือก SN <span style={{ color: 'var(--status-danger)' }}>*</span></span>
                <div role="group" aria-labelledby="customers-sn-label" style={{ maxHeight: 190, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 7 }}>
                  {addPartItems.map(item => {
                    const checked = addPartForm.serialNumbers.includes(item.serialNumber);
                    return <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0.55rem 0.7rem', borderBottom: '1px solid var(--border-color)', cursor: 'pointer' }}>
                      <input type="checkbox" checked={checked} onChange={() => setAddPartForm(prev => ({ ...prev, serialNumbers: checked ? prev.serialNumbers.filter(sn => sn !== item.serialNumber) : [...prev.serialNumbers, item.serialNumber] }))} />
                      <span style={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>{item.serialNumber}</span>
                      <span className="text-muted" style={{ marginLeft: 'auto', fontSize: 11 }}>{item.receivedDate}</span>
                    </label>;
                  })}
                </div>
                <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>เลือกแล้ว {addPartForm.serialNumbers.length} ชิ้น</div>
              </div>
            ) : addPartForm.partId ? (
              <div>
                <label className="form-label" htmlFor="customer-unit-part-quantity">จำนวน (ชิ้น)</label>
                <input id="customer-unit-part-quantity" className="form-control" type="number" min={1} value={addPartForm.quantity} onChange={e => setAddPartForm(prev => ({ ...prev, quantity: e.target.value }))} />
                <div className="text-muted" style={{ fontSize: 11, marginTop: 3 }}>อะไหล่นี้ไม่มี SN</div>
              </div>
            ) : null}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
              <button className="btn btn-outline" onClick={() => setAddPartOpen(false)} disabled={addPartLoading}>ยกเลิก</button>
              <FormSubmitButton loading={addPartLoading} onClick={handleAddPart} type="button">เพิ่มอะไหล่</FormSubmitButton>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Agent Import Modal ── */}
      <Modal open={agentImportOpen} onClose={() => { if (!agentImportLoading) setAgentImportOpen(false); }} title={<><FileSpreadsheet size={18} color="var(--accent-primary)" /> นำเข้าตัวแทนจาก Excel</>} width={580} preventClose={agentImportLoading} describedById="customer-agent-import-description">

        <p id="customer-agent-import-description" style={{ marginTop: 0, marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
          อัปโหลดไฟล์ Excel ของตัวแทนเพื่อ preview รายการที่จะเพิ่ม อัปเดต หรือรวมข้อมูลก่อนยืนยันนำเข้า
        </p>

            {agentImportStep === 'select' && (
              <div>
                <div
                  onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                  onDrop={e => { e.preventDefault(); e.stopPropagation(); const f = e.dataTransfer.files[0]; if (f) handleAgentFile(f); }}
                  onClick={() => agentFileRef.current?.click()}
                  style={{ border: '2px dashed var(--border-color)', borderRadius: 10, padding: '2.5rem 1rem', textAlign: 'center', cursor: 'pointer', transition: 'border-color 0.2s' }}
                >
                  <Upload size={32} style={{ color: 'var(--text-muted)', marginBottom: '0.5rem' }} />
                  <p style={{ margin: 0, fontWeight: 600, fontSize: '0.9rem' }}>ลากไฟล์ Excel มาวาง หรือ คลิกเพื่อเลือก</p>
                  <p className="text-muted" style={{ margin: '0.3rem 0 0', fontSize: '0.78rem' }}>รองรับ .xlsx, .xls (Agent List จาก Pudu)</p>
                </div>
                <input aria-label="เลือกไฟล์ Excel รายชื่อตัวแทน" ref={agentFileRef} type="file" accept=".xlsx,.xls" hidden onChange={e => { const f = e.target.files?.[0]; if (f) handleAgentFile(f); e.target.value = ''; }} />
                {agentImportLoading && (
                  <div style={{ textAlign: 'center', marginTop: '1rem', fontSize: '0.85rem', color: 'var(--accent-primary)' }}>กำลังวิเคราะห์ไฟล์…</div>
                )}
              </div>
            )}

            {agentImportStep === 'preview' && agentImportPreview && (
              <div>
                <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <div style={{ padding: '0.5rem 0.8rem', borderRadius: 8, background: 'var(--status-success-bg)', fontSize: '0.82rem' }}>
                    <strong style={{ color: 'var(--status-success)' }}>เพิ่มใหม่:</strong> {agentImportPreview.agents?.filter((a: any) => a.action === 'create').length || 0}
                  </div>
                  <div style={{ padding: '0.5rem 0.8rem', borderRadius: 8, background: 'rgba(59,130,246,0.1)', fontSize: '0.82rem' }}>
                    <strong style={{ color: 'var(--accent-primary)' }}>อัปเดต:</strong> {agentImportPreview.agents?.filter((a: any) => a.action === 'update').length || 0}
                  </div>
                  {agentImportPreview.agents?.some((a: any) => a.action === 'merge') && (
                    <div style={{ padding: '0.5rem 0.8rem', borderRadius: 8, background: 'rgba(234,88,12,0.1)', fontSize: '0.82rem' }}>
                      <strong style={{ color: 'var(--status-warning)' }}>รวม (fuzzy):</strong> {agentImportPreview.agents?.filter((a: any) => a.action === 'merge').length || 0}
                    </div>
                  )}
                  <div style={{ padding: '0.5rem 0.8rem', borderRadius: 8, background: 'var(--surface-2)', fontSize: '0.82rem' }}>
                    <strong className="text-muted">ข้าม:</strong> {agentImportPreview.agents?.filter((a: any) => a.action === 'skip').length || 0}
                  </div>
                </div>

                <div className="table-container" style={{ maxHeight: '40vh', overflowY: 'auto', marginBottom: '1rem' }}>
                  <table style={{ fontSize: '0.82rem' }}>
                    <thead>
                      <tr>
                        <th>รหัส</th>
                        <th>ชื่อตัวแทน</th>
                        <th>สถานะ</th>
                        <th>การดำเนินการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {agentImportPreview.agents?.map((a: any, i: number) => (
                        <tr key={i}>
                          <td><code style={{ fontSize: '0.8rem' }}>{a.agentCode || '–'}</code></td>
                          <td style={{ fontWeight: 500 }}>{a.name}</td>
                          <td>{a.status || '–'}</td>
                          <td>
                            {a.action === 'create' && <span className="badge" style={{ background: 'var(--status-success-bg)', color: 'var(--status-success)', fontSize: '0.7rem' }}>เพิ่มใหม่</span>}
                            {a.action === 'update' && <span className="badge" style={{ background: 'rgba(59,130,246,0.12)', color: 'var(--accent-primary)', fontSize: '0.7rem' }}>อัปเดต</span>}
                            {a.action === 'merge' && (
                              <span title={a.reason} style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
                                <span className="badge" style={{ background: 'rgba(234,88,12,0.12)', color: 'var(--status-warning)', fontSize: '0.7rem' }}>รวม (fuzzy)</span>
                                <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)' }}>← {a.matchedName}</span>
                              </span>
                            )}
                            {a.action === 'skip' && <span className="badge" style={{ background: 'var(--surface-2)', color: 'var(--text-muted)', fontSize: '0.7rem' }}>ข้าม (มีอยู่แล้ว)</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="responsive-action-group" style={{ justifyContent: 'flex-end' }}>
                  <button className="btn btn-outline" onClick={() => setAgentImportOpen(false)} disabled={agentImportLoading}>ยกเลิก</button>
                  <button className="btn btn-primary" onClick={handleAgentConfirm} disabled={agentImportLoading} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {agentImportLoading ? 'กำลังนำเข้า…' : <><CheckCircle size={15} /> ยืนยันนำเข้า</>}
                  </button>
                </div>
              </div>
            )}

            {agentImportStep === 'done' && agentImportResult && (
              <div style={{ textAlign: 'center', padding: '1.5rem 0' }}>
                <CheckCircle size={40} color="var(--status-success)" style={{ marginBottom: '0.75rem' }} />
                <p style={{ fontWeight: 700, fontSize: '1.05rem', margin: '0 0 0.5rem' }}>นำเข้าสำเร็จ!</p>
                <p className="text-muted" style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                  เพิ่มใหม่ {agentImportResult.created} รายการ · อัปเดต {agentImportResult.updated} รายการ
                </p>
                <button className="btn btn-primary" onClick={() => setAgentImportOpen(false)}>ปิด</button>
              </div>
            )}
      </Modal>
    </div>
  );
};

export default Customers;
