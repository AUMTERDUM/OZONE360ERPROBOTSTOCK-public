import { Hono } from 'hono';
import { and, eq, desc, gte, inArray, lte } from 'drizzle-orm';
import { getDb } from '../db/client';
import { customers, robots, robotModels, maintenanceTickets, deliveryNotes, maintenancePlans, maintenanceVisits } from '../db/schema';
import { createMaintenanceTicketFromInput } from '../lib/maintenance';
import { createNotification } from '../lib/notifications';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

// Public customer self-service portal, keyed by an opaque `portalToken` (no auth) —
// rate-limited at 30 req/min/IP to match the original portalLimiter.
export const portalRoutes = new Hono<AppEnv>();

portalRoutes.use('/*', rateLimit('PORTAL_LIMITER', 'Too many portal requests. Please try again in a minute.'));

portalRoutes.get('/:token/robots', async (c) => {
  const db = getDb(c.env.DB);
  const customer = await db.query.customers.findFirst({ where: eq(customers.portalToken, c.req.param('token')) });
  if (!customer) return c.json({ error: 'Invalid portal token' }, 404);
  const rs = await db.select({
    id: robots.id, serialNumber: robots.serialNumber, status: robots.status,
    purchaseDate: robots.purchaseDate, warrantyExpiresAt: robots.warrantyExpiresAt, modelId: robots.modelId,
  }).from(robots).where(eq(robots.customerId, customer.id));
  const models = await db.select({ id: robotModels.id, name: robotModels.name, type: robotModels.type }).from(robotModels);
  const modelMap = Object.fromEntries(models.map((m) => [m.id, m]));
  return c.json({
    customer: { name: customer.name },
    robots: rs.map((r) => ({ ...r, model: modelMap[r.modelId] || null })),
  });
});

portalRoutes.get('/:token/tickets', async (c) => {
  const db = getDb(c.env.DB);
  const customer = await db.query.customers.findFirst({ where: eq(customers.portalToken, c.req.param('token')) });
  if (!customer) return c.json({ error: 'Invalid portal token' }, 404);
  const rows = await db.select({
    id: maintenanceTickets.id, status: maintenanceTickets.status, reportDate: maintenanceTickets.reportDate,
    issueDescription: maintenanceTickets.issueDescription, resolution: maintenanceTickets.resolution,
    priorityLevel: maintenanceTickets.priorityLevel, robotId: maintenanceTickets.robotId,
    slaDueAt: maintenanceTickets.slaDueAt, slaBreachedAt: maintenanceTickets.slaBreachedAt,
  }).from(maintenanceTickets).where(eq(maintenanceTickets.customerId, customer.id))
    .orderBy(desc(maintenanceTickets.reportDate)).limit(50);
  return c.json(rows);
});

// Customer-visible MA visits are deliberately limited to a bounded date window
// and only expose the fields needed to plan/confirm a visit.
portalRoutes.get('/:token/ma-visits', async (c) => {
  const db = getDb(c.env.DB);
  const customer = await db.query.customers.findFirst({ where: eq(customers.portalToken, c.req.param('token')) });
  if (!customer) return c.json({ error: 'Invalid portal token' }, 404);
  const today = new Date();
  const from = new Date(today); from.setUTCFullYear(from.getUTCFullYear() - 1);
  const until = new Date(today); until.setUTCMonth(until.getUTCMonth() + 6);
  const fromKey = from.toISOString().slice(0, 10);
  const untilKey = until.toISOString().slice(0, 10);
  const plans = await db.select({ id: maintenancePlans.id })
    .from(maintenancePlans)
    .where(eq(maintenancePlans.customerId, customer.id))
    .limit(90); // D1 caps bound parameters per query at 100
  const planIds = plans.map((p) => p.id);
  if (!planIds.length) return c.json([]);
  const visits = await db.select({
    id: maintenanceVisits.id,
    visitNumber: maintenanceVisits.visitNumber,
    scheduledDate: maintenanceVisits.scheduledDate,
    status: maintenanceVisits.status,
    technician: maintenanceVisits.technician,
    summary: maintenanceVisits.summary,
  }).from(maintenanceVisits)
    .where(and(inArray(maintenanceVisits.planId, planIds), gte(maintenanceVisits.scheduledDate, fromKey), lte(maintenanceVisits.scheduledDate, untilKey)))
    .orderBy(desc(maintenanceVisits.scheduledDate)).limit(100);
  return c.json(visits);
});

portalRoutes.post('/:token/tickets', async (c) => {
  const db = getDb(c.env.DB);
  const customer = await db.query.customers.findFirst({ where: eq(customers.portalToken, c.req.param('token')) });
  if (!customer) return c.json({ error: 'Invalid portal token' }, 404);
  const { robotId, issueDescription } = await c.req.json();
  if (!robotId || !issueDescription) return c.json({ error: 'robotId and issueDescription required' }, 400);
  const robot = await db.query.robots.findFirst({ where: eq(robots.id, robotId) });
  if (!robot || robot.customerId !== customer.id) return c.json({ error: 'Robot does not belong to this customer' }, 400);

  const ticket = await createMaintenanceTicketFromInput(db, {
    robotId, customerId: customer.id, issueDescription, status: 'Pending', priorityLevel: 'Normal',
  }, `portal:${customer.name}`);
  await createNotification(db, 'ticket_updated', 'Portal: ลูกค้าแจ้งซ่อม', `${customer.name} แจ้งปัญหา: ${issueDescription.slice(0, 60)}`, 'MaintenanceTicket', ticket.id);
  return c.json({ id: ticket.id, trackingToken: ticket.trackingToken, status: ticket.status }, 201);
});

portalRoutes.get('/:token/delivery-notes', async (c) => {
  const db = getDb(c.env.DB);
  const customer = await db.query.customers.findFirst({ where: eq(customers.portalToken, c.req.param('token')) });
  if (!customer) return c.json({ error: 'Invalid portal token' }, 404);
  const rows = await db.select({
    id: deliveryNotes.id, docNumber: deliveryNotes.docNumber, deliveryDate: deliveryNotes.deliveryDate,
    status: deliveryNotes.status, trackingNumber: deliveryNotes.trackingNumber,
    installedAt: deliveryNotes.installedAt, acceptedAt: deliveryNotes.acceptedAt,
  }).from(deliveryNotes).where(eq(deliveryNotes.customerId, customer.id))
    .orderBy(desc(deliveryNotes.createdAt)).limit(50);
  return c.json(rows);
});
