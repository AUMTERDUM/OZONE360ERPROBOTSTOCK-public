import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { projectRequests, projectRequestItems } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { isValidTransition, PROJECT_REQUEST_TRANSITIONS } from '../lib/transitions';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

function fullPr(db: Db, id: string) {
  return db.query.projectRequests.findFirst({ where: eq(projectRequests.id, id), with: { items: true } });
}

async function insertItems(db: Db, prId: string, items: any[]) {
  for (const it of items || []) {
    await db.insert(projectRequestItems).values({
      id: randomUUID(), projectRequestId: prId,
      itemType: it.itemType || 'Part', description: it.description, vendor: it.vendor || null,
      quantity: Number(it.quantity) || 1, unit: it.unit || 'ชิ้น',
      unitPrice: Number(it.unitPrice) || 0, totalPrice: Number(it.totalPrice) || 0,
      link: it.link || null, remark: it.remark || null,
    });
  }
}

export const projectRequestsRoutes = new Hono<AppEnv>();

projectRequestsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.projectRequests.findMany({ orderBy: desc(projectRequests.createdAt), with: { items: true } });
  return c.json(rows);
});

projectRequestsRoutes.get('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const row = await fullPr(db, c.req.param('id'));
  if (!row) return c.json({ error: 'Not found' }, 404);
  return c.json(row);
});

projectRequestsRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const b = await c.req.json();
  const items = b.items || [];
  if (!b.docNumber || !b.title || !b.startDate) return c.json({ error: 'docNumber, title, startDate are required' }, 400);
  const db = getDb(c.env.DB);
  const prId = randomUUID();
  const totalCost = items.reduce((s: number, it: any) => s + (Number(it.totalPrice) || 0), 0);
  await db.insert(projectRequests).values({
    id: prId, docNumber: b.docNumber, title: b.title, description: b.description ?? null,
    projectType: b.projectType || 'Both', status: b.status || 'Draft', startDate: b.startDate,
    expectedEndDate: b.expectedEndDate || null, budget: Number(b.budget) || 0, totalCost,
    customerId: b.customerId || null, robotId: b.robotId || null, notes: b.notes ?? null, createdBy: user.username,
  });
  await insertItems(db, prId, items);
  await logActivity(db, {
    entityType: 'ProjectRequest', entityId: prId, entityName: b.docNumber,
    action: 'created', newValues: { title: b.title, status: b.status || 'Draft' }, performedBy: user.username,
  });
  return c.json(await fullPr(db, prId), 201);
});

projectRequestsRoutes.patch('/:id/status', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status, approvedBy, approvedAt, actualEndDate } = await c.req.json();
  if (!Object.keys(PROJECT_REQUEST_TRANSITIONS).includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const db = getDb(c.env.DB);
  const existing = await db.query.projectRequests.findFirst({ where: eq(projectRequests.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (!isValidTransition(PROJECT_REQUEST_TRANSITIONS, existing.status, status)) {
    return c.json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${existing.status}" เป็น "${status}" ได้` }, 400);
  }
  const updateData: Record<string, string | null> = { status };
  const today = new Date().toISOString().split('T')[0];
  if (status === 'Approved') { updateData.approvedBy = approvedBy ?? user.username ?? null; updateData.approvedAt = approvedAt || today; }
  if (status === 'Completed') updateData.actualEndDate = actualEndDate || today;
  await db.update(projectRequests).set(updateData).where(eq(projectRequests.id, id));
  await logActivity(db, {
    entityType: 'ProjectRequest', entityId: id, entityName: existing.docNumber,
    action: 'status_changed', oldValues: { status: existing.status }, newValues: { status }, performedBy: user.username,
  });
  return c.json(await fullPr(db, id));
});

projectRequestsRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const b = await c.req.json();
  const items = b.items || [];
  const db = getDb(c.env.DB);
  const existing = await db.query.projectRequests.findFirst({ where: eq(projectRequests.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const totalCost = items.reduce((s: number, it: any) => s + (Number(it.totalPrice) || 0), 0);
  await db.delete(projectRequestItems).where(eq(projectRequestItems.projectRequestId, id));
  await db.update(projectRequests).set({
    title: b.title, description: b.description ?? null, projectType: b.projectType,
    status: b.status, startDate: b.startDate, expectedEndDate: b.expectedEndDate || null,
    actualEndDate: b.actualEndDate || null, budget: Number(b.budget) || 0, totalCost,
    customerId: b.customerId || null, robotId: b.robotId || null, notes: b.notes ?? null,
    approvedBy: b.approvedBy || null, approvedAt: b.approvedAt || null,
  }).where(eq(projectRequests.id, id));
  await insertItems(db, id, items);
  await logActivity(db, {
    entityType: 'ProjectRequest', entityId: id, entityName: existing.docNumber,
    action: 'updated', oldValues: { status: existing.status }, newValues: { status: b.status }, performedBy: user.username,
  });
  return c.json(await fullPr(db, id));
});

projectRequestsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const row = await db.query.projectRequests.findFirst({ where: eq(projectRequests.id, id) });
  await db.delete(projectRequests).where(eq(projectRequests.id, id));
  await logActivity(db, {
    entityType: 'ProjectRequest', entityId: id, entityName: row?.docNumber, action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});
