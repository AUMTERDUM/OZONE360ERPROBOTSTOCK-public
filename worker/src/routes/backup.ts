import { Hono } from 'hono';
import { getDb } from '../db/client';
import { exportAllTablesToJson, runAutoBackup } from '../lib/backup';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const BACKUP_PREFIX = 'backups/auto-';

export const backupRoutes = new Hono<AppEnv>();

// D1 has no filesystem — backups are logical JSON exports in R2, and point-in-time
// recovery is covered by D1's built-in Time Travel (30-day automatic PITR).
backupRoutes.get('/info', authenticate, requireAdmin, async (c) => {
  const listed = await c.env.UPLOADS.list({ prefix: BACKUP_PREFIX });
  return c.json({
    backend: 'Cloudflare D1',
    pointInTimeRecovery: 'D1 Time Travel — 30-day automatic PITR, restore via `wrangler d1 time-travel restore`',
    logicalBackupCount: listed.objects.length,
  });
});

// Immediate JSON snapshot of every table, streamed as a download (replaces the
// original's raw SQLite file download — there's no single file to download under D1).
backupRoutes.get('/db', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const dump = await exportAllTablesToJson(db);
  const json = JSON.stringify({ exportedAt: new Date().toISOString(), tables: dump });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return new Response(json, {
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="ozone360-snapshot-${ts}.json"`,
    },
  });
});

backupRoutes.get('/auto/list', authenticate, requireAdmin, async (c) => {
  const listed = await c.env.UPLOADS.list({ prefix: BACKUP_PREFIX });
  const files = listed.objects
    .map((o) => ({ filename: o.key.slice('backups/'.length), size: o.size, createdAt: o.uploaded }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  return c.json(files);
});

backupRoutes.post('/auto/run', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const result = await runAutoBackup(db, c.env.UPLOADS);
  if (!result) return c.json({ error: 'Backup failed' }, 500);
  return c.json({ success: true, filename: result.key.slice('backups/'.length), size: result.size, createdAt: new Date().toISOString() });
});

backupRoutes.get('/auto/download/:filename', authenticate, requireAdmin, async (c) => {
  const name = c.req.param('filename');
  if (!name.startsWith('auto-') || !name.endsWith('.json') || name.includes('..')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }
  const obj = await c.env.UPLOADS.get(`${BACKUP_PREFIX}${name.slice('auto-'.length)}`);
  if (!obj) return c.json({ error: 'File not found' }, 404);
  return new Response(obj.body, {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="${name}"` },
  });
});

backupRoutes.delete('/auto/:filename', authenticate, requireAdmin, async (c) => {
  const name = c.req.param('filename');
  if (!name.startsWith('auto-') || !name.endsWith('.json') || name.includes('..')) {
    return c.json({ error: 'Invalid filename' }, 400);
  }
  await c.env.UPLOADS.delete(`${BACKUP_PREFIX}${name.slice('auto-'.length)}`);
  return c.json({ success: true });
});
