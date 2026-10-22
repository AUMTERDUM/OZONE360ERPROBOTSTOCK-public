import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  trashItems, robots, customers, robotModels, spareParts, deliveryNotes, deliveryNoteItems,
} from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

export const trashRoutes = new Hono<AppEnv>();

trashRoutes.get('/', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const items = await db.select().from(trashItems).orderBy(desc(trashItems.deletedAt));
  return c.json(items);
});

// Restore an entity from a JSON snapshot back into its live table.
async function restoreEntity(db: Db, entityType: string, data: any): Promise<boolean> {
  switch (entityType) {
    case 'Robot':
      await db.insert(robots).values({
        id: data.id, serialNumber: data.serialNumber, status: data.status, purchaseDate: data.purchaseDate,
        modelId: data.modelId, customerId: data.customerId ?? null, locationId: data.locationId ?? null,
        notes: data.notes ?? null, warrantyExpiresAt: data.warrantyExpiresAt ?? null,
        puduMac: data.puduMac ?? null, archivedAt: data.archivedAt ?? null,
      });
      return true;
    case 'Customer':
      await db.insert(customers).values({
        id: data.id, name: data.name, contactPerson: data.contactPerson, email: data.email,
        phone: data.phone, address: data.address, logoUrl: data.logoUrl ?? null,
        puduShopId: data.puduShopId ?? null, puduCompanyId: data.puduCompanyId ?? null,
      });
      return true;
    case 'RobotModel':
      await db.insert(robotModels).values({
        id: data.id, name: data.name, type: data.type, payloadCapacity: data.payloadCapacity,
        batteryLife: data.batteryLife, imageUrl: data.imageUrl ?? null, puduProductCode: data.puduProductCode ?? null,
      });
      return true;
    case 'SparePart':
      await db.insert(spareParts).values({
        id: data.id, sku: data.sku, name: data.name, description: data.description ?? null,
        category: data.category ?? null, productModel: data.productModel ?? null, partType: data.partType ?? null,
        location: data.location ?? null, stock: data.stock ?? 0,
        minStock: data.minStock ?? 0, unitPrice: data.unitPrice ?? 0, supplier: data.supplier ?? null,
        status: data.status ?? null, sourceFile: data.sourceFile ?? null, sourceSheet: data.sourceSheet ?? null,
      });
      return true;
    case 'DeliveryNote': {
      const { items } = data;
      await db.insert(deliveryNotes).values({
        id: data.id, docNumber: data.docNumber, deliveryDate: data.deliveryDate, customerId: data.customerId,
        recipientName: data.recipientName ?? null, senderName: data.senderName ?? null,
        notes: data.notes ?? null, createdBy: data.createdBy ?? null,
        ...(data.createdAt ? { createdAt: data.createdAt } : {}),
      });
      for (const it of (items || [])) {
        await db.insert(deliveryNoteItems).values({
          id: randomUUID(), deliveryNoteId: data.id, description: it.description,
          quantity: it.quantity, remark: it.remark ?? null, serialNumbers: it.serialNumbers,
        });
      }
      return true;
    }
    default:
      return false;
  }
}

trashRoutes.post('/:id/restore', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const trashItem = await db.query.trashItems.findFirst({ where: eq(trashItems.id, id) });
  if (!trashItem) return c.json({ error: 'Trash item not found' }, 404);
  const data = JSON.parse(trashItem.entityData);
  try {
    const ok = await restoreEntity(db, trashItem.entityType, data);
    if (!ok) return c.json({ error: 'Unsupported entity type' }, 400);
    await db.delete(trashItems).where(eq(trashItems.id, id));
    await logActivity(db, {
      entityType: trashItem.entityType, entityId: trashItem.entityId,
      entityName: trashItem.entityName, action: 'restored', performedBy: user.username,
    });
    return c.json({ success: true });
  } catch (err) {
    return c.json({ error: (err instanceof Error && err.message) || 'Restore failed — item may already exist or have conflicts' }, 409);
  }
});

trashRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(trashItems).where(eq(trashItems.id, c.req.param('id')));
  return c.json({ success: true });
});

trashRoutes.delete('/', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(trashItems);
  return c.json({ success: true });
});
