import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { cachedJson } from '../lib/read-cache';
import { maintenanceTickets, maintenanceSchedules, usedParts } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { createNotification } from '../lib/notifications';
import {
  createMaintenanceTicketFromInput, syncRobotStatusForTicket,
  isValidTransition, TICKET_TRANSITIONS, planTicketUsedParts, writeTicketUsedParts,
} from '../lib/maintenance';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

// Ticket columns that may be updated via PUT (guards against mass-assignment).
const TICKET_UPDATE_FIELDS = ['issueDescription', 'status', 'resolution', 'replacedParts', 'issueImageUrl', 'assignedTo', 'priorityLevel'] as const;

export const ticketsRoutes = new Hono<AppEnv>();

ticketsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  return cachedJson(c, 'tickets', ['MaintenanceTicket'], () => db.select().from(maintenanceTickets).orderBy(desc(maintenanceTickets.reportDate)));
});

ticketsRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const db = getDb(c.env.DB);
  const ticket = await createMaintenanceTicketFromInput(db, body, user.username);
  return c.json(ticket, 201);
});

ticketsRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const db = getDb(c.env.DB);

  const old = await db.query.maintenanceTickets.findFirst({ where: eq(maintenanceTickets.id, id) });
  if (!old) return c.json({ error: 'Not found' }, 404);

  if (body.status && body.status !== old.status) {
    if (!isValidTransition(TICKET_TRANSITIONS, old.status, body.status)) {
      return c.json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${old.status}" เป็น "${body.status}" ได้` }, 400);
    }
  }

  const data: Record<string, unknown> = {};
  for (const f of TICKET_UPDATE_FIELDS) if (f in body) data[f] = body[f];
  await db.update(maintenanceTickets).set(data).where(eq(maintenanceTickets.id, id));
  const ticket = (await db.query.maintenanceTickets.findFirst({ where: eq(maintenanceTickets.id, id) }))!;

  const statusChanged = old.status !== ticket.status;
  const action = statusChanged ? 'status_changed' : 'updated';
  if (statusChanged && ticket.robotId) await syncRobotStatusForTicket(db, ticket);
  if (statusChanged && ticket.status === 'Completed' && ticket.scheduleId) {
    await db.update(maintenanceSchedules).set({ lastCompletedAt: ticket.reportDate })
      .where(eq(maintenanceSchedules.id, ticket.scheduleId)).catch(() => {});
  }
  if (statusChanged) {
    const statusLabel: Record<string, string> = { Pending: 'รอดำเนินการ', 'In Progress': 'กำลังซ่อม', 'Waiting Quotation': 'รอใบเสนอราคา', 'Ready to Ship': 'รอส่งคืน', Completed: 'เสร็จสิ้น' };
    await createNotification(db, 'ticket_updated', `Ticket อัปเดต: ${statusLabel[ticket.status] || ticket.status}`, `Ticket #${ticket.id.slice(0, 8).toUpperCase()} เปลี่ยนจาก "${old.status}" → "${ticket.status}"`, 'MaintenanceTicket', ticket.id);
  }
  if (body.assignedTo && body.assignedTo !== old.assignedTo) {
    await createNotification(db, 'ticket_updated', `มอบหมายงานให้ ${body.assignedTo}`, `Ticket #${ticket.id.slice(0, 8).toUpperCase()} ถูกมอบหมายให้ ${body.assignedTo}`, 'MaintenanceTicket', ticket.id);
  }
  await logActivity(db, {
    entityType: 'MaintenanceTicket', entityId: ticket.id, action,
    oldValues: { status: old.status }, newValues: { status: ticket.status }, performedBy: user.username,
  });
  return c.json(ticket);
});

ticketsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  await db.delete(maintenanceTickets).where(eq(maintenanceTickets.id, id));
  await logActivity(db, {
    entityType: 'MaintenanceTicket', entityId: id, action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});

ticketsRoutes.post('/:id/tracking-token', authenticate, async (c) => {
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  let ticket = await db.query.maintenanceTickets.findFirst({ where: eq(maintenanceTickets.id, id) });
  if (!ticket) return c.json({ error: 'Not found' }, 404);
  if (!ticket.trackingToken) {
    await db.update(maintenanceTickets).set({ trackingToken: randomUUID() }).where(eq(maintenanceTickets.id, id));
    ticket = await db.query.maintenanceTickets.findFirst({ where: eq(maintenanceTickets.id, id) });
  }
  return c.json({ trackingToken: ticket!.trackingToken });
});

ticketsRoutes.get('/:id/used-parts', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.usedParts.findMany({
    where: eq(usedParts.ticketId, c.req.param('id')),
    with: { sparePart: true },
  });
  return c.json(rows);
});

// Replace a ticket's used parts, restoring/deducting spare-part stock accordingly.
ticketsRoutes.post('/:id/used-parts', authenticate, async (c) => {
  const ticketId = c.req.param('id');
  const body = await c.req.json();
  // Normalise at the boundary: quantity may arrive as a numeric string from non-UI clients.
  const newParts: Array<{ sparePartId: string; quantity: number; note?: string }> =
    (Array.isArray(body.parts) ? body.parts : []).map((p: any) => ({
      sparePartId: String(p?.sparePartId ?? ''),
      quantity: Number(p?.quantity),
      note: p?.note ?? null,
    }));
  const db = getDb(c.env.DB);

  // Plan the whole swap before writing anything — see lib/used-parts.ts for why.
  const plan = await planTicketUsedParts(db, ticketId, newParts);
  if ('error' in plan) return c.json({ error: plan.error }, 400);
  const created = await writeTicketUsedParts(db, ticketId, newParts, plan.deltas);
  return c.json(created);
});

// ── Public: customer repair tracking by token ────────────────────────────────
export const trackRoutes = new Hono<AppEnv>();

trackRoutes.get('/:token', async (c) => {
  const db = getDb(c.env.DB);
  const ticket = await db.query.maintenanceTickets.findFirst({
    where: eq(maintenanceTickets.trackingToken, c.req.param('token')),
    with: { robot: { with: { model: true } } },
  });
  if (!ticket) return c.json({ error: 'ไม่พบข้อมูลการซ่อม' }, 404);
  return c.json({
    id: ticket.id,
    status: ticket.status,
    reportDate: ticket.reportDate,
    issueDescription: ticket.issueDescription,
    resolution: ticket.resolution,
    robot: {
      serialNumber: ticket.robot.serialNumber,
      model: ticket.robot.model.name,
      type: ticket.robot.model.type,
    },
  });
});
