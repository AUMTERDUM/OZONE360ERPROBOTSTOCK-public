import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getAllRobots, getStoreMap, getShopsSummary } from '../lib/pudu-client';
import { syncFromPudu } from '../lib/pudu-sync';
import { handlePuduCallback, sameSecret, type PuduCallbackBody } from '../lib/pudu-callback';
import { getDb } from '../db/client';
import { robots, robotModels, customers, maintenancePlans } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { parsePuduXlsx, computeRobotActions, computeStoreActions } from '../lib/xlsx-helpers';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

// Last-sync timestamp — in-memory, resets when the Worker isolate recycles
// (mirrors the original server's `let lastSyncTime` module-level variable).
let lastSyncTime: string | null = null;

export const puduRoutes = new Hono<AppEnv>();

// PUDU early-warning webhook. Public (PUDU calls it server-to-server), authenticated by the
// CallbackCode header PUDU agreed with us. PUDU drops replies slower than 5s, so keep this lean.
puduRoutes.post('/callback', async (c) => {
  const expected = c.env.PUDU_CALLBACK_CODE;
  if (!expected) return c.json({ error: 'Callback not configured' }, 503);
  if (!sameSecret(c.req.header('CallbackCode') ?? '', expected)) return c.json({ error: 'Invalid callback code' }, 401);
  let body: PuduCallbackBody;
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const result = await handlePuduCallback(getDb(c.env.DB), body);
  return c.json({ ok: true, ...result });
});

puduRoutes.get('/sync-status', authenticate, (c) => c.json({ lastSyncTime }));

puduRoutes.get('/summary', authenticate, async (c) => {
  try {
    const data = await getShopsSummary(c.env);
    return c.json({ data });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

puduRoutes.get('/robots', authenticate, async (c) => {
  try {
    const robots = await getAllRobots(c.env);
    return c.json({ data: robots, count: robots.length });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

puduRoutes.get('/map', authenticate, async (c) => {
  const shopId = c.req.query('shop_id');
  const mapName = c.req.query('map_name');
  const deviceWidth = c.req.query('device_width');
  const deviceHeight = c.req.query('device_height');
  if (!shopId || !mapName) return c.json({ error: 'shop_id and map_name are required' }, 400);
  try {
    const data = await getStoreMap(c.env, shopId, mapName, deviceWidth ? Number(deviceWidth) : 1280, deviceHeight ? Number(deviceHeight) : 720);
    return c.json(data);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

puduRoutes.post('/sync', authenticate, requireAdmin, async (c) => {
  try {
    const db = getDb(c.env.DB);
    const result = await syncFromPudu(db, c.env);
    lastSyncTime = new Date().toISOString();
    return c.json({ success: true, result });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

puduRoutes.post('/sync/:shopId', authenticate, requireAdmin, async (c) => {
  try {
    const db = getDb(c.env.DB);
    const result = await syncFromPudu(db, c.env, c.req.param('shopId'));
    lastSyncTime = new Date().toISOString();
    return c.json({ success: true, result });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

// POST /api/pudu/preview — parse xlsx (Robot list or Store list), return dry-run (no DB writes).
puduRoutes.post('/preview', authenticate, requireAdmin, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
    const db = getDb(c.env.DB);
    const { headers, dataRows, isRobotFile } = await parsePuduXlsx(await file.arrayBuffer());
    if (isRobotFile) {
      const rows = await computeRobotActions(db, headers, dataRows);
      const summary = { created: rows.filter((r) => r.action === 'create').length, updated: rows.filter((r) => r.action === 'update').length, skipped: rows.filter((r) => r.action === 'skip').length, errors: rows.filter((r) => r.action === 'error').length };
      const warnings: string[] = [];
      const guessedCount = rows.filter((r) => r.guessedModel).length;
      const noModelCount = rows.filter((r) => !r.modelName).length;
      if (guessedCount > 0) warnings.push(`${guessedCount} เครื่องไม่มีชื่อรุ่นในไฟล์ — ใช้ SN prefix เดารุ่นอัตโนมัติ`);
      if (noModelCount > 0) warnings.push(`${noModelCount} เครื่องไม่สามารถระบุรุ่นได้ (SN prefix ไม่ตรงกับรุ่นที่รู้จัก)`);
      return c.json({ fileType: 'robot', totalRows: dataRows.length, summary, warnings, rows: rows.slice(0, 50) });
    }
    const rows = await computeStoreActions(db, headers, dataRows);
    const summary = { created: rows.filter((r) => r.action === 'create').length, updated: rows.filter((r) => r.action === 'update').length, skipped: rows.filter((r) => r.action === 'skip').length, errors: 0 };
    const warnings: string[] = [];
    const noPhoneCount = rows.filter((r) => !r.phone).length;
    if (noPhoneCount > 0) warnings.push(`${noPhoneCount} ร้านค้าไม่มีเบอร์โทรศัพท์ในไฟล์`);
    return c.json({ fileType: 'store', totalRows: dataRows.length, summary, warnings, rows: rows.slice(0, 50) });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Preview failed' }, 500);
  }
});

// POST /api/pudu/import — apply the xlsx import (Robot list or Store list).
puduRoutes.post('/import', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
    const db = getDb(c.env.DB);
    const { headers, dataRows, isRobotFile } = await parsePuduXlsx(await file.arrayBuffer());
    const stats = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

    if (isRobotFile) {
      const actions = await computeRobotActions(db, headers, dataRows);
      const col = (name: string) => headers.indexOf(name);
      const iSN = col('SN(PID)'), iInstall = col('Store installation time');

      const allModels = await db.select({ id: robotModels.id, name: robotModels.name, puduProductCode: robotModels.puduProductCode }).from(robotModels);
      const allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers);
      const normW = (s: string) => s.toLowerCase().replace(/\s+/g, '');
      const modelByName = new Map(allModels.map((m) => [m.name.toLowerCase(), m]));
      const modelByCode = new Map(allModels.filter((m) => m.puduProductCode).map((m) => [m.puduProductCode!.toLowerCase(), m]));
      const modelByNormW = new Map(allModels.map((m) => [normW(m.name), m]));
      const custByName = new Map(allCustomers.map((cu) => [cu.name.toLowerCase(), cu]));

      for (const a of actions) {
        if (a.action === 'error') { stats.errors.push(`SN ${a.sn}: ${a.reason}`); continue; }
        if (a.action === 'skip') { stats.skipped++; continue; }
        let model = modelByName.get(a.modelName.toLowerCase()) ?? modelByCode.get(a.modelName.toLowerCase()) ?? modelByNormW.get(normW(a.modelName)) ?? null;
        const customer = custByName.get(a.ownerName.toLowerCase()) ?? custByName.get(a.storeName.toLowerCase()) ?? null;
        try {
          if (!model && a.modelName) {
            const newModelId = randomUUID();
            await db.insert(robotModels).values({ id: newModelId, name: a.modelName, type: 'Service Robot', payloadCapacity: '-', batteryLife: '-' });
            model = { id: newModelId, name: a.modelName, puduProductCode: null };
            modelByName.set(a.modelName.toLowerCase(), model);
          }
          if (a.action === 'create') {
            const row = dataRows.find((r) => String((r as unknown[])[iSN] ?? '').trim() === a.sn) as unknown[] | undefined;
            const installDate = row && row[iInstall] ? String(row[iInstall]).trim().slice(0, 10) : null;
            let robotDate = installDate ?? new Date().toISOString().slice(0, 10);
            if (customer) {
              const maPlan = await db.query.maintenancePlans.findFirst({ where: eq(maintenancePlans.customerId, customer.id) });
              if (maPlan?.startDate) robotDate = maPlan.startDate;
            }
            await db.insert(robots).values({ id: randomUUID(), serialNumber: a.sn, puduMac: a.mac, status: a.status, purchaseDate: robotDate, warrantyExpiresAt: a.warrantyExpiresAt, modelId: model!.id, customerId: customer?.id ?? null });
            stats.created++;
          } else {
            const data: Record<string, unknown> = { status: a.status };
            if (a.mac) data.puduMac = a.mac;
            if (model) data.modelId = model.id;
            if (customer) data.customerId = customer.id;
            if (a.warrantyExpiresAt) data.warrantyExpiresAt = a.warrantyExpiresAt;
            await db.update(robots).set(data).where(eq(robots.serialNumber, a.sn));
            stats.updated++;
          }
        } catch (e) { stats.errors.push(`SN ${a.sn}: ${e instanceof Error ? e.message : String(e)}`); }
      }
    } else {
      const actions = await computeStoreActions(db, headers, dataRows);
      for (const a of actions) {
        if (a.action === 'skip') { stats.skipped++; continue; }
        try {
          if (a.action === 'create') {
            await db.insert(customers).values({ id: randomUUID(), name: a.name, contactPerson: a.agent, email: '', phone: a.phone, address: a.address });
            stats.created++;
          } else {
            const existing = await db.query.customers.findFirst({ where: eq(customers.name, a.name) });
            if (existing) {
              const data: Record<string, unknown> = {};
              if (a.address) data.address = a.address;
              if (a.phone) data.phone = a.phone;
              await db.update(customers).set(data).where(eq(customers.id, existing.id));
              stats.updated++;
            }
          }
        } catch (e) { stats.errors.push(`Store "${a.name}": ${e instanceof Error ? e.message : String(e)}`); }
      }
    }

    await logActivity(db, { entityType: 'PuduImport', entityId: 'xlsx', action: isRobotFile ? 'import-robots' : 'import-stores', performedBy: user.username, newValues: stats });
    return c.json({ fileType: isRobotFile ? 'robot' : 'store', totalRows: dataRows.length, ...stats });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Internal server error during import' }, 500);
  }
});
