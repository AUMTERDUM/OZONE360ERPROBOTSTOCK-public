import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, asc, sql, and, like } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cachedJson, type CachedTable } from '../lib/read-cache';
import { spareParts, sparePartItems, warehouses, customers, robots, purchaseOrderItems, materialRequestItems, deliveryNoteItems } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { createNotification } from '../lib/notifications';
import { pickFields } from '../lib/pick-fields';
import { moveToTrash } from '../lib/trash';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const SPARE_PART_FIELDS = ['sku', 'name', 'description', 'category', 'productModel', 'partType', 'location', 'warehouseId', 'minStock', 'unitPrice', 'supplier', 'status', 'sourceFile', 'sourceSheet'] as const;
const FIXED_WAREHOUSE_NAMES = ['OZONE-BKK', 'OZONE-CNX'] as const;

function normalizePlainDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) return `${String(Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3])).padStart(4, '0')}-${String(Number(slash[2])).padStart(2, '0')}-${String(Number(slash[1])).padStart(2, '0')}`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
}

// Recomputes SparePart.stock from the tracked SN rows. Only call this from paths that
// added/removed a SparePartItem — parts managed without SN tracking legitimately have zero
// rows and a non-zero stock, and calling it there silently zeroes their stock.
async function syncTrackedStock(db: ReturnType<typeof getDb>, sparePartId: string): Promise<number> {
  const result = await db.select({ count: sql<number>`count(*)` }).from(sparePartItems).where(eq(sparePartItems.sparePartId, sparePartId));
  const count = Number(result[0]?.count ?? 0);
  await db.update(spareParts).set({ stock: count }).where(eq(spareParts.id, sparePartId));
  return count;
}

export const sparePartsRoutes = new Hono<AppEnv>();

// `?withWarehouseStock=1` adds the per-warehouse SN breakdown. It is opt-in because building it
// scans every SparePartItem row in the database, and only the Warehouses page uses it — the
// session-wide prefetch in DataContext was paying for that scan on every login.
sparePartsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const withWarehouseStock = c.req.query('withWarehouseStock') === '1';
  const tables: CachedTable[] = withWarehouseStock ? ['SparePart', 'Warehouse', 'SparePartItem'] : ['SparePart', 'Warehouse'];
  return cachedJson(c, withWarehouseStock ? 'spare-parts:warehouse-stock' : 'spare-parts', tables, async () => {
    const rows = await db.select().from(spareParts).orderBy(asc(spareParts.name));
    const whs = await db.select({ id: warehouses.id, name: warehouses.name }).from(warehouses);
    const whMap = new Map(whs.map((w) => [w.id, w]));
    const itemRows = withWarehouseStock
      ? await db.select({ sparePartId: sparePartItems.sparePartId, warehouseId: sparePartItems.warehouseId }).from(sparePartItems)
      : [];
    const warehouseIdsByPart = new Map<string, string[]>();
    const warehouseStockByPart = new Map<string, Record<string, number>>();
    for (const item of itemRows) {
      if (!item.warehouseId) continue;
      const ids = warehouseIdsByPart.get(item.sparePartId) || [];
      if (!ids.includes(item.warehouseId)) ids.push(item.warehouseId);
      warehouseIdsByPart.set(item.sparePartId, ids);
      const stockByWarehouse = warehouseStockByPart.get(item.sparePartId) || {};
      stockByWarehouse[item.warehouseId] = (stockByWarehouse[item.warehouseId] || 0) + 1;
      warehouseStockByPart.set(item.sparePartId, stockByWarehouse);
    }
    return rows.map((p) => ({
      ...p,
      warehouse: p.warehouseId ? whMap.get(p.warehouseId) ?? null : null,
      ...(withWarehouseStock ? {
        warehouseIds: warehouseIdsByPart.get(p.id) || (p.warehouseId ? [p.warehouseId] : []),
        warehouseStock: warehouseStockByPart.get(p.id) || (p.warehouseId ? { [p.warehouseId]: p.stock } : {}),
      } : {}),
    }));
  });
});

// Stock counts + low-stock list for the dashboard and sidebar badge, so the app shell
// doesn't need to download the whole ~1.4k-part catalog on every login.
sparePartsRoutes.get('/summary', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  return cachedJson(c, 'spare-parts:summary', ['SparePart'], async () => {
    const isLow = sql`${spareParts.minStock} > 0 and ${spareParts.stock} <= ${spareParts.minStock}`;
    const [counts] = await db.select({
      total: sql<number>`count(*)`,
      outOfStock: sql<number>`coalesce(sum(case when ${spareParts.minStock} > 0 and ${spareParts.stock} <= 0 then 1 else 0 end), 0)`,
      inStock: sql<number>`coalesce(sum(case when ${spareParts.stock} > 0 then 1 else 0 end), 0)`,
      tracked: sql<number>`coalesce(sum(case when ${spareParts.minStock} > 0 then 1 else 0 end), 0)`,
      stockRisk: sql<number>`coalesce(sum(case when (${isLow}) or (${spareParts.minStock} > 0 and ${spareParts.stock} <= 0) then 1 else 0 end), 0)`,
    }).from(spareParts);
    const lowStock = await db.select({ id: spareParts.id, sku: spareParts.sku, name: spareParts.name, stock: spareParts.stock, minStock: spareParts.minStock })
      .from(spareParts).where(isLow).orderBy(asc(spareParts.name));
    return {
      total: Number(counts?.total ?? 0),
      outOfStock: Number(counts?.outOfStock ?? 0),
      inStock: Number(counts?.inStock ?? 0),
      tracked: Number(counts?.tracked ?? 0),
      stockRisk: Number(counts?.stockRisk ?? 0),
      lowStock,
    };
  });
});

sparePartsRoutes.get('/:id/items', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, c.req.param('id')) });
  if (!part) return c.json({ error: 'Not found' }, 404);
  const items = await db.select().from(sparePartItems)
    .where(eq(sparePartItems.sparePartId, c.req.param('id')))
    .orderBy(asc(sparePartItems.receivedDate), asc(sparePartItems.createdAt));
  return c.json({ part, items, trackedCount: items.length });
});

sparePartsRoutes.post('/:id/items', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, id) });
  if (!part) return c.json({ error: 'ไม่พบอะไหล่' }, 404);
  const body = await c.req.json<{ serialNumber?: unknown; receivedDate?: unknown; warehouseId?: unknown; notes?: unknown }>();
  const serialNumber = String(body.serialNumber ?? '').trim();
  const receivedDate = normalizePlainDate(body.receivedDate);
  const warehouseId = String(body.warehouseId ?? '').trim();
  const notes = body.notes === null || body.notes === undefined ? null : String(body.notes).trim() || null;
  if (!serialNumber) return c.json({ error: 'กรุณากรอก SN' }, 400);
  if (!receivedDate) return c.json({ error: 'กรุณากรอกวันที่นำของเข้า' }, 400);
  if (!warehouseId) return c.json({ error: 'กรุณาเลือกคลังสำหรับการรับอะไหล่เข้า' }, 400);

  const warehouse = await db.query.warehouses.findFirst({ where: eq(warehouses.id, warehouseId) });
  if (!warehouse || !FIXED_WAREHOUSE_NAMES.includes(warehouse.name as typeof FIXED_WAREHOUSE_NAMES[number])) {
    return c.json({ error: 'กรุณาเลือกคลังที่รองรับ' }, 400);
  }

  const existing = await db.query.sparePartItems.findFirst({
    where: and(eq(sparePartItems.sparePartId, id), eq(sparePartItems.serialNumber, serialNumber)),
  });
  if (!existing) {
    // The unique index only covers (sparePartId, serialNumber), so the same SN can land under
    // two SKUs — which permanently breaks scan-out for it (409 "พบ SN นี้มากกว่า 1 SKU").
    const claimed = await db.query.sparePartItems.findFirst({ where: eq(sparePartItems.serialNumber, serialNumber) });
    if (claimed) {
      const owner = await db.query.spareParts.findFirst({ where: eq(spareParts.id, claimed.sparePartId) });
      return c.json({ error: `SN นี้ถูกใช้กับอะไหล่อื่นแล้ว (${owner?.sku ?? claimed.sparePartId})` }, 409);
    }
  }
  const itemId = existing?.id ?? randomUUID();
  if (existing) {
    await db.update(sparePartItems).set({ receivedDate, warehouseId, notes }).where(eq(sparePartItems.id, existing.id));
  } else {
    await db.insert(sparePartItems).values({ id: itemId, sparePartId: id, serialNumber, receivedDate, warehouseId, notes });
  }
  await db.update(spareParts).set({ warehouseId: warehouse.id, location: warehouse.name }).where(eq(spareParts.id, id));
  const stock = await syncTrackedStock(db, id);
  const item = await db.query.sparePartItems.findFirst({ where: eq(sparePartItems.id, itemId) });
  await logActivity(db, {
    entityType: 'SparePart', entityId: id, entityName: part.name,
    action: existing ? 'item_updated' : 'item_created',
    performedBy: user.username,
  });
  return c.json({ item, stock }, existing ? 200 : 201);
});

sparePartsRoutes.get('/scan-out/search', authenticate, requireAdmin, async (c) => {
  const query = String(c.req.query('query') ?? '').trim();
  if (query.length < 5) return c.json({ error: 'กรุณาระบุคำค้นอย่างน้อย 5 ตัวอักษร' }, 400);
  const db = getDb(c.env.DB);
  const items = await db.select().from(sparePartItems)
    .where(like(sparePartItems.serialNumber, `%${query}%`))
    .orderBy(asc(sparePartItems.serialNumber))
    .limit(20);
  return c.json({ items });
});

sparePartsRoutes.post('/scan-out', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const body = await c.req.json<{ serialNumber?: unknown; details?: unknown; note?: unknown; description?: unknown; reason?: unknown; customerId?: unknown }>();
  const serialNumber = String(body.serialNumber ?? '').trim();
  const details = String(body.details ?? body.note ?? body.description ?? body.reason ?? '').trim();
  const customerId = String(body.customerId ?? '').trim();
  if (!serialNumber) return c.json({ error: 'กรุณากรอก SN' }, 400);

  const matches = await db.select().from(sparePartItems).where(eq(sparePartItems.serialNumber, serialNumber));
  if (matches.length === 0) return c.json({ error: 'ไม่พบ SN นี้ในคลังอะไหล่' }, 404);
  if (matches.length > 1) return c.json({ error: 'พบ SN นี้มากกว่า 1 SKU กรุณาตรวจสอบข้อมูลก่อนนำออก' }, 409);

  const item = matches[0];
  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, item.sparePartId) });
  if (!part) return c.json({ error: 'ไม่พบอะไหล่ของ SN นี้' }, 404);
  const customer = customerId ? await db.query.customers.findFirst({ where: eq(customers.id, customerId) }) : null;
  if (customerId && !customer) return c.json({ error: 'ไม่พบลูกค้าที่เลือก' }, 404);

  await db.delete(sparePartItems).where(eq(sparePartItems.id, item.id));
  const stock = await syncTrackedStock(db, part.id);
  const updatedPart = await db.query.spareParts.findFirst({ where: eq(spareParts.id, part.id) });

  await logActivity(db, {
    entityType: 'SparePart',
    entityId: part.id,
    entityName: part.name,
    action: 'item_scanned_out',
    oldValues: { serialNumber: item.serialNumber, receivedDate: item.receivedDate, stock: part.stock },
    newValues: {
      stock,
      ...(details ? { details } : {}),
      ...(customer ? { customerId: customer.id, customerName: customer.name } : {}),
    },
    performedBy: user.username,
  });

  return c.json({
    success: true,
    part: updatedPart,
    item: { id: item.id, serialNumber: item.serialNumber, receivedDate: item.receivedDate, sparePartId: item.sparePartId },
    stock,
  });
});

sparePartsRoutes.put('/:id/items/:itemId', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const existing = await db.query.sparePartItems.findFirst({ where: eq(sparePartItems.id, c.req.param('itemId')) });
  if (!existing || existing.sparePartId !== id) return c.json({ error: 'ไม่พบรายการ SN' }, 404);
  const body = await c.req.json<{ serialNumber?: unknown; receivedDate?: unknown; notes?: unknown }>();
  const serialNumber = String(body.serialNumber ?? existing.serialNumber).trim();
  const receivedDate = normalizePlainDate(body.receivedDate) ?? existing.receivedDate;
  const notes = body.notes === null || body.notes === undefined ? (existing.notes ?? null) : String(body.notes).trim() || null;
  if (!serialNumber) return c.json({ error: 'กรุณากรอก SN' }, 400);
  const duplicate = await db.query.sparePartItems.findFirst({
    where: and(eq(sparePartItems.sparePartId, id), eq(sparePartItems.serialNumber, serialNumber)),
  });
  if (duplicate && duplicate.id !== existing.id) return c.json({ error: 'SN นี้มีอยู่แล้วใน SKU นี้' }, 409);
  await db.update(sparePartItems).set({ serialNumber, receivedDate, notes }).where(eq(sparePartItems.id, existing.id));
  const stock = await syncTrackedStock(db, id);
  const item = await db.query.sparePartItems.findFirst({ where: eq(sparePartItems.id, existing.id) });
  await logActivity(db, {
    entityType: 'SparePart', entityId: id, entityName: null,
    action: 'item_updated', performedBy: user.username,
  });
  return c.json({ item, stock });
});

sparePartsRoutes.delete('/:id/items/:itemId', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const id = c.req.param('id');
  const existing = await db.query.sparePartItems.findFirst({ where: eq(sparePartItems.id, c.req.param('itemId')) });
  if (!existing || existing.sparePartId !== id) return c.json({ error: 'ไม่พบรายการ SN' }, 404);
  await db.delete(sparePartItems).where(eq(sparePartItems.id, existing.id));
  const stock = await syncTrackedStock(db, id);
  await logActivity(db, {
    entityType: 'SparePart', entityId: id, entityName: null,
    action: 'item_deleted', performedBy: user.username,
  });
  return c.json({ success: true, stock });
});

sparePartsRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const data = pickFields<typeof spareParts.$inferInsert>(body, SPARE_PART_FIELDS);
  if (!data.sku || !data.name) return c.json({ error: 'sku and name are required' }, 400);
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(spareParts).values({ id: newId, sku: data.sku, name: data.name, ...data, stock: 0 });
  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, newId) });
  await logActivity(db, {
    entityType: 'SparePart', entityId: newId, entityName: part!.name,
    action: 'created', performedBy: user.username,
  });
  return c.json(part, 201);
});

sparePartsRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = pickFields<typeof spareParts.$inferInsert>(body, SPARE_PART_FIELDS);
  const db = getDb(c.env.DB);
  const old = await db.query.spareParts.findFirst({ where: eq(spareParts.id, id) });
  await db.update(spareParts).set(data).where(eq(spareParts.id, id));
  // Keep legacy snapshots in documents aligned with the spare-part catalog.
  // New screens also resolve names by sparePartId, but this cascade preserves
  // consistency for existing documents, exports, and print views.
  if (old && typeof data.name === 'string' && data.name !== old.name) {
    await db.update(purchaseOrderItems).set({ partName: data.name }).where(eq(purchaseOrderItems.sparePartId, id));
    await db.update(materialRequestItems).set({ partName: data.name }).where(eq(materialRequestItems.sparePartId, id));
    await db.update(deliveryNoteItems).set({ description: data.name }).where(eq(deliveryNoteItems.sparePartId, id));
  }
  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, id) });
  // Notify when stock crosses below the minimum threshold.
  if (old && part && part.minStock > 0 && part.stock <= part.minStock && old.stock > part.minStock) {
    const title = part.stock <= 0 ? `อะไหล่หมดสต๊อก: ${part.name}` : `อะไหล่สต๊อกต่ำ: ${part.name}`;
    await createNotification(db, 'low_stock', title, `${part.name} (${part.sku}) เหลือ ${part.stock} ชิ้น (ต่ำกว่า min ${part.minStock})`, 'SparePart', part.id);
  }
  // Record the edited fields' before/after so a lost value (e.g. unitPrice) can be traced and restored.
  const changedKeys = old ? (Object.keys(data) as (keyof typeof old)[]).filter((k) => data[k as keyof typeof data] !== old[k]) : [];
  await logActivity(db, {
    entityType: 'SparePart', entityId: id, entityName: part?.name,
    action: 'updated', performedBy: user.username,
    oldValues: changedKeys.length && old ? Object.fromEntries(changedKeys.map((k) => [k, old[k]])) : null,
    newValues: changedKeys.length && part ? Object.fromEntries(changedKeys.map((k) => [k, part[k]])) : null,
  });
  return c.json(part);
});

sparePartsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, id) });
  if (!part) return c.json({ error: 'Not found' }, 404);
  await moveToTrash(db, {
    entityType: 'SparePart', entityId: part.id, entityName: part.name,
    entity: part, deletedBy: user.username,
  });
  await db.delete(spareParts).where(eq(spareParts.id, id));
  await logActivity(db, {
    entityType: 'SparePart', entityId: id, entityName: part.name,
    action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});

sparePartsRoutes.post('/bulk-delete', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ ids?: unknown }>();
  const ids = Array.isArray(body.ids) ? body.ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0) : [];
  if (ids.length === 0) return c.json({ error: 'ids are required' }, 400);

  const db = getDb(c.env.DB);
  const parts = await db.select().from(spareParts).where(sql`${spareParts.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`);
  if (parts.length === 0) return c.json({ error: 'No spare parts found' }, 404);

  for (const part of parts) {
    await moveToTrash(db, {
      entityType: 'SparePart',
      entityId: part.id,
      entityName: part.name,
      entity: part,
      deletedBy: user.username,
    });
    await db.delete(spareParts).where(eq(spareParts.id, part.id));
    await logActivity(db, {
      entityType: 'SparePart',
      entityId: part.id,
      entityName: part.name,
      action: 'deleted',
      performedBy: user.username,
    });
  }

  return c.json({ success: true, deleted: parts.length });
});

// Transfer spare parts directly to a customer (decrements stock, logs the transfer).
sparePartsRoutes.post('/:id/transfer', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { customerId, quantity, serialNumbers, note, robotId } = await c.req.json();
  const qty = parseInt(quantity) || 0;
  if (qty <= 0) return c.json({ error: 'จำนวนต้องมากกว่า 0' }, 400);

  const db = getDb(c.env.DB);
  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, id) });
  if (!part) return c.json({ error: 'ไม่พบอะไหล่' }, 404);
  if (part.stock < qty) return c.json({ error: `สต๊อกไม่พอ (คงเหลือ ${part.stock})` }, 400);

  const customer = customerId ? await db.query.customers.findFirst({ where: eq(customers.id, customerId) }) : null;
  const robot = robotId ? await db.query.robots.findFirst({ where: eq(robots.id, robotId) }) : null;
  if (robotId && (!robot || robot.customerId !== customerId)) return c.json({ error: 'หุ่นยนต์นี้ไม่ได้อยู่กับลูกค้าที่เลือก' }, 400);
  const tracked = await db.select().from(sparePartItems)
    .where(eq(sparePartItems.sparePartId, id))
    .orderBy(asc(sparePartItems.receivedDate), asc(sparePartItems.createdAt));
  if (tracked.length > 0) {
    if (!Array.isArray(serialNumbers) || serialNumbers.length !== qty || new Set(serialNumbers).size !== serialNumbers.length) {
      return c.json({ error: 'กรุณาเลือก SN ให้ครบตามจำนวนที่โอน' }, 400);
    }
    const selected = tracked.filter((item) => serialNumbers.includes(item.serialNumber));
    if (selected.length !== qty) return c.json({ error: 'พบ SN ที่เลือกไม่อยู่ในสต๊อกปัจจุบัน' }, 400);
    await db.delete(sparePartItems).where(sql`${sparePartItems.id} in (${sql.join(selected.map((item) => sql`${item.id}`), sql`, `)})`);
    await syncTrackedStock(db, id);
  } else {
    // ponytail: the read-then-write above is not atomic, so clamp at 0 rather than lock.
    // Move to a conditional UPDATE ... WHERE stock >= qty if oversell ever shows up in the log.
    await db.update(spareParts).set({ stock: sql`max(0, ${spareParts.stock} - ${qty})` }).where(eq(spareParts.id, id));
  }
  const updated = await db.query.spareParts.findFirst({ where: eq(spareParts.id, id) });

  await logActivity(db, {
    entityType: 'SparePart', entityId: part.id, entityName: part.name,
    action: 'transferred',
    oldValues: { stock: part.stock },
    newValues: { stock: updated!.stock, transferredQty: qty, serialNumbers: Array.isArray(serialNumbers) ? serialNumbers : [], customerId: customerId ?? null, customerName: customer?.name ?? null, robotId: robot?.id ?? null, robotSerialNumber: robot?.serialNumber ?? null, note: note ?? null },
    performedBy: user.username,
  });
  if (updated && updated.minStock > 0 && updated.stock <= updated.minStock && part.stock > updated.minStock) {
    const title = updated.stock <= 0 ? `อะไหล่หมดสต๊อก: ${updated.name}` : `อะไหล่สต๊อกต่ำ: ${updated.name}`;
    await createNotification(db, 'low_stock', title, `${updated.name} (${updated.sku}) เหลือ ${updated.stock} ชิ้น`, 'SparePart', updated.id);
  }
  return c.json({ part: updated, transferred: qty, customerName: customer?.name ?? null });
});

// Bulk upsert spare parts by SKU.
sparePartsRoutes.post('/bulk', authenticate, requireAdmin, async (c) => {
  const body = await c.req.json();
  const items: Array<Record<string, unknown>> = body.items || [];
  let created = 0, updated = 0;
  const db = getDb(c.env.DB);
  for (const item of items) {
    const data = pickFields<typeof spareParts.$inferInsert>(item, SPARE_PART_FIELDS);
    const existing = await db.query.spareParts.findFirst({ where: eq(spareParts.sku, String(item.sku)) });
    if (existing) {
      await db.update(spareParts).set(data).where(eq(spareParts.sku, String(item.sku)));
      updated++;
    } else {
      await db.insert(spareParts).values({ id: randomUUID(), sku: data.sku!, name: data.name!, ...data });
      created++;
    }
  }
  return c.json({ created, updated, total: items.length });
});
