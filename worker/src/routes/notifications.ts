import { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { notifications } from '../db/schema';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

export const notificationsRoutes = new Hono<AppEnv>();

notificationsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(50);
  return c.json(rows);
});

// read-all must be registered before :id/read so the static path wins.
notificationsRoutes.patch('/read-all', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  await db.update(notifications).set({ read: true }).where(eq(notifications.read, false));
  return c.json({ success: true });
});

notificationsRoutes.patch('/:id/read', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  await db.update(notifications).set({ read: true }).where(eq(notifications.id, c.req.param('id')));
  return c.json({ success: true });
});

notificationsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(notifications).where(eq(notifications.id, c.req.param('id')));
  return c.json({ success: true });
});
