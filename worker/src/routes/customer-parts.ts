import { Hono } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { activityLogs, customers, spareParts } from '../db/schema';
import { authenticate } from '../middleware/auth';
import type { AppEnv } from '../types';

export const customerPartsRoutes = new Hono<AppEnv>();

const parseJson = (value: string | null): Record<string, any> => {
  if (!value) return {};
  try { return JSON.parse(value) ?? {}; } catch { return {}; }
};

// Every spare part that left stock via "transfer to customer" or "scan out", flattened from the activity log.
// Entries with a customerId are parts held by that customer; the rest are plain take-outs with details.
customerPartsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const logs = await db.select().from(activityLogs)
    .where(and(eq(activityLogs.entityType, 'SparePart'), inArray(activityLogs.action, ['transferred', 'item_scanned_out'])))
    .orderBy(desc(activityLogs.performedAt))
    .limit(5000);
  const [partRows, customerRows] = await Promise.all([
    db.select({ id: spareParts.id, sku: spareParts.sku, name: spareParts.name }).from(spareParts),
    db.select({ id: customers.id, name: customers.name }).from(customers),
  ]);
  const partById = new Map(partRows.map((part) => [part.id, part]));
  const customerNameById = new Map(customerRows.map((customer) => [customer.id, customer.name]));

  return c.json(logs.map((log) => {
    const oldValues = parseJson(log.oldValues);
    const newValues = parseJson(log.newValues);
    const isTransfer = log.action === 'transferred';
    const serialNumbers: string[] = isTransfer
      ? (Array.isArray(newValues.serialNumbers) ? newValues.serialNumbers : [])
      : (oldValues.serialNumber ? [String(oldValues.serialNumber)] : []);
    const customerId: string | null = newValues.customerId || null;
    const part = partById.get(log.entityId);
    return {
      id: log.id,
      action: log.action,
      performedAt: log.performedAt,
      performedBy: log.performedBy,
      partId: log.entityId,
      sku: part?.sku ?? null,
      partName: part?.name ?? log.entityName ?? '-',
      quantity: isTransfer ? (Number(newValues.transferredQty) || serialNumbers.length) : 1,
      serialNumbers,
      customerId,
      customerName: (customerId && customerNameById.get(customerId)) || newValues.customerName || null,
      robotSerialNumber: newValues.robotSerialNumber || null,
      note: (isTransfer ? newValues.note : newValues.details) || null,
    };
  }));
});
