import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, count, asc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cachedJson } from '../lib/read-cache';
import { robotModels, robots } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { pickFields } from '../lib/pick-fields';
import { moveToTrash } from '../lib/trash';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const ROBOT_MODEL_FIELDS = ['sku', 'name', 'type', 'payloadCapacity', 'batteryLife', 'imageUrl', 'puduProductCode', 'maCategory'] as const;

const MA_CATEGORIES = ['delivery', 'industrial', 'cleaning'];

/** Unknown or empty MA categories are stored as null so the app falls back to guessing from the name. */
function normalizeMaCategory(data: Partial<typeof robotModels.$inferInsert>) {
  if ('maCategory' in data && !MA_CATEGORIES.includes(data.maCategory as string)) data.maCategory = null;
}

export const modelsRoutes = new Hono<AppEnv>();

modelsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  return cachedJson(c, 'models', ['RobotModel'], () => db.select().from(robotModels).orderBy(asc(robotModels.name)));
});

modelsRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const data = pickFields<typeof robotModels.$inferInsert>(body, ROBOT_MODEL_FIELDS);
  normalizeMaCategory(data);
  if (!data.name) return c.json({ error: 'name is required' }, 400);

  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(robotModels).values({ id: newId, ...data } as typeof robotModels.$inferInsert);
  const model = await db.query.robotModels.findFirst({ where: eq(robotModels.id, newId) });

  await logActivity(db, {
    entityType: 'RobotModel', entityId: newId, entityName: model!.name,
    action: 'created', newValues: data, performedBy: user.username,
  });
  return c.json(model, 201);
});

modelsRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = pickFields<typeof robotModels.$inferInsert>(body, ROBOT_MODEL_FIELDS);
  normalizeMaCategory(data);

  const db = getDb(c.env.DB);
  const old = await db.query.robotModels.findFirst({ where: eq(robotModels.id, id) });
  await db.update(robotModels).set(data).where(eq(robotModels.id, id));
  const model = await db.query.robotModels.findFirst({ where: eq(robotModels.id, id) });

  await logActivity(db, {
    entityType: 'RobotModel', entityId: id, entityName: model?.name,
    action: 'updated', oldValues: old, newValues: data, performedBy: user.username,
  });
  return c.json(model);
});

modelsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);

  const model = await db.query.robotModels.findFirst({ where: eq(robotModels.id, id) });
  if (!model) return c.json({ error: 'Not found' }, 404);

  const [{ value: robotCount }] = await db.select({ value: count() }).from(robots).where(eq(robots.modelId, id));
  if (robotCount > 0) {
    return c.json({ error: `ไม่สามารถลบได้ เนื่องจากมี Robot ${robotCount} รายการที่ใช้ Model นี้อยู่` }, 409);
  }

  await moveToTrash(db, {
    entityType: 'RobotModel', entityId: model.id, entityName: model.name,
    entity: model, deletedBy: user.username,
  });
  await db.delete(robotModels).where(eq(robotModels.id, id));
  await logActivity(db, {
    entityType: 'RobotModel', entityId: id, entityName: model.name,
    action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});
