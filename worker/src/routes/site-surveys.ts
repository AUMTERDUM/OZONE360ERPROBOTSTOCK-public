import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { siteSurveys } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { authenticate } from '../middleware/auth';
import type { AppEnv } from '../types';

// ── /api/site-surveys — AMR / cleaning-robot site survey forms ─────────────────
export const siteSurveysRoutes = new Hono<AppEnv>();

const FORM_TYPES = new Set(['amr', 'cleaning']);

const toJson = (row: typeof siteSurveys.$inferSelect) => ({
  ...row,
  answers: (() => { try { return JSON.parse(row.answers); } catch { return {}; } })(),
});

siteSurveysRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const customerId = c.req.query('customerId');
  const rows = await db.select().from(siteSurveys)
    .where(customerId ? eq(siteSurveys.customerId, customerId) : undefined)
    .orderBy(desc(siteSurveys.createdAt));
  return c.json(rows.map(toJson));
});

siteSurveysRoutes.get('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const row = await db.query.siteSurveys.findFirst({ where: eq(siteSurveys.id, c.req.param('id')) });
  if (!row) return c.json({ error: 'Survey not found' }, 404);
  return c.json(toJson(row));
});

siteSurveysRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const b = await c.req.json();
  if (!FORM_TYPES.has(b.formType)) return c.json({ error: 'formType must be amr or cleaning' }, 400);
  if (!b.siteName?.trim()) return c.json({ error: 'กรุณากรอกชื่อโรงงาน/สถานที่' }, 400);
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(siteSurveys).values({
    id: newId,
    formType: b.formType,
    siteName: b.siteName.trim(),
    surveyDate: b.surveyDate || null,
    engineerName: b.engineerName || null,
    zone: b.zone || null,
    customerId: b.customerId || null,
    siteId: b.siteId || null,
    answers: JSON.stringify(b.answers ?? {}),
    createdBy: user.username,
  });
  await logActivity(db, {
    entityType: 'SiteSurvey', entityId: newId, entityName: b.siteName.trim(),
    action: 'created', newValues: b, performedBy: user.username,
  });
  const row = await db.query.siteSurveys.findFirst({ where: eq(siteSurveys.id, newId) });
  return c.json(toJson(row!), 201);
});

siteSurveysRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const b = await c.req.json();
  const db = getDb(c.env.DB);
  const old = await db.query.siteSurveys.findFirst({ where: eq(siteSurveys.id, id) });
  if (!old) return c.json({ error: 'Survey not found' }, 404);

  const data: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (b.siteName !== undefined) data.siteName = String(b.siteName).trim();
  if (b.surveyDate !== undefined) data.surveyDate = b.surveyDate || null;
  if (b.engineerName !== undefined) data.engineerName = b.engineerName || null;
  if (b.zone !== undefined) data.zone = b.zone || null;
  if (b.customerId !== undefined) data.customerId = b.customerId || null;
  if (b.siteId !== undefined) data.siteId = b.siteId || null;
  if (b.answers !== undefined) data.answers = JSON.stringify(b.answers ?? {});

  await db.update(siteSurveys).set(data).where(eq(siteSurveys.id, id));
  await logActivity(db, {
    entityType: 'SiteSurvey', entityId: id, action: 'updated',
    oldValues: old, newValues: b, performedBy: user.username,
  });
  const row = await db.query.siteSurveys.findFirst({ where: eq(siteSurveys.id, id) });
  return c.json(toJson(row!));
});

siteSurveysRoutes.delete('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const row = await db.query.siteSurveys.findFirst({ where: eq(siteSurveys.id, id) });
  if (!row) return c.json({ error: 'Survey not found' }, 404);
  await db.delete(siteSurveys).where(eq(siteSurveys.id, id));
  await logActivity(db, { entityType: 'SiteSurvey', entityId: id, entityName: row.siteName, action: 'deleted', performedBy: user.username });
  return c.json({ success: true });
});
