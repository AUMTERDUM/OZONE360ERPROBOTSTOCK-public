import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { notifications } from '../db/schema';

export async function createNotification(
  db: Db,
  type: string,
  title: string,
  body?: string,
  entityType?: string,
  entityId?: string,
): Promise<void> {
  try {
    await db.insert(notifications).values({
      id: randomUUID(),
      type, title, body: body ?? null,
      entityType: entityType ?? null,
      entityId: entityId ?? null,
    });
  } catch {
    // non-critical
  }
}
