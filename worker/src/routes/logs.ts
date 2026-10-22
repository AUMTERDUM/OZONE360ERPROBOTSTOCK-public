import { Hono } from 'hono';
import { eq, and, desc, inArray } from 'drizzle-orm';
import { getDb } from '../db/client';
import { activityLogs, attachments, maintenanceTickets, deliveryNotes, usedParts, spareParts, maintenancePlanRobots, maintenanceVisits, robotLoanItems, robotLoans } from '../db/schema';
import { entityExists } from '../lib/entity-exists';
import { authenticate } from '../middleware/auth';
import type { AppEnv } from '../types';

export const logsRoutes = new Hono<AppEnv>();

logsRoutes.get('/', authenticate, async (c) => {
  const user = c.get('user');
  const entityType = c.req.query('entityType') || '';
  const entityId = c.req.query('entityId') || '';
  const isAdmin = user.role === 'ADMIN';
  if (!isAdmin && (!entityId || !entityType)) return c.json({ error: 'Forbidden' }, 403);

  const db = getDb(c.env.DB);
  if (entityType && entityId && !(await entityExists(db, entityType, entityId))) {
    return c.json({ error: 'Entity not found' }, 404);
  }
  const conds = [];
  if (entityType) conds.push(eq(activityLogs.entityType, entityType));
  if (entityId) conds.push(eq(activityLogs.entityId, entityId));
  const rows = await db.select().from(activityLogs)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(activityLogs.performedAt))
    .limit(entityId ? 100 : 500);
  return c.json(rows);
});

// ── Unified timeline (activity logs + attachments + related-entity events) ────
export const timelineRoutes = new Hono<AppEnv>();

interface TimelineEntry { type: string; date: string; action: string; user: string | null; details: unknown; oldValues: unknown; }

timelineRoutes.get('/:entityType/:entityId', authenticate, async (c) => {
  const entityType = c.req.param('entityType');
  const entityId = c.req.param('entityId');
  const db = getDb(c.env.DB);

  const logs = await db.select().from(activityLogs)
    .where(and(eq(activityLogs.entityType, entityType), eq(activityLogs.entityId, entityId)))
    .orderBy(desc(activityLogs.performedAt)).limit(100);
  const atts = await db.select().from(attachments)
    .where(and(eq(attachments.elementType, entityType), eq(attachments.elementId, entityId)))
    .orderBy(desc(attachments.uploadedAt));

  const timeline: TimelineEntry[] = [
    ...logs.map((l) => ({
      type: 'activity', date: l.performedAt, action: l.action, user: l.performedBy,
      details: l.newValues ? JSON.parse(l.newValues) : null,
      oldValues: l.oldValues ? JSON.parse(l.oldValues) : null,
    })),
    ...atts.map((a) => ({
      type: 'attachment', date: a.uploadedAt, action: 'attachment_added', user: a.uploadedBy,
      details: { filename: a.originalName, attachmentType: a.attachmentType, id: a.id }, oldValues: null,
    })),
  ];

  // Related events: robots surface their tickets' logs; customers surface their DN logs.
  let related: TimelineEntry[] = [];
  if (entityType === 'Robot') {
    const tks = await db.select().from(maintenanceTickets).where(eq(maintenanceTickets.robotId, entityId)).orderBy(desc(maintenanceTickets.reportDate)).limit(90);
    const ticketIds = tks.map((t) => t.id);
    const used = ticketIds.length ? await db.select({ ticket: usedParts.ticketId, part: spareParts.name, quantity: usedParts.quantity }).from(usedParts).innerJoin(spareParts, eq(usedParts.sparePartId, spareParts.id)).where(inArray(usedParts.ticketId, ticketIds)).limit(300) : [];
    related = tks.map((t) => ({ type: 'robot', date: t.reportDate, action: 'maintenance_ticket', user: null, details: { id: t.id, issueDescription: t.issueDescription, status: t.status, resolution: t.resolution, usedParts: used.filter((p) => p.ticket === t.id).map(({ part, quantity }) => ({ part, quantity })) }, oldValues: null }));
    const planLinks = await db.select({ planId: maintenancePlanRobots.planId }).from(maintenancePlanRobots).where(eq(maintenancePlanRobots.robotId, entityId)).limit(90);
    const planIds = planLinks.map((p) => p.planId);
    const visits = planIds.length ? await db.select().from(maintenanceVisits).where(inArray(maintenanceVisits.planId, planIds)).orderBy(desc(maintenanceVisits.scheduledDate)).limit(100) : [];
    related.push(...visits.map((v) => ({ type: 'maintenance_visit', date: v.completedAt || v.scheduledDate, action: 'maintenance_visit', user: v.technician, details: { visitNumber: v.visitNumber, status: v.status, summary: v.summary }, oldValues: null })));
    const loanLinks = await db.select({ loanId: robotLoanItems.loanId, returnedAt: robotLoanItems.returnedAt, condition: robotLoanItems.condition }).from(robotLoanItems).where(eq(robotLoanItems.robotId, entityId)).limit(90);
    const loanIds = loanLinks.map((l) => l.loanId);
    const loans = loanIds.length ? await db.select().from(robotLoans).where(inArray(robotLoans.id, loanIds)).limit(100) : [];
    related.push(...loans.map((l) => { const item = loanLinks.find((i) => i.loanId === l.id); return { type: 'loan', date: item?.returnedAt || l.loanDate, action: 'robot_loan', user: l.createdBy, details: { docNumber: l.docNumber, status: l.status, borrowerName: l.borrowerName, loanDate: l.loanDate, expectedReturn: l.expectedReturn, returnedAt: item?.returnedAt, condition: item?.condition }, oldValues: null }; }));
    // The robot's own activity logs are already in `timeline` above.
    const tLogs = ticketIds.length ? await db.select().from(activityLogs)
      .where(and(eq(activityLogs.entityType, 'MaintenanceTicket'), inArray(activityLogs.entityId, ticketIds)))
      .orderBy(desc(activityLogs.performedAt)).limit(200) : [];
    related.push(...tLogs.map((l) => ({ type: 'related', date: l.performedAt, action: `ticket.${l.action}`, user: l.performedBy, details: l.newValues ? JSON.parse(l.newValues) : null, oldValues: l.oldValues ? JSON.parse(l.oldValues) : null })));
  } else if (entityType === 'Customer') {
    const dns = await db.select({ id: deliveryNotes.id }).from(deliveryNotes).where(eq(deliveryNotes.customerId, entityId));
    const ids = dns.map((d) => d.id);
    const dLogs = ids.length ? await db.select().from(activityLogs)
      .where(and(eq(activityLogs.entityType, 'DeliveryNote'), inArray(activityLogs.entityId, ids)))
      .orderBy(desc(activityLogs.performedAt)).limit(200) : [];
    related = dLogs.map((l) => ({ type: 'related', date: l.performedAt, action: `delivery.${l.action}`, user: l.performedBy, details: l.newValues ? JSON.parse(l.newValues) : null, oldValues: l.oldValues ? JSON.parse(l.oldValues) : null }));
  }

  const full = [...timeline, ...related]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 200);
  return c.json(full);
});
