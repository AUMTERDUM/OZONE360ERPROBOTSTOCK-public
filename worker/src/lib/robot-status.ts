import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { robots } from '../db/schema';

// Restore a robot to its resting status after a loan/ticket ends:
// customer-assigned robots → 'Assigned', otherwise → 'In Stock'. Never touches 'Missing'.
export async function restoreRobotStatus(db: Db, robotId: string): Promise<void> {
  const robot = await db.query.robots.findFirst({ where: eq(robots.id, robotId) });
  if (robot && robot.status !== 'Missing') {
    await db.update(robots).set({ status: robot.customerId ? 'Assigned' : 'In Stock' }).where(eq(robots.id, robotId));
  }
}
