import React, { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';
import { todayISO } from '../utils/thaiDate';
import api from '../api';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';

export interface RobotModel { id: string; sku?: string; name: string; type: string; payloadCapacity: string; batteryLife: string; imageUrl?: string; puduProductCode?: string; maCategory?: string | null; }
export interface Customer { id: string; name: string; contactPerson: string; email: string; phone: string; address: string; logoUrl?: string; type?: string; agentCode?: string; puduShopId?: string; puduCompanyId?: string; }
export interface Robot { id: string; serialNumber: string; modelId: string; status: 'In Stock' | 'Assigned' | 'In Maintenance' | 'Missing'; customerId?: string; purchaseDate: string; puduMac?: string; locationId?: string; notes?: string; warrantyExpiresAt?: string; archivedAt?: string; }
export interface MaintenanceTicket { id: string; trackingToken?: string; robotId: string; customerId?: string; issueDescription: string; status: 'Pending' | 'Waiting Quotation' | 'In Progress' | 'Ready to Ship' | 'Completed'; reportDate: string; resolution?: string; replacedParts?: string; issueImageUrl?: string; assignedTo?: string; priorityLevel?: string; }
export interface SparePart { id: string; sku: string; name: string; description?: string; category?: string; productModel?: string; partType?: string; location?: string; stock: number; minStock: number; unitPrice: number; supplier?: string; status?: string; sourceFile?: string; sourceSheet?: string; }
export interface SparePartSummary { total: number; outOfStock: number; inStock: number; tracked: number; stockRisk: number; lowStock: Pick<SparePart, 'id' | 'sku' | 'name' | 'stock' | 'minStock'>[]; }

interface DataContextType {
  models: RobotModel[];
  robots: Robot[];
  customers: Customer[];
  tickets: MaintenanceTicket[];
  /** Empty until a page calls useSpareParts() — the full catalog is only loaded where it's needed. */
  spareParts: SparePart[];
  ensureSpareParts: () => void;
  /** Stock counts + low-stock list (always loaded; cheap compared to the full catalog). */
  sparePartSummary: SparePartSummary | null;
  /** true until the first fetchData() settles — lets lists show a skeleton instead of "no data". */
  loading: boolean;
  
  // Models
  addModel: (m: Omit<RobotModel, 'id'>) => Promise<void>;
  updateModel: (id: string, m: Partial<RobotModel>) => Promise<void>;
  deleteModel: (id: string) => Promise<void>;
  
  // Customers
  addCustomer: (c: Omit<Customer, 'id'>) => Promise<void>;
  quickAddCustomer: (name: string) => Promise<Customer>;
  updateCustomer: (id: string, c: Partial<Customer>) => Promise<void>;
  deleteCustomer: (id: string) => Promise<void>;
  
  // Robots
  addRobot: (r: Omit<Robot, 'id'>) => Promise<void>;
  updateRobot: (id: string, r: Partial<Robot>) => Promise<void>;
  deleteRobot: (id: string) => Promise<void>;
  updateRobotStatus: (id: string, status: Robot['status'], customerId?: string) => Promise<void>;
  
  // Tickets
  addTicket: (t: Omit<MaintenanceTicket, 'id' | 'status' | 'reportDate'>) => Promise<void>;
  updateTicket: (id: string, t: Partial<MaintenanceTicket>) => Promise<void>;
  deleteTicket: (id: string) => Promise<void>;
  updateTicketStatus: (id: string, status: MaintenanceTicket['status'], resolution?: string, replacedParts?: string) => Promise<void>;
  
  fetchData: () => Promise<void>;
}

const DataContext = createContext<DataContextType | undefined>(undefined);

export const DataProvider: React.FC<{children: ReactNode}> = ({ children }) => {
  const { isAuthenticated } = useAuth();
  const { showToast } = useToast();
  const [models, setModels] = useState<RobotModel[]>([]);
  const [robots, setRobots] = useState<Robot[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [tickets, setTickets] = useState<MaintenanceTicket[]>([]);
  const [spareParts, setSpareParts] = useState<SparePart[]>([]);
  const [sparePartSummary, setSparePartSummary] = useState<SparePartSummary | null>(null);
  // Set once any page asks for the catalog; from then on fetchData() refreshes it too.
  const sparePartsWanted = useRef(false);
  const [loading, setLoading] = useState(true);

  const sortByName = <T extends { name: string }>(items: T[]) =>
    [...items].sort((left, right) => left.name.localeCompare(right.name));

  const sortBySerial = <T extends { serialNumber: string }>(items: T[]) =>
    [...items].sort((left, right) => left.serialNumber.localeCompare(right.serialNumber));

  const sortByReportDateDesc = <T extends { reportDate: string }>(items: T[]) =>
    [...items].sort((left, right) => right.reportDate.localeCompare(left.reportDate));

  const upsertById = <T extends { id: string }>(items: T[], nextItem: T) => {
    const index = items.findIndex(item => item.id === nextItem.id);
    if (index === -1) return [...items, nextItem];
    return items.map(item => item.id === nextItem.id ? nextItem : item);
  };

  const fetchData = async () => {
    if (!isAuthenticated) { setLoading(false); return; }
    setLoading(true);
    try {
      const [mRes, rRes, cRes, tRes, sumRes, spRes] = await Promise.all([
        api.get('/models'),
        api.get('/robots'),
        api.get('/customers'),
        api.get('/tickets'),
        api.get<SparePartSummary>('/spare-parts/summary'),
        sparePartsWanted.current ? api.get<SparePart[]>('/spare-parts') : Promise.resolve(null),
      ]);
      setModels(mRes.data);
      setRobots(rRes.data);
      setCustomers(cRes.data);
      setTickets(tRes.data);
      setSparePartSummary(sumRes.data);
      if (spRes) setSpareParts(spRes.data);
    } catch (error: any) {
      // Without this the whole app just renders empty on a failed initial load, which
      // reads as "no data" instead of "the server is down / you are rate-limited".
      console.error("Failed to fetch data", error);
      const detail = error?.response?.data?.error || error?.message || '';
      showToast(`โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้าอีกครั้ง${detail ? ` (${detail})` : ''}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [isAuthenticated]);

  const ensureSpareParts = () => {
    if (sparePartsWanted.current || !isAuthenticated) return;
    sparePartsWanted.current = true;
    api.get<SparePart[]>('/spare-parts')
      .then(res => setSpareParts(res.data))
      .catch(() => {
        sparePartsWanted.current = false;
        showToast('โหลดรายการอะไหล่ไม่สำเร็จ', 'error');
      });
  };

  useEffect(() => {
    if (!isAuthenticated) {
      sparePartsWanted.current = false;
      setSpareParts([]);
      setSparePartSummary(null);
    }
  }, [isAuthenticated]);

  const wrap = async (fn: () => Promise<void>, successMsg?: string) => {
    try {
      await fn();
      if (successMsg) showToast(successMsg, 'success');
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'การดำเนินการล้มเหลว';
      showToast(msg, 'error');
      throw e;
    }
  };

  // Models CRUD
  const addModel = async (m: Omit<RobotModel, 'id'>) => wrap(async () => {
    const res = await api.post<RobotModel>('/models', m);
    setModels(prev => sortByName([...prev, res.data]));
  }, 'สร้างรุ่นหุ่นยนต์แล้ว');
  const updateModel = async (id: string, m: Partial<RobotModel>) => wrap(async () => {
    const res = await api.put<RobotModel>(`/models/${id}`, m);
    setModels(prev => sortByName(upsertById(prev, res.data)));
  }, 'แก้ไขรุ่นหุ่นยนต์แล้ว');
  const deleteModel = async (id: string) => wrap(async () => {
    await api.delete(`/models/${id}`);
    setModels(prev => prev.filter(model => model.id !== id));
  }, 'ลบรุ่นหุ่นยนต์แล้ว');

  // Customers CRUD
  const addCustomer = async (c: Omit<Customer, 'id'>) => wrap(async () => {
    const res = await api.post<Customer>('/customers', c);
    setCustomers(prev => sortByName([...prev, res.data]));
  }, 'สร้างลูกค้าแล้ว');
  const quickAddCustomer = async (name: string): Promise<Customer> => {
    try {
      // Client-side duplicate guard (case-insensitive)
      const dup = customers.find(c => c.name.trim().toLowerCase() === name.trim().toLowerCase());
      if (dup) {
        showToast(`มีลูกค้าชื่อ “${dup.name}” อยู่แล้ว`, 'error');
        throw new Error('duplicate');
      }
      const res = await api.post<Customer>('/customers', { name: name.trim(), contactPerson: '', email: '', phone: '', address: '' });
      setCustomers(prev => sortByName([...prev, res.data]));
      showToast(`เพิ่มลูกค้า “${name.trim()}” แล้ว`, 'success');
      return res.data as Customer;
    } catch (e: any) {
      if (e?.message !== 'duplicate') {
        const msg = e?.response?.data?.error || e?.message || 'เพิ่มลูกค้าไม่สำเร็จ';
        showToast(msg, 'error');
      }
      throw e;
    }
  };
  const updateCustomer = async (id: string, c: Partial<Customer>) => wrap(async () => {
    const res = await api.put<Customer>(`/customers/${id}`, c);
    setCustomers(prev => sortByName(upsertById(prev, res.data)));
  }, 'แก้ไขลูกค้าแล้ว');
  const deleteCustomer = async (id: string) => wrap(async () => {
    await api.delete(`/customers/${id}`);
    setCustomers(prev => prev.filter(customer => customer.id !== id));
  }, 'ลบลูกค้าแล้ว');

  // Robots CRUD
  const addRobot = async (r: Omit<Robot, 'id'>) => wrap(async () => {
    const res = await api.post<Robot>('/robots', r);
    setRobots(prev => sortBySerial([...prev, res.data]));
  }, 'เพิ่มหุ่นยนต์แล้ว');
  const updateRobot = async (id: string, r: Partial<Robot>) => wrap(async () => {
    const res = await api.put<Robot>(`/robots/${id}`, r);
    setRobots(prev => sortBySerial(upsertById(prev, res.data)));
  }, 'แก้ไขหุ่นยนต์แล้ว');
  const deleteRobot = async (id: string) => wrap(async () => {
    await api.delete(`/robots/${id}`);
    setRobots(prev => prev.filter(robot => robot.id !== id));
  }, 'ลบหุ่นยนต์แล้ว');
  const updateRobotStatus = async (id: string, status: Robot['status'], customerId?: string) =>
    wrap(async () => {
      const res = await api.put<Robot>(`/robots/${id}`, { status, customerId: customerId || null });
      setRobots(prev => sortBySerial(upsertById(prev, res.data)));
    });

  // Tickets CRUD
  const addTicket = async (t: Omit<MaintenanceTicket, 'id' | 'status' | 'reportDate'>) =>
    wrap(async () => {
      const res = await api.post<MaintenanceTicket>('/tickets', { ...t, status: 'Pending', reportDate: todayISO() });
      setTickets(prev => sortByReportDateDesc([...prev, res.data]));
      if (res.data.robotId) {
        setRobots(prev => prev.map(robot => robot.id === res.data.robotId ? { ...robot, status: 'In Maintenance' } : robot));
      }
    }, 'สร้างใบแจ้งซ่อมแล้ว');
  const updateTicket = async (id: string, t: Partial<MaintenanceTicket>) =>
    wrap(async () => {
      const res = await api.put<MaintenanceTicket>(`/tickets/${id}`, t);
      setTickets(prev => sortByReportDateDesc(upsertById(prev, res.data)));
      if (res.data.robotId) {
        setRobots(prev => prev.map(robot => {
          if (robot.id !== res.data.robotId) return robot;
          if (['Pending', 'In Progress', 'Waiting Quotation', 'Ready to Ship'].includes(res.data.status)) {
            return { ...robot, status: 'In Maintenance' };
          }
          if (res.data.status === 'Completed' && robot.status !== 'Missing') {
            return { ...robot, status: robot.customerId ? 'Assigned' : 'In Stock' };
          }
          return robot;
        }));
      }
    }, 'แก้ไขใบแจ้งซ่อมแล้ว');
  const deleteTicket = async (id: string) => wrap(async () => {
    await api.delete(`/tickets/${id}`);
    setTickets(prev => prev.filter(ticket => ticket.id !== id));
  }, 'ลบใบแจ้งซ่อมแล้ว');
  const updateTicketStatus = async (id: string, status: MaintenanceTicket['status'], resolution?: string, replacedParts?: string) =>
    wrap(async () => {
      const res = await api.put<MaintenanceTicket>(`/tickets/${id}`, { status, resolution, replacedParts });
      setTickets(prev => sortByReportDateDesc(upsertById(prev, res.data)));
      if (res.data.robotId) {
        setRobots(prev => prev.map(robot => {
          if (robot.id !== res.data.robotId) return robot;
          if (status === 'Completed' && robot.status !== 'Missing') {
            return { ...robot, status: robot.customerId ? 'Assigned' : 'In Stock' };
          }
          return { ...robot, status: 'In Maintenance' };
        }));
      }
    }, 'อัปเดตสถานะใบแจ้งซ่อมแล้ว');

  return (
    <DataContext.Provider value={{
      models, robots, customers, tickets, spareParts, ensureSpareParts, sparePartSummary, loading,
      addModel, updateModel, deleteModel,
      addCustomer, quickAddCustomer, updateCustomer, deleteCustomer,
      addRobot, updateRobot, deleteRobot, updateRobotStatus,
      addTicket, updateTicket, deleteTicket, updateTicketStatus,
      fetchData
    }}>
      {children}
    </DataContext.Provider>
  );
};

export const useData = () => {
  const context = useContext(DataContext);
  if (!context) throw new Error("useData must be used within a DataProvider");
  return context;
};

/** The full spare-part catalog; the first caller triggers the (one-time) load. */
export const useSpareParts = () => {
  const { spareParts, ensureSpareParts } = useData();
  useEffect(() => { ensureSpareParts(); }, [ensureSpareParts]);
  return spareParts;
};
