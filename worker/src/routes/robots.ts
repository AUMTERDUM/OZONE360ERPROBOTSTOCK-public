import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, asc, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cachedJson } from '../lib/read-cache';
import { robots, robotModels, customers } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { pickFields } from '../lib/pick-fields';
import { moveToTrash } from '../lib/trash';
import { createMaintenanceTicketFromInput } from '../lib/maintenance';
import { createNotification } from '../lib/notifications';
import { readFirstSheetRows, guessModelFromSN } from '../lib/xlsx-helpers';
import { authenticate, requireAdmin } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

const ROBOT_FIELDS = ['serialNumber', 'status', 'purchaseDate', 'puduMac', 'notes', 'warrantyExpiresAt', 'modelId', 'customerId', 'locationId'] as const;

export const robotsRoutes = new Hono<AppEnv>();

// ── Public robot info (no auth — for QR scan) ────────────────────────────────
robotsRoutes.get('/public/:serialNumber', rateLimit('PORTAL_LIMITER', 'ดูข้อมูลถี่เกินไป กรุณาลองใหม่ในอีกสักครู่'), async (c) => {
  const db = getDb(c.env.DB);
  const robot = await db.query.robots.findFirst({
    where: eq(robots.serialNumber, c.req.param('serialNumber')),
    with: {
      model: true,
      customer: { columns: { id: true, name: true, portalToken: true } },
      location: { columns: { name: true } },
      tickets: {
        orderBy: (t, { desc }) => desc(t.reportDate),
        limit: 3,
        columns: { id: true, status: true, reportDate: true, issueDescription: true, resolution: true },
      },
    },
  });
  if (!robot || robot.archivedAt) return c.json({ error: 'ไม่พบข้อมูลหุ่นยนต์' }, 404);
  return c.json({
    id: robot.id,
    serialNumber: robot.serialNumber,
    model: robot.model.name,
    type: robot.model.type,
    status: robot.status,
    purchaseDate: robot.purchaseDate,
    warrantyExpiresAt: robot.warrantyExpiresAt ?? null,
    // Anonymous QR scanners get the customer name only. The portal token is withheld: it opens
    // every robot and ticket of that customer, and serial numbers are guessable. contactPerson/phone
    // (PII) and per-ticket trackingTokens are withheld too.
    customer: robot.customer ? { name: robot.customer.name } : null,
    location: robot.location?.name ?? null,
    recentTickets: robot.tickets.map((t) => ({
      id: t.id,
      status: t.status,
      reportDate: t.reportDate,
      issueDescription: t.issueDescription,
      resolution: t.resolution,
    })),
  });
});

// Public robot issue report (no auth — QR scan by anyone). Creates a ticket via the
// SLA/auto-assign pipeline. Rate limiting (5/5min) is enforced at the edge, not here.
robotsRoutes.post('/public/:serialNumber/report', rateLimit('PUBLIC_REPORT_LIMITER', 'ส่งแจ้งปัญหาได้สูงสุด 5 ครั้ง / 5 นาที กรุณาลองใหม่ภายหลัง'), async (c) => {
  const { issueDescription, reporterName, reporterPhone } = await c.req.json();
  if (!issueDescription || typeof issueDescription !== 'string' || !issueDescription.trim()) {
    return c.json({ error: 'กรุณาอธิบายปัญหาที่พบ' }, 400);
  }
  if (issueDescription.length > 2000) {
    return c.json({ error: 'คำอธิบายปัญหายาวเกินไป (สูงสุด 2,000 ตัวอักษร)' }, 400);
  }
  const db = getDb(c.env.DB);
  const robot = await db.query.robots.findFirst({
    where: eq(robots.serialNumber, c.req.param('serialNumber')),
    with: { customer: { columns: { id: true, name: true } } },
  });
  if (!robot || robot.archivedAt) return c.json({ error: 'ไม่พบข้อมูลหุ่นยนต์' }, 404);

  let fullDescription = issueDescription.trim();
  const contactParts: string[] = [];
  if (reporterName && typeof reporterName === 'string' && reporterName.trim()) contactParts.push(`ผู้แจ้ง: ${reporterName.trim().slice(0, 100)}`);
  if (reporterPhone && typeof reporterPhone === 'string' && reporterPhone.trim()) contactParts.push(`เบอร์: ${reporterPhone.trim().slice(0, 20)}`);
  if (contactParts.length) fullDescription += `\n\n--- ข้อมูลผู้แจ้ง ---\n${contactParts.join('\n')}`;

  const ticket = await createMaintenanceTicketFromInput(db, {
    robotId: robot.id,
    customerId: robot.customerId || null,
    issueDescription: fullDescription,
    status: 'Pending',
    priorityLevel: 'Normal',
  }, `qr-scan:${robot.serialNumber}`);
  await createNotification(db, 'ticket_updated', `QR Scan: แจ้งปัญหาหุ่นยนต์ ${robot.serialNumber}`,
    `${robot.customer?.name || 'ไม่ระบุลูกค้า'} — ${issueDescription.trim().slice(0, 60)}`, 'MaintenanceTicket', ticket.id);
  return c.json({ id: ticket.id, trackingToken: ticket.trackingToken, status: ticket.status }, 201);
});

// ── Authenticated robot CRUD ─────────────────────────────────────────────────
robotsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  return cachedJson(c, 'robots', ['Robot'], () => db.select().from(robots).orderBy(asc(robots.serialNumber)));
});

robotsRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const data = pickFields<typeof robots.$inferInsert>(body, ROBOT_FIELDS);
  if (!data.serialNumber || !data.modelId || !data.status || !data.purchaseDate) {
    return c.json({ error: 'serialNumber, modelId, status, purchaseDate are required' }, 400);
  }
  const db = getDb(c.env.DB);
  const existing = await db.query.robots.findFirst({ where: eq(robots.serialNumber, data.serialNumber) });
  if (existing) return c.json({ error: 'SN นี้มีอยู่แล้วในระบบหุ่นยนต์' }, 409);
  const newId = randomUUID();
  await db.insert(robots).values({
    id: newId,
    serialNumber: data.serialNumber,
    status: data.status,
    purchaseDate: data.purchaseDate,
    modelId: data.modelId,
    ...data,
  });
  const robot = await db.query.robots.findFirst({ where: eq(robots.id, newId) });
  await logActivity(db, {
    entityType: 'Robot', entityId: newId, entityName: robot!.serialNumber,
    action: 'created', newValues: data, performedBy: user.username,
  });
  return c.json(robot, 201);
});

robotsRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = pickFields<typeof robots.$inferInsert>(body, ROBOT_FIELDS);

  const db = getDb(c.env.DB);
  const old = await db.query.robots.findFirst({ where: eq(robots.id, id) });
  await db.update(robots).set(data).where(eq(robots.id, id));
  const robot = await db.query.robots.findFirst({ where: eq(robots.id, id) });
  const action = old?.status !== robot?.status ? 'status_changed' : 'updated';
  await logActivity(db, {
    entityType: 'Robot', entityId: id, entityName: robot?.serialNumber,
    action,
    oldValues: { status: old?.status },
    newValues: { status: robot?.status },
    performedBy: user.username,
  });
  return c.json(robot);
});

robotsRoutes.post('/bulk-status', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ ids?: string[]; status?: string; customerId?: string }>();
  const { ids, status, customerId } = body;
  if (!ids?.length || !status) return c.json({ error: 'ids and status required' }, 400);

  const db = getDb(c.env.DB);
  await db.update(robots).set({ status, customerId: customerId || null }).where(inArray(robots.id, ids));
  for (const id of ids) {
    const r = await db.query.robots.findFirst({ where: eq(robots.id, id) });
    if (r) {
      await logActivity(db, {
        entityType: 'Robot', entityId: r.id, entityName: r.serialNumber,
        action: 'status_changed', newValues: { status }, performedBy: user.username,
      });
    }
  }
  return c.json({ updated: ids.length });
});

robotsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const robot = await db.query.robots.findFirst({ where: eq(robots.id, id) });
  if (!robot) return c.json({ error: 'Not found' }, 404);
  await moveToTrash(db, {
    entityType: 'Robot', entityId: robot.id, entityName: robot.serialNumber,
    entity: robot, deletedBy: user.username,
  });
  await db.delete(robots).where(eq(robots.id, id));
  await logActivity(db, {
    entityType: 'Robot', entityId: id, entityName: robot.serialNumber,
    action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});

// ── "Unbound Machine List" xlsx import — flips matched robots to In Stock ────
const OZONE_NAMES = ['ozone', 'ozone network'];
const isOzoneClient = (name: string) => OZONE_NAMES.some((o) => name.toLowerCase().includes(o));

function parseUnboundHeaders(headers: string[]) {
  return {
    iSN: headers.indexOf('SN(PID)'),
    iMAC: headers.indexOf('MAC address'),
    iModel: headers.findIndex((h) => h.toLowerCase().includes('product model') || h.toLowerCase().includes('product name')),
    iStatus: headers.indexOf('Status'),
    iClient: headers.findIndex((h) => h.toLowerCase().includes('affiliated client') || h.toLowerCase().includes('affiliated agent')),
  };
}

robotsRoutes.post('/import-status/preview', authenticate, requireAdmin, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
    const rawRows = readFirstSheetRows(await file.arrayBuffer());
    if (rawRows.length < 2) return c.json({ error: 'ไฟล์ไม่มีข้อมูล' }, 400);

    const headers = (rawRows[0] as unknown[]).map((h) => String(h ?? '').trim());
    const { iSN, iMAC, iModel, iStatus, iClient } = parseUnboundHeaders(headers);
    if (iSN < 0) return c.json({ error: 'ไม่พบคอลัมน์ SN(PID) ในไฟล์' }, 400);

    const dataRows = rawRows.slice(1).filter((r) => (r as unknown[]).some((cell) => cell !== undefined && cell !== ''));
    const db = getDb(c.env.DB);
    const allRobots = await db.select({ id: robots.id, serialNumber: robots.serialNumber, status: robots.status, customerId: robots.customerId }).from(robots);
    const robotBySN = new Map(allRobots.map((r) => [r.serialNumber.toLowerCase(), r]));

    const rows: Record<string, unknown>[] = [];
    for (const r of dataRows) {
      const row = r as unknown[];
      const sn = String(row[iSN] ?? '').trim();
      if (!sn) continue;
      const mac = iMAC >= 0 ? String(row[iMAC] ?? '').trim() : '';
      const rawModelName = iModel >= 0 ? String(row[iModel] ?? '').trim() : '';
      const modelName = rawModelName || guessModelFromSN(sn);
      const guessedModel = !rawModelName && !!modelName;
      const fileStatus = iStatus >= 0 ? String(row[iStatus] ?? '').trim() : '';
      const clientName = iClient >= 0 ? String(row[iClient] ?? '').trim() : '';
      const agentName = (!clientName || isOzoneClient(clientName)) ? null : clientName;
      const existing = robotBySN.get(sn.toLowerCase());

      if (existing) {
        if (existing.status === 'In Stock') {
          rows.push({ sn, mac, modelName, guessedModel, fileStatus, agentName, action: 'skip', reason: 'อยู่ในคลังแล้ว', currentStatus: existing.status });
        } else {
          rows.push({ sn, mac, modelName, guessedModel, fileStatus, agentName, action: 'update', reason: `${existing.status} → In Stock`, currentStatus: existing.status });
        }
      } else {
        const note = agentName ? `เพิ่มใหม่ (คลังตัวแทน: ${agentName})` : 'เพิ่มใหม่เข้าระบบ';
        rows.push({ sn, mac, modelName, guessedModel, fileStatus, agentName, action: 'create', reason: note, currentStatus: null });
      }
    }

    const warnings: string[] = [];
    const guessedCount = rows.filter((r) => r.guessedModel).length;
    const noModelCount = rows.filter((r) => !r.modelName).length;
    if (guessedCount > 0) warnings.push(`${guessedCount} เครื่องไม่มีชื่อรุ่นในไฟล์ — ใช้ SN prefix เดารุ่นอัตโนมัติ`);
    if (noModelCount > 0) warnings.push(`${noModelCount} เครื่องไม่สามารถระบุรุ่นได้ (SN prefix ไม่ตรงกับรุ่นที่รู้จัก)`);

    const summary = {
      created: rows.filter((r) => r.action === 'create').length,
      updated: rows.filter((r) => r.action === 'update').length,
      skipped: rows.filter((r) => r.action === 'skip').length,
    };
    return c.json({ totalRows: dataRows.length, summary, warnings, rows });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Preview failed' }, 500);
  }
});

robotsRoutes.post('/import-status/confirm', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
    const rawRows = readFirstSheetRows(await file.arrayBuffer());
    if (rawRows.length < 2) return c.json({ error: 'ไฟล์ไม่มีข้อมูล' }, 400);

    const headers = (rawRows[0] as unknown[]).map((h) => String(h ?? '').trim());
    const { iSN, iMAC, iModel, iClient } = parseUnboundHeaders(headers);
    if (iSN < 0) return c.json({ error: 'ไม่พบคอลัมน์ SN(PID)' }, 400);

    const dataRows = rawRows.slice(1).filter((r) => (r as unknown[]).some((cell) => cell !== undefined && cell !== ''));
    const db = getDb(c.env.DB);
    const allRobots = await db.select({ id: robots.id, serialNumber: robots.serialNumber, status: robots.status }).from(robots);
    const robotBySN = new Map(allRobots.map((r) => [r.serialNumber.toLowerCase(), r]));

    const allModels = await db.select({ id: robotModels.id, name: robotModels.name }).from(robotModels);
    const modelByName = new Map(allModels.map((m) => [m.name.toLowerCase(), m]));

    const allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers);
    const customerByName = new Map(allCustomers.map((cu) => [cu.name.toLowerCase(), cu]));

    const stats = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

    for (const r of dataRows) {
      const row = r as unknown[];
      const sn = String(row[iSN] ?? '').trim();
      if (!sn) continue;
      const mac = iMAC >= 0 ? String(row[iMAC] ?? '').trim() : '';
      const rawModelName = iModel >= 0 ? String(row[iModel] ?? '').trim() : '';
      const modelName = rawModelName || guessModelFromSN(sn);
      const clientName = iClient >= 0 ? String(row[iClient] ?? '').trim() : '';
      const agentName = (!clientName || isOzoneClient(clientName)) ? null : clientName;
      const existing = robotBySN.get(sn.toLowerCase());

      let agentCustomerId: string | null = null;
      if (agentName) {
        let cust = customerByName.get(agentName.toLowerCase()) ?? null;
        if (!cust) {
          const newId = randomUUID();
          await db.insert(customers).values({ id: newId, name: agentName, contactPerson: '', email: '', phone: '', address: '' });
          cust = { id: newId, name: agentName };
          customerByName.set(agentName.toLowerCase(), cust);
        }
        agentCustomerId = cust.id;
      }

      try {
        if (existing) {
          if (existing.status === 'In Stock') {
            stats.skipped++;
          } else {
            await db.update(robots).set({ status: 'In Stock', customerId: agentCustomerId }).where(eq(robots.id, existing.id));
            await logActivity(db, { entityType: 'Robot', entityId: existing.id, entityName: sn, action: 'status_changed', oldValues: { status: existing.status }, newValues: { status: 'In Stock', agent: agentName, source: 'Unbound Excel Import' }, performedBy: user.username });
            stats.updated++;
          }
        } else {
          let model = modelByName.get(modelName.toLowerCase()) ?? null;
          if (!model && modelName && modelName !== '/') {
            const newModelId = randomUUID();
            await db.insert(robotModels).values({ id: newModelId, name: modelName, type: 'Service Robot', payloadCapacity: '-', batteryLife: '-' });
            model = { id: newModelId, name: modelName };
            modelByName.set(modelName.toLowerCase(), model);
          }
          if (!model) {
            const first = allModels[0] ?? await db.query.robotModels.findFirst();
            if (!first) { stats.errors.push(`SN ${sn}: ไม่พบรุ่นหุ่นยนต์ในระบบ`); continue; }
            model = first;
          }
          await db.insert(robots).values({ id: randomUUID(), serialNumber: sn, puduMac: mac || null, status: 'In Stock', purchaseDate: new Date().toISOString().slice(0, 10), modelId: model.id, customerId: agentCustomerId });
          await logActivity(db, { entityType: 'Robot', entityId: sn, entityName: sn, action: 'created', newValues: { status: 'In Stock', agent: agentName, source: 'Unbound Excel Import' }, performedBy: user.username });
          stats.created++;
        }
      } catch (e) {
        stats.errors.push(`SN ${sn}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await logActivity(db, { entityType: 'UnboundImport', entityId: 'xlsx', action: 'import-status', performedBy: user.username, newValues: stats });
    return c.json({ totalRows: dataRows.length, ...stats });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Import failed' }, 500);
  }
});
