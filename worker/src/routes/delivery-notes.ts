import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc, sql, asc, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { deliveryNotes, deliveryNoteItems, spareParts, sparePartItems, robots, customers } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { moveToTrash } from '../lib/trash';
import { createMaintenanceTicketFromInput, setupDeliveredRobots } from '../lib/maintenance';
import { isValidTransition, DN_TRANSITIONS } from '../lib/transitions';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

const DN_FIELDS = ['docNumber', 'customerId', 'deliveryDate', 'status', 'recipientName', 'recipientDate', 'senderName', 'notes', 'installedAt', 'acceptedAt', 'trackingNumber'] as const;

function normalizeSerials(serialNumbers: unknown): string {
  if (Array.isArray(serialNumbers)) return JSON.stringify(serialNumbers);
  return (serialNumbers as string) || '[]';
}

function parseSerialList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
    } catch { return []; }
  }
  return [];
}

async function syncPartStock(db: Db, partId: string) {
  const rows = await db.select({ id: sparePartItems.id }).from(sparePartItems).where(eq(sparePartItems.sparePartId, partId));
  await db.update(spareParts).set({ stock: rows.length }).where(eq(spareParts.id, partId));
}

// Spare-part lines picked by serial number must reference SNs that are in stock (or already on this note).
async function validatePartSerials(db: Db, items: any[], noteId?: string): Promise<string | null> {
  const oldSerialsByPart = new Map<string, Set<string>>();
  if (noteId) {
    const oldItems = await db.select().from(deliveryNoteItems).where(eq(deliveryNoteItems.deliveryNoteId, noteId));
    for (const old of oldItems) {
      if (!old.sparePartId) continue;
      const set = oldSerialsByPart.get(old.sparePartId) ?? new Set<string>();
      parseSerialList(old.serialNumbers).forEach((sn) => set.add(sn));
      oldSerialsByPart.set(old.sparePartId, set);
    }
  }
  for (const item of items || []) {
    const serials = item.sparePartId ? parseSerialList(item.serialNumbers) : [];
    if (serials.length === 0) continue;
    if (new Set(serials).size !== serials.length) return 'พบ SN ซ้ำในรายการอะไหล่';
    const inStock = new Set((await db.select({ sn: sparePartItems.serialNumber }).from(sparePartItems).where(eq(sparePartItems.sparePartId, item.sparePartId))).map((r) => r.sn));
    const missing = serials.filter((sn) => !inStock.has(sn) && !oldSerialsByPart.get(item.sparePartId)?.has(sn));
    if (missing.length) return `SN ไม่อยู่ในสต๊อก: ${missing.join(', ')}`;
  }
  return null;
}

// Stock leaves a part by the picked SNs, else by its oldest tracked SNs, else by plain quantity.
async function consumePartStock(db: Db, partId: string, quantity: number, serials: string[]) {
  const tracked = await db.select().from(sparePartItems).where(eq(sparePartItems.sparePartId, partId))
    .orderBy(asc(sparePartItems.receivedDate), asc(sparePartItems.createdAt));
  if (tracked.length === 0) {
    await db.update(spareParts).set({ stock: sql`${spareParts.stock} - ${quantity}` }).where(eq(spareParts.id, partId));
    return;
  }
  const chosen = serials.length ? tracked.filter((row) => serials.includes(row.serialNumber)) : tracked.slice(0, quantity);
  // D1 caps bound parameters per statement, so delete in small batches.
  for (let i = 0; i < chosen.length; i += 40) {
    await db.delete(sparePartItems).where(inArray(sparePartItems.id, chosen.slice(i, i + 40).map((row) => row.id)));
  }
  await syncPartStock(db, partId);
}

async function insertItems(db: Db, noteId: string, items: any[]) {
  for (const item of items || []) {
    const serials = item.sparePartId ? parseSerialList(item.serialNumbers) : [];
    const quantity = serials.length > 0 ? serials.length : Number(item.quantity);
    await db.insert(deliveryNoteItems).values({
      id: randomUUID(),
      deliveryNoteId: noteId,
      description: item.description,
      quantity,
      remark: item.remark || null,
      serialNumbers: normalizeSerials(item.serialNumbers),
      sparePartId: item.sparePartId || null,
    });
    if (item.sparePartId) await consumePartStock(db, item.sparePartId, quantity, serials);
  }
}

async function restoreItemStock(db: Db, noteId: string) {
  const oldItems = await db.select().from(deliveryNoteItems).where(eq(deliveryNoteItems.deliveryNoteId, noteId));
  for (const old of oldItems) {
    if (!old.sparePartId) continue;
    const serials = parseSerialList(old.serialNumbers);
    const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, old.sparePartId) });
    if (!part) continue;
    if (serials.length > 0) {
      // Put the picked serial numbers back into stock (their original received date is not kept).
      const existing = new Set((await db.select({ sn: sparePartItems.serialNumber }).from(sparePartItems).where(eq(sparePartItems.sparePartId, part.id))).map((r) => r.sn));
      const today = new Date().toISOString().slice(0, 10);
      const missing = serials.filter((sn) => !existing.has(sn));
      for (let i = 0; i < missing.length; i += 20) {
        await db.insert(sparePartItems).values(missing.slice(i, i + 20).map((serialNumber) => ({
          id: randomUUID(), sparePartId: part.id, serialNumber, receivedDate: today, warehouseId: part.warehouseId, notes: 'คืนจากใบส่งของ',
        })));
      }
      await syncPartStock(db, part.id);
    } else {
      await db.update(spareParts).set({ stock: sql`${spareParts.stock} + ${old.quantity}` }).where(eq(spareParts.id, old.sparePartId));
    }
  }
}

async function fullNote(db: Db, id: string) {
  const note = await db.query.deliveryNotes.findFirst({
    where: eq(deliveryNotes.id, id),
    with: { customer: true, items: true },
  });
  if (!note) return note;
  const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts);
  const names = new Map(parts.map((part) => [part.id, part.name]));
  return { ...note, items: note.items.map((item) => ({
    ...item, description: item.sparePartId ? (names.get(item.sparePartId) || item.description) : item.description,
  })) };
}

// When a delivery note is completed, hand its robots and spare parts over to the customer:
// robots move to the customer, and spare parts are logged as held by the customer
// (their stock was already deducted when the note was created).
async function transferNoteItemsToCustomer(db: Db, note: { id: string; docNumber: string; customerId: string }, username: string) {
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, note.customerId) });
  const items = await db.select().from(deliveryNoteItems).where(eq(deliveryNoteItems.deliveryNoteId, note.id));
  for (const item of items) {
    if (!item.sparePartId) continue;
    const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, item.sparePartId) });
    await logActivity(db, {
      entityType: 'SparePart', entityId: item.sparePartId, entityName: part?.name,
      action: 'transferred',
      newValues: {
        transferredQty: item.quantity, serialNumbers: parseSerialList(item.serialNumbers), customerId: note.customerId, customerName: customer?.name ?? null,
        note: `ใบส่งของ ${note.docNumber}`, deliveryNoteId: note.id,
      },
      performedBy: username,
    });
  }
  await transferNoteRobotsToCustomer(db, note, username);
}

// Moves a note's robots to its customer and returns the ids of every robot on the note.
// Safe to call twice: robots already at the customer are left alone.
async function transferNoteRobotsToCustomer(db: Db, note: { id: string; docNumber: string; customerId: string }, username: string): Promise<string[]> {
  const items = await db.select().from(deliveryNoteItems).where(eq(deliveryNoteItems.deliveryNoteId, note.id));
  const robotIds: string[] = [];
  for (const item of items) {
    if (item.sparePartId) continue;
    let serials: string[] = [];
    try { serials = JSON.parse(item.serialNumbers || '[]'); } catch { /* ignore */ }
    for (const sn of serials) {
      const robot = await db.query.robots.findFirst({ where: eq(robots.serialNumber, sn) });
      if (!robot) continue;
      robotIds.push(robot.id);
      if (robot.customerId === note.customerId) continue;
      const nextStatus = robot.status === 'In Stock' ? 'Assigned' : robot.status;
      await db.update(robots).set({ customerId: note.customerId, status: nextStatus }).where(eq(robots.id, robot.id));
      await logActivity(db, {
        entityType: 'Robot', entityId: robot.id, entityName: robot.serialNumber,
        action: nextStatus !== robot.status ? 'status_changed' : 'updated',
        oldValues: { status: robot.status, customerId: robot.customerId },
        newValues: { status: nextStatus, customerId: note.customerId, deliveryNote: note.docNumber },
        performedBy: username,
      });
    }
  }
  return robotIds;
}

export const deliveryNotesRoutes = new Hono<AppEnv>();

deliveryNotesRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const notes = await db.query.deliveryNotes.findMany({
    orderBy: desc(deliveryNotes.createdAt),
    with: { customer: { columns: { id: true, name: true } }, items: true },
  });
  const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts);
  const names = new Map(parts.map((part) => [part.id, part.name]));
  return c.json(notes.map((note) => ({ ...note, items: note.items.map((item) => ({
    ...item, description: item.sparePartId ? (names.get(item.sparePartId) || item.description) : item.description,
  })) })));
});

deliveryNotesRoutes.get('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const note = await fullNote(db, c.req.param('id'));
  if (!note) return c.json({ error: 'Not found' }, 404);
  return c.json(note);
});

deliveryNotesRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { items } = body;
  if (!body.docNumber || !body.customerId || !body.deliveryDate) {
    return c.json({ error: 'docNumber, customerId, and deliveryDate are required' }, 400);
  }
  const db = getDb(c.env.DB);
  const serialError = await validatePartSerials(db, items);
  if (serialError) return c.json({ error: serialError }, 400);
  const newId = randomUUID();
  const data: Record<string, unknown> = { id: newId, createdBy: user.username };
  for (const f of DN_FIELDS) if (f in body) data[f] = body[f];
  await db.insert(deliveryNotes).values(data as typeof deliveryNotes.$inferInsert);
  await insertItems(db, newId, items);
  await logActivity(db, {
    entityType: 'DeliveryNote', entityId: newId, entityName: body.docNumber,
    action: 'created', newValues: { docNumber: body.docNumber, customerId: body.customerId }, performedBy: user.username,
  });
  return c.json(await fullNote(db, newId), 201);
});

deliveryNotesRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { items } = body;
  const db = getDb(c.env.DB);
  const serialError = await validatePartSerials(db, items, id);
  if (serialError) return c.json({ error: serialError }, 400);
  await restoreItemStock(db, id);
  await db.delete(deliveryNoteItems).where(eq(deliveryNoteItems.deliveryNoteId, id));
  const data: Record<string, unknown> = {};
  for (const f of DN_FIELDS) if (f in body) data[f] = body[f];
  if (Object.keys(data).length) await db.update(deliveryNotes).set(data).where(eq(deliveryNotes.id, id));
  await insertItems(db, id, items);
  await logActivity(db, {
    entityType: 'DeliveryNote', entityId: id, entityName: body.docNumber,
    action: 'updated', performedBy: user.username,
  });
  return c.json(await fullNote(db, id));
});

deliveryNotesRoutes.patch('/:id/status', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status } = await c.req.json();
  const valid = ['Pending', 'Packed', 'In Transit', 'Delivered', 'Accepted', 'Invoiced'];
  if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400);

  const db = getDb(c.env.DB);
  const existing = await db.query.deliveryNotes.findFirst({ where: eq(deliveryNotes.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (!isValidTransition(DN_TRANSITIONS, existing.status, status)) {
    return c.json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${existing.status}" เป็น "${status}" ได้` }, 400);
  }
  const updateData: Record<string, unknown> = { status };
  const today = new Date().toISOString().split('T')[0];
  if (status === 'Accepted') updateData.acceptedAt = today;
  if (status === 'Delivered') updateData.installedAt = today;
  await db.update(deliveryNotes).set(updateData).where(eq(deliveryNotes.id, id));

  // On delivery, auto-create install/setup tickets for each robot found by serial number.
  if (status === 'Delivered') {
    const dnItems = await db.select().from(deliveryNoteItems).where(eq(deliveryNoteItems.deliveryNoteId, id));
    for (const item of dnItems) {
      let serials: string[] = [];
      try { serials = JSON.parse(item.serialNumbers || '[]'); } catch { /* ignore */ }
      for (const sn of serials) {
        const robot = await db.query.robots.findFirst({ where: eq(robots.serialNumber, sn) });
        if (robot) {
          await createMaintenanceTicketFromInput(db, {
            robotId: robot.id, customerId: existing.customerId,
            issueDescription: `Installation / Setup after delivery (${existing.docNumber})`,
            status: 'Pending', priorityLevel: 'Normal',
          }, user.username);
        }
      }
    }
  }
  // Customer accepted the install: the robots are now theirs, the warranty starts, and an MA plan covers them.
  if (status === 'Accepted') {
    const robotIds = await transferNoteRobotsToCustomer(db, existing, user.username);
    await setupDeliveredRobots(db, {
      customerId: existing.customerId, robotIds, docNumber: existing.docNumber,
      installedAt: existing.installedAt || today,
    }, user.username);
  }
  if (status === 'Invoiced') await transferNoteItemsToCustomer(db, existing, user.username);
  await logActivity(db, {
    entityType: 'DeliveryNote', entityId: id, entityName: existing.docNumber,
    action: 'status_changed', oldValues: { status: existing.status }, newValues: { status }, performedBy: user.username,
  });
  return c.json(await fullNote(db, id));
});

deliveryNotesRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const note = await fullNote(db, id);
  if (!note) return c.json({ error: 'Not found' }, 404);
  await restoreItemStock(db, id);
  await moveToTrash(db, {
    entityType: 'DeliveryNote', entityId: note.id, entityName: note.docNumber,
    entity: note, deletedBy: user.username,
  });
  await db.delete(deliveryNotes).where(eq(deliveryNotes.id, id));
  await logActivity(db, {
    entityType: 'DeliveryNote', entityId: id, entityName: note.docNumber,
    action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});
