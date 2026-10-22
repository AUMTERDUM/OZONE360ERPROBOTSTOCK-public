import { randomUUID } from 'node:crypto';
import { eq, and, ne, lte, inArray, count, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { maintenanceTickets, maintenanceSchedules, maintenancePlans, maintenancePlanRobots, maintenanceVisits, robots, users, usedParts, spareParts } from '../db/schema';
import { logActivity } from './activity-log';
import { addDays, addMonths } from './dates';
import { planUsedParts } from './used-parts';

export { TICKET_TRANSITIONS, isValidTransition } from './transitions';

// ── SLA config ────────────────────────────────────────────────────────────────
export const SLA_HOURS: Record<string, number> = { Critical: 4, High: 8, Normal: 24, Low: 72 };

export function computeSlaDueAt(reportDate: string, priorityLevel: string): string {
  const base = new Date(reportDate);
  const hours = SLA_HOURS[priorityLevel] ?? SLA_HOURS.Normal;
  base.setHours(base.getHours() + hours);
  return base.toISOString();
}

// ── Robot status sync driven by ticket status ────────────────────────────────
export async function syncRobotStatusForTicket(db: Db, ticket: { robotId: string; status: string }): Promise<void> {
  if (!ticket.robotId) return;
  if (['In Progress', 'Waiting Quotation', 'Ready to Ship', 'Pending'].includes(ticket.status)) {
    await db.update(robots).set({ status: 'In Maintenance' }).where(eq(robots.id, ticket.robotId));
    return;
  }
  if (ticket.status === 'Completed') {
    const robot = await db.query.robots.findFirst({ where: eq(robots.id, ticket.robotId) });
    if (robot && robot.status !== 'Missing') {
      const restoreStatus = robot.customerId ? 'Assigned' : 'In Stock';
      await db.update(robots).set({ status: restoreStatus }).where(eq(robots.id, ticket.robotId));
    }
  }
}

// Round-robin auto-assign: user with the fewest open tickets.
export async function autoAssignTechnician(db: Db): Promise<string | null> {
  const appUsers = await db.select({ username: users.username }).from(users);
  if (appUsers.length === 0) return null;
  const usernames = appUsers.map((u) => u.username);
  const grouped = await db.select({ assignedTo: maintenanceTickets.assignedTo, n: count() })
    .from(maintenanceTickets)
    .where(and(ne(maintenanceTickets.status, 'Completed'), inArray(maintenanceTickets.assignedTo, usernames)))
    .groupBy(maintenanceTickets.assignedTo);
  const countMap = new Map<string, number>();
  for (const g of grouped) if (g.assignedTo) countMap.set(g.assignedTo, g.n);
  const counts = appUsers.map((u) => ({ username: u.username, count: countMap.get(u.username) ?? 0 }));
  counts.sort((a, b) => a.count - b.count);
  return counts[0].username;
}

export interface TicketInput {
  robotId: string;
  issueDescription: string;
  status?: string;
  reportDate?: string;
  issueImageUrl?: string | null;
  customerId?: string | null;
  assignedTo?: string | null;
  priorityLevel?: string | null;
  scheduleId?: string | null;
}

export async function createMaintenanceTicketFromInput(db: Db, input: TicketInput, performedBy?: string) {
  const priority = input.priorityLevel || 'Normal';
  const assignedTo = input.assignedTo || await autoAssignTechnician(db);
  const reportDate = input.reportDate || new Date().toISOString().slice(0, 10);
  const slaHours = SLA_HOURS[priority] ?? SLA_HOURS.Normal;
  const slaDueAt = computeSlaDueAt(reportDate, priority);

  const newId = randomUUID();
  await db.insert(maintenanceTickets).values({
    id: newId,
    robotId: input.robotId,
    issueDescription: input.issueDescription,
    issueImageUrl: input.issueImageUrl ?? null,
    status: input.status || 'Pending',
    reportDate,
    trackingToken: randomUUID(),
    customerId: input.customerId ?? null,
    assignedTo,
    priorityLevel: priority,
    scheduleId: input.scheduleId ?? null,
    slaHours,
    slaDueAt,
  });
  const ticket = (await db.query.maintenanceTickets.findFirst({ where: eq(maintenanceTickets.id, newId) }))!;
  await syncRobotStatusForTicket(db, ticket);
  await logActivity(db, {
    entityType: 'MaintenanceTicket', entityId: ticket.id, action: 'created',
    newValues: input, performedBy,
  });
  return ticket;
}

export async function generateDueMaintenanceSchedules(db: Db, performedBy?: string) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const dueSchedules = await db.select().from(maintenanceSchedules)
    .where(and(eq(maintenanceSchedules.active, true), lte(maintenanceSchedules.nextDueDate, todayKey)));

  let created = 0;
  const generatedTickets = [];
  for (const schedule of dueSchedules) {
    const existingOpen = await db.query.maintenanceTickets.findFirst({
      where: and(eq(maintenanceTickets.scheduleId, schedule.id), ne(maintenanceTickets.status, 'Completed')),
    });
    if (existingOpen) continue;

    const robot = await db.query.robots.findFirst({ where: eq(robots.id, schedule.robotId) });
    const ticket = await createMaintenanceTicketFromInput(db, {
      robotId: schedule.robotId,
      customerId: schedule.customerId || robot?.customerId || null,
      issueDescription: `Preventive maintenance: ${schedule.title}`,
      status: 'Pending',
      reportDate: todayKey,
      assignedTo: schedule.assignedTo,
      priorityLevel: schedule.priorityLevel,
      scheduleId: schedule.id,
    }, performedBy);

    await db.update(maintenanceSchedules).set({
      lastGeneratedAt: todayKey,
      nextDueDate: addDays(schedule.nextDueDate, schedule.frequencyDays),
    }).where(eq(maintenanceSchedules.id, schedule.id));
    await logActivity(db, {
      entityType: 'MaintenanceSchedule', entityId: schedule.id, entityName: schedule.title,
      action: 'generated', newValues: { ticketId: ticket.id, generatedAt: todayKey }, performedBy,
    });
    created += 1;
    generatedTickets.push(ticket);
  }
  return { created, generatedTickets };
}

// ── MA plan visit generation ─────────────────────────────────────────────────
export function buildPlanVisitDates(startDate: string, endDate: string | null, intervalMonths: number): string[] {
  const dates: string[] = [];
  const interval = Math.max(1, Number(intervalMonths) || 3);
  const cap = endDate || addMonths(startDate, interval * 24); // safety cap for open-ended plans
  let cursor = addMonths(startDate, interval);
  let guard = 0;
  while (cursor <= cap && guard < 200) {
    dates.push(cursor);
    cursor = addMonths(cursor, interval);
    guard += 1;
  }
  return dates;
}

export async function regeneratePlanVisits(db: Db, planId: string): Promise<{ created: number; kept: number }> {
  const plan = await db.query.maintenancePlans.findFirst({ where: eq(maintenancePlans.id, planId) });
  if (!plan) return { created: 0, kept: 0 };
  const wantedDates = buildPlanVisitDates(plan.startDate, plan.endDate, plan.intervalMonths);
  const existing = await db.select().from(maintenanceVisits).where(eq(maintenanceVisits.planId, planId));
  const existingByDate = new Map(existing.map((v) => [v.scheduledDate, v]));

  // Delete future Scheduled visits no longer wanted.
  const wantedSet = new Set(wantedDates);
  const stale = existing.filter((v) => v.status === 'Scheduled' && !wantedSet.has(v.scheduledDate));
  for (const v of stale) {
    await db.delete(maintenanceVisits).where(eq(maintenanceVisits.id, v.id));
  }

  let created = 0;
  let kept = 0;
  let visitNumber = 0;
  for (const date of wantedDates) {
    visitNumber += 1;
    const found = existingByDate.get(date);
    if (found) {
      if (found.visitNumber !== visitNumber) {
        await db.update(maintenanceVisits).set({ visitNumber }).where(eq(maintenanceVisits.id, found.id));
      }
      kept += 1;
      continue;
    }
    await db.insert(maintenanceVisits).values({ id: randomUUID(), planId, visitNumber, scheduledDate: date, status: 'Scheduled' });
    created += 1;
  }
  return { created, kept };
}

// ── Used parts ───────────────────────────────────────────────────────────────
export interface UsedPartInput { sparePartId: string; quantity: number; note?: string | null }

/**
 * Checks a replacement set of used parts for a ticket against stock without writing anything.
 * Returns the stock deltas to apply, or an error message.
 */
export async function planTicketUsedParts(db: Db, ticketId: string | null, parts: UsedPartInput[]) {
  const existing = ticketId ? await db.select().from(usedParts).where(eq(usedParts.ticketId, ticketId)) : [];
  const ids = [...new Set([...existing, ...parts].map((p) => p.sparePartId))];
  const catalog = ids.length
    ? await db.select().from(spareParts).where(sql`${spareParts.id} in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
    : [];
  const stockById = Object.fromEntries(catalog.map((p) => [p.id, p.stock]));
  const nameById = Object.fromEntries(catalog.map((p) => [p.id, p.name]));
  return planUsedParts(existing, parts, stockById, nameById);
}

/** Replaces a ticket's used parts and moves spare-part stock to match. Validate with planTicketUsedParts first. */
export async function writeTicketUsedParts(db: Db, ticketId: string, parts: UsedPartInput[], deltas: Map<string, number>) {
  await db.delete(usedParts).where(eq(usedParts.ticketId, ticketId));
  for (const [sparePartId, delta] of deltas) {
    await db.update(spareParts).set({ stock: sql`max(0, ${spareParts.stock} + ${delta})` }).where(eq(spareParts.id, sparePartId));
  }
  const created = [];
  for (const p of parts) {
    const newId = randomUUID();
    await db.insert(usedParts).values({ id: newId, ticketId, sparePartId: p.sparePartId, quantity: p.quantity, note: p.note ?? null });
    created.push(await db.query.usedParts.findFirst({ where: eq(usedParts.id, newId) }));
  }
  return created;
}

// ── MA visit → tickets ───────────────────────────────────────────────────────
// A finished MA visit turns its findings into tickets, so nothing found on site is lost in a PDF:
// a robot with failing items gets an open ticket; one repaired on site (or that used parts) gets a
// Completed ticket that records the parts, which deducts stock and can be invoiced like any repair.
export interface VisitCheck {
  serialNumber: string;
  condition?: string;
  notes?: string;
  model?: string;
  items?: Record<string, { result?: string; note?: string; label?: string }>;
  parts?: unknown;
  ticketId?: string;
}

const itemLines = (check: VisitCheck, result: string) =>
  Object.entries(check.items ?? {})
    .filter(([, r]) => r?.result === result)
    .map(([id, r]) => `- ${r.label || id}${r.note ? `: ${r.note}` : ''}`);

export function normalizeVisitParts(raw: unknown): UsedPartInput[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => ({ sparePartId: String(p?.sparePartId ?? ''), quantity: Number(p?.quantity), note: p?.note ? String(p.note) : null }))
    .filter((p) => p.sparePartId);
}

export type VisitTicketPlan = { check: VisitCheck; robotId: string; customerId: string | null; parts: UsedPartInput[]; deltas: Map<string, number> };

/** Works out which checks need a ticket and validates their parts against stock. Writes nothing. */
export async function planVisitTickets(db: Db, checks: VisitCheck[]): Promise<{ error: string } | { plans: VisitTicketPlan[] }> {
  const plans: VisitTicketPlan[] = [];
  // Several robots can draw on the same part, so track the running total across checks.
  const pending = new Map<string, number>();
  for (const check of checks) {
    const parts = normalizeVisitParts(check.parts);
    const hasIssue = itemLines(check, 'Issue').length > 0 || check.condition === 'Issue';
    const hasRepair = itemLines(check, 'Repaired').length > 0 || check.condition === 'Repaired';
    if (!check.ticketId && !hasIssue && !hasRepair && parts.length === 0) continue;
    const robot = await db.query.robots.findFirst({ where: eq(robots.serialNumber, String(check.serialNumber || '').toUpperCase()) });
    if (!robot) {
      if (parts.length) return { error: `ไม่พบหุ่นยนต์ SN ${check.serialNumber} — บันทึกอะไหล่ไม่ได้` };
      continue;
    }
    const plan = await planTicketUsedParts(db, check.ticketId ?? null, parts);
    if ('error' in plan) return { error: `${check.serialNumber}: ${plan.error}` };
    for (const [id, delta] of plan.deltas) {
      const total = (pending.get(id) ?? 0) + delta;
      pending.set(id, total);
      if (total < 0) {
        const part = await db.query.spareParts.findFirst({ where: eq(spareParts.id, id) });
        if (part && part.stock + total < 0) return { error: `${part.name}: สต็อกไม่พอสำหรับทุกเครื่องในรอบนี้ (มี ${part.stock}, ต้องใช้ ${-total})` };
      }
    }
    plans.push({ check, robotId: robot.id, customerId: robot.customerId, parts, deltas: plan.deltas });
  }
  return { plans };
}

/** Creates/updates the tickets planned by planVisitTickets and stamps ticketId onto each check. */
export async function applyVisitTickets(
  db: Db,
  visit: { id: string; visitNumber: number; scheduledDate: string; technician?: string | null },
  plans: VisitTicketPlan[],
  performedBy?: string,
): Promise<number> {
  let created = 0;
  for (const p of plans) {
    let ticketId = p.check.ticketId;
    if (ticketId) {
      const existing = await db.query.maintenanceTickets.findFirst({ where: eq(maintenanceTickets.id, ticketId) });
      if (!existing) ticketId = undefined; // the ticket was deleted; open a fresh one
    }
    if (!ticketId) {
      const issues = itemLines(p.check, 'Issue');
      const repaired = itemLines(p.check, 'Repaired');
      const open = issues.length > 0 || p.check.condition === 'Issue';
      const header = `พบระหว่าง MA รอบที่ ${visit.visitNumber} (${visit.scheduledDate})`;
      const description = [header, ...(open ? issues : repaired), p.check.notes ? `หมายเหตุ: ${p.check.notes}` : '']
        .filter(Boolean).join('\n');
      const ticket = await createMaintenanceTicketFromInput(db, {
        robotId: p.robotId,
        customerId: p.customerId,
        issueDescription: description,
        status: open ? 'Pending' : 'Completed',
        assignedTo: visit.technician || null,
        reportDate: visit.scheduledDate,
      }, performedBy);
      if (!open) {
        await db.update(maintenanceTickets).set({ resolution: [`ซ่อมระหว่าง MA รอบที่ ${visit.visitNumber}`, ...repaired].join('\n') })
          .where(eq(maintenanceTickets.id, ticket.id));
      }
      ticketId = ticket.id;
      created += 1;
    }
    if (p.parts.length || p.deltas.size) await writeTicketUsedParts(db, ticketId, p.parts, p.deltas);
    p.check.ticketId = ticketId;
  }
  return created;
}

// ── Delivery → warranty + MA plan ────────────────────────────────────────────
export const DEFAULT_WARRANTY_MONTHS = 12;
export const DEFAULT_MA_INTERVAL_MONTHS = 3;

/**
 * Called when delivered robots are installed at a customer: fills in a missing warranty end date
 * and makes sure an MA plan covers them (creating a warranty-length plan if the customer has none).
 */
export async function setupDeliveredRobots(
  db: Db,
  input: { customerId: string; robotIds: string[]; installedAt: string; docNumber: string },
  performedBy?: string,
): Promise<{ warrantySet: number; planId: string | null; planCreated: boolean }> {
  let warrantySet = 0;
  const warrantyEnd = addMonths(input.installedAt, DEFAULT_WARRANTY_MONTHS);
  for (const robotId of input.robotIds) {
    const robot = await db.query.robots.findFirst({ where: eq(robots.id, robotId) });
    if (!robot || robot.warrantyExpiresAt) continue;
    await db.update(robots).set({ warrantyExpiresAt: warrantyEnd }).where(eq(robots.id, robotId));
    await logActivity(db, {
      entityType: 'Robot', entityId: robotId, entityName: robot.serialNumber, action: 'updated',
      oldValues: { warrantyExpiresAt: null }, newValues: { warrantyExpiresAt: warrantyEnd, deliveryNote: input.docNumber }, performedBy,
    });
    warrantySet += 1;
  }
  if (input.robotIds.length === 0) return { warrantySet, planId: null, planCreated: false };

  const plan = await db.query.maintenancePlans.findFirst({
    where: and(eq(maintenancePlans.customerId, input.customerId), eq(maintenancePlans.active, true)),
  });
  if (plan) {
    // A plan without robot rows already covers every robot of the customer.
    const links = await db.select().from(maintenancePlanRobots).where(eq(maintenancePlanRobots.planId, plan.id));
    if (links.length) {
      const have = new Set(links.map((l) => l.robotId));
      const missing = input.robotIds.filter((id) => !have.has(id));
      if (missing.length) await db.insert(maintenancePlanRobots).values(missing.map((robotId) => ({ planId: plan.id, robotId })));
    }
    return { warrantySet, planId: plan.id, planCreated: false };
  }

  const planId = randomUUID();
  await db.insert(maintenancePlans).values({
    id: planId, customerId: input.customerId, startDate: input.installedAt, endDate: warrantyEnd,
    intervalMonths: DEFAULT_MA_INTERVAL_MONTHS, active: true,
    notes: `สร้างอัตโนมัติจากใบส่งของ ${input.docNumber} (MA ช่วงรับประกัน)`,
  });
  await db.insert(maintenancePlanRobots).values(input.robotIds.map((robotId) => ({ planId, robotId })));
  await regeneratePlanVisits(db, planId);
  await logActivity(db, {
    entityType: 'MaintenancePlan', entityId: planId, action: 'created',
    newValues: { customerId: input.customerId, robotIds: input.robotIds, source: input.docNumber }, performedBy,
  });
  return { warrantySet, planId, planCreated: true };
}
