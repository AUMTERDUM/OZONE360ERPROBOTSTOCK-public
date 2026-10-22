import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { asc, count, eq, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { warehouses, robots, spareParts, sparePartItems } from '../db/schema';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';
const FIXED_WAREHOUSE_NAMES = ['OZONE-BKK', 'OZONE-CNX'] as const;
const FIXED_WAREHOUSE_IDS: Record<typeof FIXED_WAREHOUSE_NAMES[number], string> = {
  'OZONE-BKK': 'fixed-ozone-bkk',
  'OZONE-CNX': 'fixed-ozone-cnx',
};

async function ensureFixedWarehouses(db: ReturnType<typeof getDb>) {
  const rows = await db.select().from(warehouses);
  for (const name of FIXED_WAREHOUSE_NAMES) {
    const canonicalId = FIXED_WAREHOUSE_IDS[name];
    const sameNameRows = rows.filter((row) => row.name === name);
    const canonical = sameNameRows.find((row) => row.id === canonicalId) ?? sameNameRows[0] ?? null;

    if (!canonical) {
      await db.insert(warehouses).values({ id: canonicalId, name, notes: null, parentId: null });
      continue;
    }

    if (canonical.id !== canonicalId) {
      const existingCanonical = rows.find((row) => row.id === canonicalId);
      if (!existingCanonical) {
        await db.insert(warehouses).values({ id: canonicalId, name, notes: canonical.notes ?? null, parentId: null });
      }
      await db.update(robots).set({ locationId: canonicalId }).where(eq(robots.locationId, canonical.id));
      await db.update(spareParts).set({ warehouseId: canonicalId, location: name }).where(eq(spareParts.warehouseId, canonical.id));
      await db.delete(warehouses).where(eq(warehouses.id, canonical.id));
    }

    const duplicates = rows.filter((row) => row.name === name && row.id !== canonicalId);
    for (const duplicate of duplicates) {
      await db.update(robots).set({ locationId: canonicalId }).where(eq(robots.locationId, duplicate.id));
      await db.update(spareParts).set({ warehouseId: canonicalId, location: name }).where(eq(spareParts.warehouseId, duplicate.id));
      await db.delete(warehouses).where(eq(warehouses.id, duplicate.id));
    }
  }
}

export const warehousesRoutes = new Hono<AppEnv>();

warehousesRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  await ensureFixedWarehouses(db);
  const rows = (await db.select().from(warehouses).orderBy(asc(warehouses.name))).filter((row) => FIXED_WAREHOUSE_NAMES.includes(row.name as typeof FIXED_WAREHOUSE_NAMES[number]));
  // Attach robot counts (mirrors Prisma's _count: { robots }).
  const counts = await db.select({ locationId: robots.locationId, n: count() }).from(robots).where(isNull(robots.customerId)).groupBy(robots.locationId);
  const countMap = new Map(counts.map((r) => [r.locationId, r.n]));
  return c.json(rows.map((w) => ({ ...w, _count: { robots: countMap.get(w.id) ?? 0 } })));
});

// Move a robot or an entire spare-part SKU between warehouses.
warehousesRoutes.post('/transfer', authenticate, requireAdmin, async (c) => {
  const body = await c.req.json<{ type?: unknown; itemId?: unknown; fromWarehouseId?: unknown; toWarehouseId?: unknown; serialNumbers?: unknown }>();
  const type = String(body.type ?? '').trim();
  const itemId = String(body.itemId ?? '').trim();
  const toWarehouseId = String(body.toWarehouseId ?? '').trim();
  const fromWarehouseId = String(body.fromWarehouseId ?? '').trim();
  const requestedSerialNumbers = Array.isArray(body.serialNumbers)
    ? body.serialNumbers.filter((serialNumber): serialNumber is string => typeof serialNumber === 'string')
    : [];
  if (!['robot', 'part'].includes(type) || !itemId || !toWarehouseId) return c.json({ error: 'ข้อมูลการโอนไม่ครบถ้วน' }, 400);

  const db = getDb(c.env.DB);
  const destination = await db.query.warehouses.findFirst({ where: eq(warehouses.id, toWarehouseId) });
  if (!destination) return c.json({ error: 'ไม่พบคลังปลายทาง' }, 404);

  if (type === 'robot') {
    const robot = await db.query.robots.findFirst({ where: eq(robots.id, itemId) });
    if (!robot) return c.json({ error: 'ไม่พบหุ่นยนต์' }, 404);
    if (robot.customerId) return c.json({ error: 'หุ่นยนต์ที่ส่งให้ลูกค้าแล้วไม่สามารถอยู่ในคลังได้' }, 400);
    if (robot.locationId === destination.id) return c.json({ error: 'หุ่นยนต์อยู่ในคลังนี้อยู่แล้ว' }, 400);
    await db.update(robots).set({ locationId: destination.id }).where(eq(robots.id, robot.id));
    return c.json({ success: true, type, itemId: robot.id, warehouseId: destination.id, warehouseName: destination.name });
  }

  const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, itemId) });
  if (!part) return c.json({ error: 'ไม่พบอะไหล่' }, 404);
  if (part.warehouseId === destination.id) return c.json({ error: 'อะไหล่อยู่ในคลังนี้อยู่แล้ว' }, 400);
  const tracked = await db.select().from(sparePartItems).where(eq(sparePartItems.sparePartId, part.id));
  if (tracked.length > 0) {
    if (!fromWarehouseId) return c.json({ error: 'กรุณาระบุคลังต้นทาง' }, 400);
    if (requestedSerialNumbers.length === 0 || new Set(requestedSerialNumbers).size !== requestedSerialNumbers.length) return c.json({ error: 'กรุณาเลือก SN ที่ต้องการโอน' }, 400);
    const selected = tracked.filter((item) => item.warehouseId === fromWarehouseId && requestedSerialNumbers.includes(item.serialNumber));
    if (selected.length !== requestedSerialNumbers.length) return c.json({ error: 'พบ SN ที่เลือกไม่อยู่ในคลังต้นทาง' }, 400);
    await db.update(sparePartItems).set({ warehouseId: destination.id }).where(sql`${sparePartItems.id} in (${sql.join(selected.map((item) => sql`${item.id}`), sql`, `)})`);
    const remaining = await db.select({ warehouseId: sparePartItems.warehouseId }).from(sparePartItems).where(eq(sparePartItems.sparePartId, part.id));
    const locations = [...new Set(remaining.map((item) => item.warehouseId).filter(Boolean))] as string[];
    await db.update(spareParts).set({ warehouseId: locations.length === 1 ? locations[0] : null, location: locations.length === 1 ? destination.name : 'หลายคลัง' }).where(eq(spareParts.id, part.id));
  } else {
    await db.update(spareParts).set({ warehouseId: destination.id, location: destination.name }).where(eq(spareParts.id, part.id));
  }
  return c.json({ success: true, type, itemId: part.id, warehouseId: destination.id, warehouseName: destination.name });
});

warehousesRoutes.post('/', authenticate, requireAdmin, async (c) => {
  return c.json({ error: 'คลังสินค้าถูกกำหนดตายตัวเป็น OZONE-BKK และ OZONE-CNX' }, 403);
});

warehousesRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  return c.json({ error: 'ไม่อนุญาตให้แก้ไขคลังตายตัวของระบบ' }, 403);
});

warehousesRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  return c.json({ error: 'ไม่อนุญาตให้ลบคลังตายตัวของระบบ' }, 403);
});
