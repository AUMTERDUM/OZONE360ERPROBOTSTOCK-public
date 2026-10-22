import { randomUUID } from 'node:crypto';
import type { Db } from '../db/client';
import { trashItems } from '../db/schema';

// Soft-delete: snapshot an entity into the recycle bin (TrashItem) before hard delete.
// Mirrors the `prisma.trashItem.create({ entityData: JSON.stringify(...) })` pattern
// used throughout server/index.ts.
export async function moveToTrash(db: Db, params: {
  entityType: string;
  entityId: string;
  entityName?: string | null;
  entity: unknown;
  deletedBy?: string;
}): Promise<void> {
  await db.insert(trashItems).values({
    id: randomUUID(),
    entityType: params.entityType,
    entityId: params.entityId,
    entityName: params.entityName ?? null,
    entityData: JSON.stringify(params.entity),
    deletedBy: params.deletedBy ?? null,
  });
}
