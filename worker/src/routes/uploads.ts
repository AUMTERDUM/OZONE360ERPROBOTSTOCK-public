import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, and, desc, like } from 'drizzle-orm';
import { getDb } from '../db/client';
import { attachments, robotModels, maintenanceTickets } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { entityExists } from '../lib/entity-exists';
import { putUpload } from '../lib/uploads';
import { authenticate } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

const uploadLimiter = rateLimit('UPLOAD_LIMITER', 'Too many uploads. Please slow down.');

// ── POST /api/upload — generic single-image upload (RobotModel.imageUrl, ticket QR photo, etc.) ──
export const uploadRoutes = new Hono<AppEnv>();

uploadRoutes.post('/', authenticate, uploadLimiter, async (c) => {
  const body = await c.req.parseBody();
  const file = body.image;
  if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
  const { key, error } = await putUpload(c.env.UPLOADS, file);
  if (error) return c.json({ error }, 400);
  return c.json({ url: `/uploads/${key}` });
});

// ── /api/attachments — file attachments linked to an entity (Robot, Customer, Ticket, ...) ──
export const attachmentsRoutes = new Hono<AppEnv>();

// Registered before the /:elementType/:elementId wildcard below — "file" would
// otherwise be swallowed as an elementType (this shadowing bug exists in the
// original Express router too; Hono matches routes in registration order the
// same way, so the fix here is simply to declare the static path first).
attachmentsRoutes.get('/file/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const attachment = await db.query.attachments.findFirst({ where: eq(attachments.id, c.req.param('id')) });
  if (!attachment) return c.json({ error: 'Attachment not found' }, 404);
  const obj = await c.env.UPLOADS.get(attachment.filename);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': attachment.mimeType || 'application/octet-stream',
      'Content-Disposition': `inline; filename="${encodeURIComponent(attachment.originalName)}"`,
    },
  });
});

// Newest image attachment of every record of one type — lets a list show thumbnails without one request per row.
// Registered before the /:elementType/:elementId wildcard so "photos" is not read as an elementType.
attachmentsRoutes.get('/photos/:elementType', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(attachments)
    .where(eq(attachments.elementType, c.req.param('elementType')))
    .orderBy(desc(attachments.uploadedAt));
  const seen = new Set<string>();
  const photos: { elementId: string; id: string; url: string }[] = [];
  for (const a of rows) {
    const isImage = (a.mimeType ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(a.originalName);
    if (!isImage || seen.has(a.elementId)) continue;
    seen.add(a.elementId);
    photos.push({ elementId: a.elementId, id: a.id, url: `/api/attachments/file/${a.id}` });
  }
  return c.json(photos);
});

attachmentsRoutes.get('/:elementType/:elementId', authenticate, async (c) => {
  const elementType = c.req.param('elementType');
  const elementId = c.req.param('elementId');
  const db = getDb(c.env.DB);
  if (!(await entityExists(db, elementType, elementId))) return c.json({ error: 'Entity not found' }, 404);
  const rows = await db.select().from(attachments)
    .where(and(eq(attachments.elementType, elementType), eq(attachments.elementId, elementId)))
    .orderBy(desc(attachments.uploadedAt));
  return c.json(rows.map((a) => ({
    id: a.id, attachmentType: a.attachmentType, originalName: a.originalName,
    fileSize: a.fileSize, mimeType: a.mimeType, uploadedBy: a.uploadedBy, uploadedAt: a.uploadedAt,
    url: `/api/attachments/file/${a.id}`,
  })));
});

attachmentsRoutes.post('/', authenticate, uploadLimiter, async (c) => {
  const user = c.get('user');
  const body = await c.req.parseBody();
  const file = body.file;
  if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
  const elementType = String(body.elementType || '');
  const elementId = String(body.elementId || '');
  const attachmentType = String(body.attachmentType || 'other');

  const db = getDb(c.env.DB);
  if (!(await entityExists(db, elementType, elementId))) return c.json({ error: 'Entity not found' }, 404);

  const { key, error } = await putUpload(c.env.UPLOADS, file);
  if (error) return c.json({ error }, 400);

  const newId = randomUUID();
  await db.insert(attachments).values({
    id: newId, elementType, elementId, attachmentType,
    filename: key, originalName: file.name, fileSize: file.size, mimeType: file.type, uploadedBy: user.username,
  });
  await logActivity(db, {
    entityType: elementType, entityId: elementId, action: 'attachment_added',
    newValues: { filename: file.name, attachmentType }, performedBy: user.username,
  });
  const attachment = await db.query.attachments.findFirst({ where: eq(attachments.id, newId) });
  return c.json({
    id: attachment!.id, attachmentType: attachment!.attachmentType, originalName: attachment!.originalName,
    fileSize: attachment!.fileSize, mimeType: attachment!.mimeType, uploadedBy: attachment!.uploadedBy,
    uploadedAt: attachment!.uploadedAt, url: `/api/attachments/file/${attachment!.id}`,
  }, 201);
});

attachmentsRoutes.delete('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const attachment = await db.query.attachments.findFirst({ where: eq(attachments.id, id) });
  if (attachment) {
    const canDelete = user.role === 'ADMIN' || attachment.uploadedBy === user.username;
    if (!canDelete) return c.json({ error: 'Forbidden' }, 403);
    await c.env.UPLOADS.delete(attachment.filename);
    await db.delete(attachments).where(eq(attachments.id, id));
  }
  return c.json({ success: true });
});

// ── Public GET /uploads/:filename — serves only files referenced by RobotModel.imageUrl or ──
// MaintenanceTicket.issueImageUrl (anti-hotlinking guard, mirrors server/index.ts's
// isPublicMediaReference), since this route has no auth.
export const publicMediaRoutes = new Hono<AppEnv>();

async function isPublicMediaReference(db: ReturnType<typeof getDb>, filename: string): Promise<boolean> {
  const safe = filename.trim();
  if (!safe || safe.includes('/') || safe.includes('\\')) return false;
  const [models, tickets] = await Promise.all([
    db.select({ id: robotModels.id }).from(robotModels).where(like(robotModels.imageUrl, `%/${safe}`)).limit(1),
    db.select({ id: maintenanceTickets.id }).from(maintenanceTickets).where(like(maintenanceTickets.issueImageUrl, `%/${safe}`)).limit(1),
  ]);
  return models.length + tickets.length > 0;
}

publicMediaRoutes.get('/:filename', async (c) => {
  const filename = c.req.param('filename');
  const db = getDb(c.env.DB);
  if (!(await isPublicMediaReference(db, filename))) return c.json({ error: 'File not found' }, 404);
  const obj = await c.env.UPLOADS.get(filename);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream' },
  });
});
