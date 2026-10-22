import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { activityLogs } from '../db/schema';

export async function logActivity(db: Db, params: {
  entityType: string;
  entityId: string;
  entityName?: string | null;
  action: string;
  oldValues?: object | null;
  newValues?: object | null;
  performedBy?: string;
}): Promise<void> {
  try {
    await db.insert(activityLogs).values({
      id: randomUUID(),
      entityType: params.entityType,
      entityId: params.entityId,
      entityName: params.entityName ?? null,
      action: params.action,
      oldValues: params.oldValues ? JSON.stringify(params.oldValues) : null,
      newValues: params.newValues ? JSON.stringify(params.newValues) : null,
      performedBy: params.performedBy ?? null,
    });
  } catch {
    // non-critical
  }
}
