import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, and, asc, desc, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cachedJson } from '../lib/read-cache';
import { customers, contacts, sites, robots, maintenanceTickets, activityLogs, spareParts } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { pickFields } from '../lib/pick-fields';
import { moveToTrash } from '../lib/trash';
import { syncFromPudu } from '../lib/pudu-sync';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const CUSTOMER_FIELDS = ['name', 'contactPerson', 'email', 'phone', 'address', 'logoUrl', 'type', 'agentCode', 'puduShopId', 'puduCompanyId'] as const;
const CONTACT_FIELDS = ['name', 'role', 'email', 'phone', 'lineId', 'isPrimary'] as const;
const SITE_FIELDS = ['name', 'address', 'province', 'lat', 'lng', 'notes'] as const;

// ── /api/customers ────────────────────────────────────────────────────────────
export const customersRoutes = new Hono<AppEnv>();

customersRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  return cachedJson(c, 'customers', ['Customer'], () => db.select().from(customers).orderBy(asc(customers.name)));
});

customersRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'กรุณาระบุชื่อลูกค้า' }, 400);

  const db = getDb(c.env.DB);
  // libsql/D1 has no case-insensitive filter — do the dedupe check in JS, as the original does.
  const allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers);
  const existing = allCustomers.find((cust) => cust.name.toLowerCase() === name.toLowerCase());
  if (existing) return c.json({ error: `มีลูกค้าชื่อ "${existing.name}" อยู่แล้ว` }, 409);

  const newId = randomUUID();
  await db.insert(customers).values({
    id: newId,
    name,
    contactPerson: body.contactPerson || '',
    email: body.email || '',
    phone: body.phone || '',
    address: body.address || '',
    logoUrl: body.logoUrl || null,
    type: body.type || 'customer',
    agentCode: body.agentCode || null,
    puduShopId: body.puduShopId || null,
    puduCompanyId: body.puduCompanyId || null,
  });
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, newId) });
  await logActivity(db, {
    entityType: 'Customer', entityId: newId, entityName: name,
    action: 'created', newValues: body, performedBy: user.username,
  });
  return c.json(customer, 201);
});

customersRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = pickFields<typeof customers.$inferInsert>(body, CUSTOMER_FIELDS);

  const db = getDb(c.env.DB);
  const old = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  await db.update(customers).set(data).where(eq(customers.id, id));
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  await logActivity(db, {
    entityType: 'Customer', entityId: id, entityName: customer?.name,
    action: 'updated', oldValues: old, newValues: data, performedBy: user.username,
  });
  return c.json(customer);
});

// POST /api/customers/:id/link-pudu — link customer to a Pudu shop & merge duplicate.
customersRoutes.post('/:id/link-pudu', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { puduShopId } = body;
  if (!puduShopId) return c.json({ error: 'puduShopId required' }, 400);

  const db = getDb(c.env.DB);
  const target = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!target) return c.json({ error: 'Customer not found' }, 404);

  const duplicate = await db.query.customers.findFirst({ where: eq(customers.puduShopId, puduShopId) });
  let movedRobots = 0;

  if (duplicate && duplicate.id !== target.id) {
    const moved = await db.update(robots).set({ customerId: target.id }).where(eq(robots.customerId, duplicate.id));
    movedRobots = moved.meta.changes ?? 0;
    await db.update(maintenanceTickets).set({ customerId: target.id }).where(eq(maintenanceTickets.customerId, duplicate.id));
    await moveToTrash(db, {
      entityType: 'Customer', entityId: duplicate.id, entityName: duplicate.name,
      entity: duplicate, deletedBy: user.username,
    }).catch(() => {});
    await db.delete(customers).where(eq(customers.id, duplicate.id));
  }

  await db.update(customers)
    .set({ puduShopId, ...(body.puduCompanyId ? { puduCompanyId: body.puduCompanyId } : {}) })
    .where(eq(customers.id, target.id));
  const updated = await db.query.customers.findFirst({ where: eq(customers.id, target.id) });

  // Auto-sync robots from this Pudu shop so they appear immediately.
  let syncResult = null;
  try {
    syncResult = await syncFromPudu(db, c.env, puduShopId);
  } catch { /* sync failure should not fail the link */ }

  await logActivity(db, {
    entityType: 'Customer', entityId: target.id, entityName: target.name,
    action: 'updated',
    oldValues: { puduShopId: target.puduShopId },
    newValues: { puduShopId, movedRobots, mergedFrom: duplicate?.id, synced: syncResult?.robotsCreated },
    performedBy: user.username,
  });

  return c.json({ success: true, customer: updated, movedRobots, mergedFrom: duplicate?.id || null, syncResult });
});

customersRoutes.post('/:id/portal-token', authenticate, requireAdmin, async (c) => {
  const id = c.req.param('id');
  const token = randomUUID();
  const db = getDb(c.env.DB);
  await db.update(customers).set({ portalToken: token }).where(eq(customers.id, id));
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  return c.json({ portalToken: token, customerName: customer?.name });
});

customersRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const customer = await db.query.customers.findFirst({ where: eq(customers.id, id) });
  if (!customer) return c.json({ error: 'Not found' }, 404);
  await moveToTrash(db, {
    entityType: 'Customer', entityId: customer.id, entityName: customer.name,
    entity: customer, deletedBy: user.username,
  });
  await db.delete(customers).where(eq(customers.id, id));
  await logActivity(db, {
    entityType: 'Customer', entityId: id, entityName: customer.name,
    action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});

// ── Contacts (nested under customer for list/create) ─────────────────────────
customersRoutes.get('/:id/contacts', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(contacts)
    .where(eq(contacts.customerId, c.req.param('id')))
    .orderBy(desc(contacts.createdAt));
  return c.json(rows);
});

customersRoutes.post('/:id/contacts', authenticate, async (c) => {
  const body = await c.req.json();
  const data = pickFields<typeof contacts.$inferInsert>(body, CONTACT_FIELDS);
  if (!data.name) return c.json({ error: 'name is required' }, 400);
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(contacts).values({ id: newId, customerId: c.req.param('id'), ...data, name: data.name });
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, newId) });
  return c.json(contact, 201);
});

// ── Sites (nested under customer for list/create) ────────────────────────────
customersRoutes.get('/:id/sites', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select().from(sites)
    .where(eq(sites.customerId, c.req.param('id')))
    .orderBy(desc(sites.createdAt));
  return c.json(rows);
});

customersRoutes.post('/:id/sites', authenticate, async (c) => {
  const body = await c.req.json();
  const data = pickFields<typeof sites.$inferInsert>(body, SITE_FIELDS);
  if (!data.name) return c.json({ error: 'name is required' }, 400);
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(sites).values({ id: newId, customerId: c.req.param('id'), ...data, name: data.name });
  const site = await db.query.sites.findFirst({ where: eq(sites.id, newId) });
  return c.json(site, 201);
});

// GET /api/customers/:id/part-transfers — spare-part transfer logs targeting this customer
customersRoutes.get('/:id/part-transfers', authenticate, async (c) => {
  const customerId = c.req.param('id');
  const db = getDb(c.env.DB);
  const logs = await db.select().from(activityLogs)
    .where(and(eq(activityLogs.entityType, 'SparePart'), sql`${activityLogs.action} in ('transferred', 'item_scanned_out')`))
    .orderBy(desc(activityLogs.performedAt))
    .limit(1000);
  const filtered = logs.filter((l) => {
    try { return JSON.parse(l.newValues || '{}').customerId === customerId; }
    catch { return false; }
  });
  const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts);
  const names = new Map(parts.map((part) => [part.id, part.name]));
  return c.json(filtered.map((log) => ({ ...log, entityName: names.get(log.entityId) || log.entityName })));
});

// GET /api/customers/:id/robots/:robotId/part-transfers — parts assigned to a unit
customersRoutes.get('/:id/robots/:robotId/part-transfers', authenticate, async (c) => {
  const customerId = c.req.param('id');
  const robotId = c.req.param('robotId');
  const db = getDb(c.env.DB);
  const logs = await db.select().from(activityLogs)
    .where(and(eq(activityLogs.entityType, 'SparePart'), eq(activityLogs.action, 'transferred')))
    .orderBy(desc(activityLogs.performedAt))
    .limit(1000);
  const filtered = logs.filter((l) => {
    try {
      const values = JSON.parse(l.newValues || '{}');
      return values.customerId === customerId && values.robotId === robotId;
    } catch { return false; }
  });
  const parts = await db.select({ id: spareParts.id, name: spareParts.name }).from(spareParts);
  const names = new Map(parts.map((part) => [part.id, part.name]));
  return c.json(filtered.map((log) => ({ ...log, entityName: names.get(log.entityId) || log.entityName })));
});

// ── /api/contacts (standalone update/delete) ─────────────────────────────────
export const contactsRoutes = new Hono<AppEnv>();

contactsRoutes.put('/:id', authenticate, async (c) => {
  const body = await c.req.json();
  const data = pickFields<typeof contacts.$inferInsert>(body, CONTACT_FIELDS);
  const db = getDb(c.env.DB);
  await db.update(contacts).set(data).where(eq(contacts.id, c.req.param('id')));
  const contact = await db.query.contacts.findFirst({ where: eq(contacts.id, c.req.param('id')) });
  return c.json(contact);
});

contactsRoutes.delete('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(contacts).where(eq(contacts.id, c.req.param('id')));
  return c.json({ success: true });
});

// ── /api/sites (standalone update/delete) ────────────────────────────────────
export const sitesRoutes = new Hono<AppEnv>();

sitesRoutes.put('/:id', authenticate, async (c) => {
  const body = await c.req.json();
  const data = pickFields<typeof sites.$inferInsert>(body, SITE_FIELDS);
  const db = getDb(c.env.DB);
  await db.update(sites).set(data).where(eq(sites.id, c.req.param('id')));
  const site = await db.query.sites.findFirst({ where: eq(sites.id, c.req.param('id')) });
  return c.json(site);
});

sitesRoutes.delete('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  await db.delete(sites).where(eq(sites.id, c.req.param('id')));
  return c.json({ success: true });
});
