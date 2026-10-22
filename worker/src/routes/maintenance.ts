import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, and, gte, lte, asc, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { maintenanceSchedules, maintenancePlans, maintenancePlanRobots, maintenanceVisits, robots, customers } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { addDays } from '../lib/dates';
import { generateDueMaintenanceSchedules, regeneratePlanVisits, planVisitTickets, applyVisitTickets, type VisitCheck } from '../lib/maintenance';
import { readFirstSheetObjects } from '../lib/xlsx-helpers';
import { getAllStores } from '../lib/pudu-client';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

// ── /api/maintenance-schedules ───────────────────────────────────────────────
export const schedulesRoutes = new Hono<AppEnv>();

schedulesRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(maintenanceSchedules)
    .orderBy(desc(maintenanceSchedules.active), asc(maintenanceSchedules.nextDueDate));
  return c.json(rows);
});

schedulesRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const p = await c.req.json();
  if (!p.title || !p.robotId || !p.frequencyDays || !p.nextDueDate) {
    return c.json({ error: 'title, robotId, frequencyDays and nextDueDate required' }, 400);
  }
  const db = getDb(c.env.DB);
  const robot = await db.query.robots.findFirst({ where: eq(robots.id, p.robotId) });
  if (!robot) return c.json({ error: 'Robot not found' }, 404);

  const newId = randomUUID();
  await db.insert(maintenanceSchedules).values({
    id: newId,
    title: String(p.title).trim(),
    robotId: p.robotId,
    customerId: p.customerId || robot.customerId || null,
    frequencyDays: Number(p.frequencyDays),
    leadDays: Number(p.leadDays || 7),
    nextDueDate: p.nextDueDate,
    assignedTo: p.assignedTo || null,
    priorityLevel: p.priorityLevel || 'Normal',
    notes: p.notes || null,
    active: p.active !== false,
  });
  const schedule = await db.query.maintenanceSchedules.findFirst({ where: eq(maintenanceSchedules.id, newId) });
  await logActivity(db, {
    entityType: 'MaintenanceSchedule', entityId: newId, entityName: schedule!.title,
    action: 'created', newValues: p, performedBy: user.username,
  });
  return c.json(schedule, 201);
});

schedulesRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const b = await c.req.json();
  const db = getDb(c.env.DB);
  const old = await db.query.maintenanceSchedules.findFirst({ where: eq(maintenanceSchedules.id, id) });
  if (!old) return c.json({ error: 'Schedule not found' }, 404);

  const data: Record<string, unknown> = {};
  if (b.title !== undefined) data.title = String(b.title).trim();
  if (b.robotId !== undefined) data.robotId = b.robotId;
  if (b.customerId !== undefined) data.customerId = b.customerId || null;
  if (b.frequencyDays !== undefined) data.frequencyDays = Number(b.frequencyDays);
  if (b.leadDays !== undefined) data.leadDays = Number(b.leadDays);
  if (b.nextDueDate !== undefined) data.nextDueDate = b.nextDueDate;
  if (b.lastCompletedAt !== undefined) data.lastCompletedAt = b.lastCompletedAt || null;
  if (b.assignedTo !== undefined) data.assignedTo = b.assignedTo || null;
  if (b.priorityLevel !== undefined) data.priorityLevel = b.priorityLevel || 'Normal';
  if (b.notes !== undefined) data.notes = b.notes || null;
  if (b.active !== undefined) data.active = !!b.active;

  await db.update(maintenanceSchedules).set(data).where(eq(maintenanceSchedules.id, id));
  const schedule = await db.query.maintenanceSchedules.findFirst({ where: eq(maintenanceSchedules.id, id) });
  await logActivity(db, {
    entityType: 'MaintenanceSchedule', entityId: id, entityName: schedule?.title,
    action: 'updated', oldValues: old, newValues: data, performedBy: user.username,
  });
  return c.json(schedule);
});

schedulesRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const schedule = await db.query.maintenanceSchedules.findFirst({ where: eq(maintenanceSchedules.id, id) });
  if (!schedule) return c.json({ error: 'Schedule not found' }, 404);
  await db.delete(maintenanceSchedules).where(eq(maintenanceSchedules.id, id));
  await logActivity(db, {
    entityType: 'MaintenanceSchedule', entityId: id, entityName: schedule.title,
    action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});

schedulesRoutes.post('/generate-due', authenticate, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const result = await generateDueMaintenanceSchedules(db, user.username);
  return c.json(result);
});

// ── /api/ma-plans ────────────────────────────────────────────────────────────
export const maPlansRoutes = new Hono<AppEnv>();

// A plan with no robots covers all of the customer's robots; otherwise only the listed ones.
async function withRobotIds<T extends { id: string }>(db: Db, plans: T[]): Promise<(T & { robotIds: string[] })[]> {
  const links = plans.length ? await db.select().from(maintenancePlanRobots) : [];
  const byPlan = new Map<string, string[]>();
  for (const link of links) {
    const list = byPlan.get(link.planId);
    if (list) list.push(link.robotId); else byPlan.set(link.planId, [link.robotId]);
  }
  return plans.map((plan) => ({ ...plan, robotIds: byPlan.get(plan.id) ?? [] }));
}

async function validatePlanRobotIds(db: Db, customerId: string, raw: unknown): Promise<{ ids: string[] } | { error: string }> {
  if (raw === undefined || raw === null) return { ids: [] };
  if (!Array.isArray(raw) || raw.some((value) => typeof value !== 'string')) return { error: 'robotIds must be an array of ids' };
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return { ids };
  const owned = new Set((await db.select({ id: robots.id }).from(robots).where(eq(robots.customerId, customerId))).map((r) => r.id));
  if (ids.some((id) => !owned.has(id))) return { error: 'พบหุ่นยนต์ที่ไม่ได้เป็นของลูกค้าที่เลือก' };
  return { ids };
}

async function replacePlanRobots(db: Db, planId: string, robotIds: string[]) {
  await db.delete(maintenancePlanRobots).where(eq(maintenancePlanRobots.planId, planId));
  // D1 caps bound parameters per statement, so insert in small batches.
  for (let i = 0; i < robotIds.length; i += 40) {
    await db.insert(maintenancePlanRobots).values(robotIds.slice(i, i + 40).map((robotId) => ({ planId, robotId })));
  }
}

maPlansRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  // Visits overdue by >180 days are auto-skipped by the hourly cron (skipStaleMaVisits).
  const plans = await db.query.maintenancePlans.findMany({
    orderBy: [desc(maintenancePlans.active), asc(maintenancePlans.startDate)],
    with: { visits: { orderBy: (v, { asc: a }) => a(v.visitNumber) } },
  });
  return c.json(await withRobotIds(db, plans));
});

maPlansRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const b = await c.req.json();
  if (!b.customerId || !b.startDate) return c.json({ error: 'customerId and startDate are required' }, 400);
  const db = getDb(c.env.DB);
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, b.customerId) });
  if (!customer) return c.json({ error: 'Customer not found' }, 404);
  const robotCheck = await validatePlanRobotIds(db, b.customerId, b.robotIds);
  if ('error' in robotCheck) return c.json({ error: robotCheck.error }, 400);

  const newId = randomUUID();
  await db.insert(maintenancePlans).values({
    id: newId,
    customerId: b.customerId,
    startDate: b.startDate,
    endDate: b.endDate || null,
    intervalMonths: Number(b.intervalMonths || 3),
    notes: b.notes || null,
    active: b.active !== false,
  });
  await replacePlanRobots(db, newId, robotCheck.ids);
  await regeneratePlanVisits(db, newId);
  await logActivity(db, {
    entityType: 'MaintenancePlan', entityId: newId, entityName: customer.name,
    action: 'created', newValues: b, performedBy: user.username,
  });
  const full = await db.query.maintenancePlans.findFirst({
    where: eq(maintenancePlans.id, newId),
    with: { visits: { orderBy: (v, { asc: a }) => a(v.visitNumber) } },
  });
  const [withIds] = await withRobotIds(db, [full!]);
  return c.json(withIds, 201);
});

maPlansRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const b = await c.req.json();
  const db = getDb(c.env.DB);
  const old = await db.query.maintenancePlans.findFirst({ where: eq(maintenancePlans.id, id) });
  if (!old) return c.json({ error: 'Plan not found' }, 404);
  const robotCheck = b.robotIds !== undefined ? await validatePlanRobotIds(db, old.customerId, b.robotIds) : null;
  if (robotCheck && 'error' in robotCheck) return c.json({ error: robotCheck.error }, 400);

  const data: Record<string, unknown> = {};
  if (b.startDate !== undefined) data.startDate = b.startDate;
  if (b.endDate !== undefined) data.endDate = b.endDate || null;
  if (b.intervalMonths !== undefined) data.intervalMonths = Number(b.intervalMonths);
  if (b.notes !== undefined) data.notes = b.notes || null;
  if (b.active !== undefined) data.active = !!b.active;

  await db.update(maintenancePlans).set(data).where(eq(maintenancePlans.id, id));
  if (robotCheck) await replacePlanRobots(db, id, robotCheck.ids);
  const scheduleAffected = data.startDate !== undefined || data.endDate !== undefined || data.intervalMonths !== undefined;
  if (scheduleAffected) await regeneratePlanVisits(db, id);
  await logActivity(db, {
    entityType: 'MaintenancePlan', entityId: id, action: 'updated',
    oldValues: old, newValues: robotCheck ? { ...data, robotIds: robotCheck.ids } : data, performedBy: user.username,
  });
  const full = await db.query.maintenancePlans.findFirst({
    where: eq(maintenancePlans.id, id),
    with: { visits: { orderBy: (v, { asc: a }) => a(v.visitNumber) } },
  });
  const [withIds] = await withRobotIds(db, [full!]);
  return c.json(withIds);
});

maPlansRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const plan = await db.query.maintenancePlans.findFirst({ where: eq(maintenancePlans.id, id) });
  if (!plan) return c.json({ error: 'Plan not found' }, 404);
  await db.delete(maintenancePlans).where(eq(maintenancePlans.id, id));
  await logActivity(db, {
    entityType: 'MaintenancePlan', entityId: id, action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});

maPlansRoutes.post('/:id/regenerate', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const result = await regeneratePlanVisits(db, c.req.param('id'));
  return c.json(result);
});

// Shared upsert used by both MA-plan import routes below: find-or-create the
// customer by name, skip if a plan already exists, else create plan + visits.
async function importMaPlanForCustomer(
  db: Db, byName: Map<string, { id: string; name: string }>, planByCustomer: Map<string, unknown>,
  name: string, startDate: string, active: boolean, notes: string,
  extra: { contactPerson?: string; email?: string; phone?: string; address?: string } = {},
): Promise<{ createdCustomer: boolean; result: { action: 'skip' | 'create'; reason: string; visitsCreated?: number } }> {
  let cust = byName.get(name.toLowerCase());
  let createdCustomer = false;
  if (!cust) {
    const newId = randomUUID();
    await db.insert(customers).values({
      id: newId, name, contactPerson: extra.contactPerson || '', email: extra.email || '',
      phone: extra.phone || '', address: extra.address || '', type: 'customer',
    });
    cust = { id: newId, name };
    byName.set(name.toLowerCase(), cust);
    createdCustomer = true;
  }
  if (planByCustomer.has(cust.id)) {
    return { createdCustomer, result: { action: 'skip', reason: 'มี MA Plan อยู่แล้ว' } };
  }
  const planId = randomUUID();
  await db.insert(maintenancePlans).values({ id: planId, customerId: cust.id, startDate, endDate: null, intervalMonths: 3, notes, active });
  planByCustomer.set(cust.id, { id: planId });
  const { created } = await regeneratePlanVisits(db, planId);
  return { createdCustomer, result: { action: 'create', reason: `สร้าง MA Plan + ${created} visits`, visitsCreated: created } };
}

// POST /api/ma-plans/import/upload — parse an xlsx of stores (Store Name, Creation Time,
// Status) and create a customer + MA plan for each new one.
maPlansRoutes.post('/import/upload', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
    const rows = readFirstSheetObjects(await file.arrayBuffer());
    if (rows.length === 0) return c.json({ error: 'ไฟล์ไม่มีข้อมูล' }, 400);

    const db = getDb(c.env.DB);
    const allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers);
    const byName = new Map(allCustomers.map((cu) => [cu.name.trim().toLowerCase(), cu]));
    const existingPlans = await db.select({ id: maintenancePlans.id, customerId: maintenancePlans.customerId }).from(maintenancePlans);
    const planByCustomer = new Map(existingPlans.map((p) => [p.customerId, p]));

    let createdCustomers = 0, createdPlans = 0, skipped = 0, totalVisits = 0;
    const details: Record<string, unknown>[] = [];

    for (const row of rows) {
      const name = String(row['Store Name'] ?? '').trim();
      const creation = String(row['Creation Time'] ?? '').trim();
      const rowStatus = String(row['Status'] ?? '').trim();
      if (!name || !creation) { skipped++; details.push({ name: name || '(ว่าง)', action: 'skip', reason: 'ชื่อหรือวันที่ว่าง' }); continue; }

      let startDate: string;
      if (row['Creation Time'] instanceof Date) {
        startDate = (row['Creation Time'] as Date).toISOString().slice(0, 10);
      } else {
        const m = creation.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!m) { skipped++; details.push({ name, action: 'skip', reason: `วันที่ไม่ถูกต้อง: ${creation}` }); continue; }
        startDate = m[1];
      }

      const { createdCustomer, result } = await importMaPlanForCustomer(
        db, byName, planByCustomer, name, startDate, rowStatus.toLowerCase() === 'open',
        `นำเข้าจาก Excel · ${rowStatus}`,
        { phone: String(row['Contact Information'] ?? ''), address: String(row['Detailed Address'] ?? '') },
      );
      if (createdCustomer) createdCustomers++;
      if (result.action === 'skip') { skipped++; details.push({ name, action: 'skip', reason: result.reason }); continue; }
      createdPlans++; totalVisits += result.visitsCreated ?? 0;
      details.push({ name, action: 'create', reason: result.reason, startDate });
    }

    await logActivity(db, { entityType: 'MAImport', entityId: 'xlsx', action: 'import-ma-plans', performedBy: user.username, newValues: { createdCustomers, createdPlans, skipped, totalVisits } });
    return c.json({ totalRows: rows.length, createdCustomers, createdPlans, skipped, totalVisits, details });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Import failed' }, 500);
  }
});

// POST /api/ma-plans/import/pudu — create a customer + MA plan for every Pudu store.
maPlansRoutes.post('/import/pudu', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  try {
    const stores = await getAllStores(c.env);
    if (!stores || stores.length === 0) return c.json({ error: 'ไม่พบร้านค้าจาก PUDU API' }, 400);

    const db = getDb(c.env.DB);
    const allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers);
    const byName = new Map(allCustomers.map((cu) => [cu.name.trim().toLowerCase(), cu]));
    const existingPlans = await db.select({ id: maintenancePlans.id, customerId: maintenancePlans.customerId }).from(maintenancePlans);
    const planByCustomer = new Map(existingPlans.map((p) => [p.customerId, p]));

    let createdCustomers = 0, createdPlans = 0, skipped = 0, totalVisits = 0;
    const details: Record<string, unknown>[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const store of stores) {
      const name = (store.shop_name || '').trim();
      if (!name) { skipped++; continue; }

      const { createdCustomer, result } = await importMaPlanForCustomer(
        db, byName, planByCustomer, name, today, true, `นำเข้าจาก PUDU API · shop_id: ${store.shop_id}`,
      );
      if (createdCustomer) createdCustomers++;
      if (result.action === 'skip') { skipped++; details.push({ name, action: 'skip', reason: result.reason }); continue; }
      createdPlans++; totalVisits += result.visitsCreated ?? 0;
      details.push({ name, action: 'create', reason: result.reason, shopId: store.shop_id });
    }

    await logActivity(db, { entityType: 'MAImport', entityId: 'pudu-api', action: 'import-ma-plans-pudu', performedBy: user.username, newValues: { createdCustomers, createdPlans, skipped, totalVisits } });
    return c.json({ totalStores: stores.length, createdCustomers, createdPlans, skipped, totalVisits, details });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'PUDU import failed' }, 500);
  }
});

// ── /api/ma-visits ───────────────────────────────────────────────────────────
export const maVisitsRoutes = new Hono<AppEnv>();

maVisitsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const { upcomingDays, status, planId, includeOverdue, from, to } = c.req.query();
  const conds = [];
  if (planId) conds.push(eq(maintenanceVisits.planId, planId));
  if (from) conds.push(gte(maintenanceVisits.scheduledDate, from));
  if (to) conds.push(lte(maintenanceVisits.scheduledDate, to));
  if (upcomingDays) {
    const today = new Date().toISOString().slice(0, 10);
    const until = addDays(today, Number(upcomingDays) || 14);
    // includeOverdue=1 also returns still-Scheduled visits whose date has passed (badges/dashboard).
    if (includeOverdue !== '1') conds.push(gte(maintenanceVisits.scheduledDate, today));
    conds.push(lte(maintenanceVisits.scheduledDate, until));
    conds.push(eq(maintenanceVisits.status, 'Scheduled'));
  } else if (status) {
    conds.push(eq(maintenanceVisits.status, status));
  }
  const visits = await db.query.maintenanceVisits.findMany({
    where: conds.length ? and(...conds) : undefined,
    orderBy: asc(maintenanceVisits.scheduledDate),
    with: { plan: { with: { customer: { columns: { id: true, name: true } } } } },
  });
  return c.json(visits);
});

maVisitsRoutes.patch('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const b = await c.req.json();
  const db = getDb(c.env.DB);
  const old = await db.query.maintenanceVisits.findFirst({ where: eq(maintenanceVisits.id, id) });
  if (!old) return c.json({ error: 'Visit not found' }, 404);

  const data: Record<string, unknown> = {};
  if (b.status !== undefined) data.status = b.status;
  if (b.scheduledDate !== undefined) data.scheduledDate = b.scheduledDate;
  if (b.completedAt !== undefined) data.completedAt = b.completedAt || null;
  if (b.technician !== undefined) data.technician = b.technician || null;
  if (b.summary !== undefined) data.summary = b.summary || null;
  let checks: VisitCheck[] | null = null;
  if (b.report !== undefined) {
    // Legacy reports are a bare array of checks; current ones are { checks: [...], ... }.
    checks = Array.isArray(b.report) ? b.report : b.report?.checks;
    if (b.report && !Array.isArray(checks)) return c.json({ error: 'report.checks must be an array' }, 400);
  }
  if (data.status === 'Done' && !data.completedAt) {
    data.completedAt = new Date().toISOString().slice(0, 10);
  }

  // Once the visit is done, findings become tickets and used parts come out of stock.
  // Everything is validated first so a stock error leaves the visit and stock untouched.
  let ticketsCreated = 0;
  const finalStatus = (data.status as string | undefined) ?? old.status;
  if (checks && finalStatus === 'Done') {
    const planned = await planVisitTickets(db, checks);
    if ('error' in planned) return c.json({ error: planned.error }, 400);
    ticketsCreated = await applyVisitTickets(db, {
      id, visitNumber: old.visitNumber, scheduledDate: (data.scheduledDate as string | undefined) ?? old.scheduledDate,
      technician: (data.technician as string | null | undefined) ?? old.technician,
    }, planned.plans, user.username);
  }
  if (b.report !== undefined) data.reportJson = b.report ? JSON.stringify(b.report) : null;

  await db.update(maintenanceVisits).set(data).where(eq(maintenanceVisits.id, id));
  const visit = await db.query.maintenanceVisits.findFirst({ where: eq(maintenanceVisits.id, id) });
  await logActivity(db, {
    entityType: 'MaintenanceVisit', entityId: id, action: 'updated',
    oldValues: old, newValues: data, performedBy: user.username,
  });
  return c.json({ ...visit, ticketsCreated });
});
