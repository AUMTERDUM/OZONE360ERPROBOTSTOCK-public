import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc, sql, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { purchaseOrders, purchaseOrderItems, spareParts } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { docNumber } from '../lib/doc-number';
import { isValidTransition, PO_TRANSITIONS } from '../lib/transitions';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

const PO_FIELDS = ['docNumber', 'orderDate', 'supplier', 'supplierContact', 'supplierPhone', 'supplierChannel', 'status', 'notes', 'expectedDeliveryDate', 'paymentTerms'] as const;

async function fullPo(db: Db, id: string) {
  const order = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id), with: { items: true } });
  if (!order) return order;
  const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts);
  const names = new Map(parts.map((part) => [part.id, part.name]));
  return { ...order, items: order.items.map((item) => ({
    ...item,
    // sparePartId is the source of truth; partName remains a legacy fallback.
    partName: item.sparePartId ? (names.get(item.sparePartId) || item.partName) : item.partName,
  })) };
}

function mapItem(poId: string, i: any) {
  return {
    id: randomUUID(), purchaseOrderId: poId,
    sparePartId: i.sparePartId || null, sku: i.sku || '', partName: i.partName || '',
    quantity: Number(i.quantity), unitPrice: Number(i.unitPrice),
    receivedQty: Number(i.receivedQty ?? 0), remark: i.remark || '',
  };
}

export const purchaseOrdersRoutes = new Hono<AppEnv>();

purchaseOrdersRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.purchaseOrders.findMany({ orderBy: desc(purchaseOrders.createdAt), with: { items: true } });
  const partIds = [...new Set(rows.flatMap((order) => order.items.map((item) => item.sparePartId).filter((id): id is string => !!id)))];
  const names = new Map<string, string>();
  // D1 caps bound parameters per query at 100.
  for (let i = 0; i < partIds.length; i += 90) {
    const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts).where(inArray(spareParts.id, partIds.slice(i, i + 90)));
    for (const part of parts) names.set(part.id, part.name);
  }
  return c.json(rows.map((order) => ({ ...order, items: order.items.map((item) => ({
    ...item, partName: item.sparePartId ? (names.get(item.sparePartId) || item.partName) : item.partName,
  })) })));
});

purchaseOrdersRoutes.get('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const order = await fullPo(db, c.req.param('id'));
  if (!order) return c.json({ error: 'Not found' }, 404);
  return c.json(order);
});

purchaseOrdersRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { items } = body;
  if (!body.supplier || !body.orderDate) return c.json({ error: 'supplier and orderDate are required' }, 400);
  const db = getDb(c.env.DB);
  const poId = randomUUID();
  const totalAmount = (items || []).reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitPrice), 0);
  const data: Record<string, unknown> = {
    id: poId, createdBy: user.username, totalAmount,
    docNumber: body.docNumber || docNumber('PO'), status: body.status || 'Draft',
  };
  for (const f of PO_FIELDS) if (f in body && f !== 'docNumber' && f !== 'status') data[f] = body[f];
  await db.insert(purchaseOrders).values(data as typeof purchaseOrders.$inferInsert);
  for (const i of (items || [])) await db.insert(purchaseOrderItems).values(mapItem(poId, i));
  await logActivity(db, {
    entityType: 'PurchaseOrder', entityId: poId, entityName: data.docNumber as string,
    action: 'created', newValues: { docNumber: data.docNumber, supplier: body.supplier, itemCount: (items || []).length }, performedBy: user.username,
  });
  return c.json(await fullPo(db, poId), 201);
});

purchaseOrdersRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { items } = body;
  const db = getDb(c.env.DB);
  const existing = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  if (items !== undefined) await db.delete(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, id));
  const totalAmount = items !== undefined
    ? (items as any[]).reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0)
    : existing.totalAmount;
  const data: Record<string, unknown> = { totalAmount };
  for (const f of PO_FIELDS) if (f in body) data[f] = body[f];
  await db.update(purchaseOrders).set(data).where(eq(purchaseOrders.id, id));
  if (items !== undefined) for (const i of items) await db.insert(purchaseOrderItems).values(mapItem(id, i));
  await logActivity(db, {
    entityType: 'PurchaseOrder', entityId: id, entityName: existing.docNumber, action: 'updated', performedBy: user.username,
  });
  return c.json(await fullPo(db, id));
});

purchaseOrdersRoutes.patch('/:id/status', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status, receivedItems } = await c.req.json();
  const valid = ['Draft', 'Ordered', 'Partial', 'Received', 'Cancelled'];
  if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const db = getDb(c.env.DB);
  const existing = await fullPo(db, id);
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (!isValidTransition(PO_TRANSITIONS, existing.status, status)) {
    return c.json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${existing.status}" เป็น "${status}" ได้` }, 400);
  }
  const patch: Record<string, unknown> = { status };
  const today = new Date().toISOString().split('T')[0];
  if (status === 'Ordered') { patch.approvedBy = user.username; patch.approvedAt = today; }
  if (status === 'Received' || status === 'Partial') {
    patch.receivedAt = today;
    const receivedMap: Record<string, number> = {};
    if (Array.isArray(receivedItems)) for (const ri of receivedItems) receivedMap[ri.id] = Number(ri.qty) || 0;
    let totalOrdered = 0, totalReceived = 0;
    for (const item of existing.items) {
      const qty = receivedMap[item.id] ?? (status === 'Received' ? item.quantity : 0);
      totalOrdered += item.quantity;
      totalReceived += qty;
      if (item.sparePartId && qty > 0) {
        const increment = qty - (item.receivedQty || 0);
        if (increment > 0) await db.update(spareParts).set({ stock: sql`${spareParts.stock} + ${increment}` }).where(eq(spareParts.id, item.sparePartId));
      }
      await db.update(purchaseOrderItems).set({ receivedQty: qty }).where(eq(purchaseOrderItems.id, item.id));
    }
    if (status === 'Received' && totalReceived < totalOrdered && totalReceived > 0) patch.status = 'Partial';
  }
  await db.update(purchaseOrders).set(patch).where(eq(purchaseOrders.id, id));
  await logActivity(db, {
    entityType: 'PurchaseOrder', entityId: id, entityName: existing.docNumber,
    action: 'status_changed', oldValues: { status: existing.status }, newValues: { status }, performedBy: user.username,
  });
  return c.json(await fullPo(db, id));
});

purchaseOrdersRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const order = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id) });
  await db.delete(purchaseOrders).where(eq(purchaseOrders.id, id));
  await logActivity(db, {
    entityType: 'PurchaseOrder', entityId: id, entityName: order?.docNumber, action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});
