import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc, gt } from 'drizzle-orm';
import { getDb } from '../db/client';
import { materialRequests, materialRequestItems, purchaseOrders, purchaseOrderItems, spareParts } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { createNotification } from '../lib/notifications';
import { docNumber } from '../lib/doc-number';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

const MR_ITEM_FIELDS = ['sparePartId', 'partName', 'sku', 'currentStock', 'minStock', 'requestedQty', 'remark'] as const;

async function fullMr(db: Db, id: string) {
  const request = await db.query.materialRequests.findFirst({ where: eq(materialRequests.id, id), with: { items: true } });
  if (!request) return request;
  const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts);
  const names = new Map(parts.map((part) => [part.id, part.name]));
  return { ...request, items: request.items.map((item) => ({
    ...item, partName: names.get(item.sparePartId) || item.partName,
  })) };
}

// Auto-generate a material request for parts at/below min stock (skips parts already on a pending MR).
export async function generateMaterialRequests(db: Db, performedBy?: string): Promise<{ created: number; partCount: number }> {
  const lowParts = await db.select().from(spareParts).where(gt(spareParts.minStock, 0));
  const belowMin = lowParts.filter((p) => p.stock <= p.minStock);
  if (belowMin.length === 0) return { created: 0, partCount: 0 };

  const pendingMRs = await db.query.materialRequests.findMany({ where: eq(materialRequests.status, 'Pending'), with: { items: true } });
  const alreadyRequested = new Set<string>();
  for (const mr of pendingMRs) for (const item of mr.items) alreadyRequested.add(item.sparePartId);

  const newItems = belowMin.filter((p) => !alreadyRequested.has(p.id));
  if (newItems.length === 0) return { created: 0, partCount: 0 };

  const mrId = randomUUID();
  await db.insert(materialRequests).values({
    id: mrId, docNumber: docNumber('MR'), status: 'Pending',
    requestDate: new Date().toISOString().split('T')[0], createdBy: performedBy || 'system',
  });
  for (const p of newItems) {
    await db.insert(materialRequestItems).values({
      id: randomUUID(), materialRequestId: mrId, sparePartId: p.id, partName: p.name, sku: p.sku,
      currentStock: p.stock, minStock: p.minStock, requestedQty: Math.max(p.minStock * 2 - p.stock, 1),
    });
  }
  const mr = await fullMr(db, mrId);
  await createNotification(db, 'low_stock', `Material Request สร้างอัตโนมัติ: ${mr!.docNumber}`, `${newItems.length} รายการต่ำกว่า min stock`, 'MaterialRequest', mrId);
  return { created: 1, partCount: newItems.length };
}

export const materialRequestsRoutes = new Hono<AppEnv>();

materialRequestsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.materialRequests.findMany({ orderBy: desc(materialRequests.createdAt), with: { items: true } });
  const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts);
  const names = new Map(parts.map((part) => [part.id, part.name]));
  return c.json(rows.map((request) => ({ ...request, items: request.items.map((item) => ({
    ...item, partName: names.get(item.sparePartId) || item.partName,
  })) })));
});

materialRequestsRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { items } = body;
  const db = getDb(c.env.DB);
  const mrId = randomUUID();
  await db.insert(materialRequests).values({
    id: mrId,
    docNumber: body.docNumber || docNumber('MR'),
    status: body.status || 'Pending',
    requestDate: body.requestDate || new Date().toISOString().split('T')[0],
    notes: body.notes ?? null,
    createdBy: user.username,
  });
  for (const it of (items || [])) {
    const data: Record<string, unknown> = { id: randomUUID(), materialRequestId: mrId };
    for (const f of MR_ITEM_FIELDS) if (f in it) data[f] = it[f];
    await db.insert(materialRequestItems).values(data as typeof materialRequestItems.$inferInsert);
  }
  return c.json(await fullMr(db, mrId), 201);
});

materialRequestsRoutes.patch('/:id/status', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status } = await c.req.json();
  if (!['Pending', 'Approved', 'Ordered', 'Cancelled'].includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const db = getDb(c.env.DB);
  const existing = await db.query.materialRequests.findFirst({ where: eq(materialRequests.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const patch: Record<string, unknown> = { status };
  if (status === 'Approved') { patch.approvedBy = user.username; patch.approvedAt = new Date().toISOString().split('T')[0]; }
  await db.update(materialRequests).set(patch).where(eq(materialRequests.id, id));
  return c.json(await fullMr(db, id));
});

materialRequestsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(materialRequests).where(eq(materialRequests.id, c.req.param('id')));
  return c.json({ success: true });
});

// Convert an Approved MR into a Draft PO.
materialRequestsRoutes.post('/:id/convert-to-po', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { supplier } = await c.req.json();
  const db = getDb(c.env.DB);
  const mr = await fullMr(db, id);
  if (!mr) return c.json({ error: 'Not found' }, 404);
  if (mr.status !== 'Approved') return c.json({ error: 'MR must be Approved before converting' }, 400);
  if (!supplier) return c.json({ error: 'supplier is required' }, 400);

  const poId = randomUUID();
  const poDoc = docNumber('PO');
  await db.insert(purchaseOrders).values({
    id: poId, docNumber: poDoc, orderDate: new Date().toISOString().split('T')[0],
    supplier, status: 'Draft', createdBy: user.username,
  });
  for (const i of mr.items) {
    await db.insert(purchaseOrderItems).values({
      id: randomUUID(), purchaseOrderId: poId, sparePartId: i.sparePartId, sku: i.sku,
      partName: i.partName, quantity: i.requestedQty, unitPrice: 0, receivedQty: 0,
    });
  }
  await db.update(materialRequests).set({ status: 'Ordered', linkedPoId: poId }).where(eq(materialRequests.id, id));
  await logActivity(db, {
    entityType: 'MaterialRequest', entityId: id, entityName: mr.docNumber,
    action: 'converted_to_po', newValues: { poId, poDocNumber: poDoc }, performedBy: user.username,
  });
  const order = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, poId), with: { items: true } });
  return c.json(order, 201);
});

materialRequestsRoutes.post('/generate', authenticate, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const result = await generateMaterialRequests(db, user.username);
  return c.json(result);
});
