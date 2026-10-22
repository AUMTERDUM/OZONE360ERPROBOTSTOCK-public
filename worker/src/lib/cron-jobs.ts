import { and, eq, inArray, isNull, lt, ne, gte, lte, desc, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { robotLoans, notifications, maintenanceTickets, maintenanceVisits, maintenancePlans, customers, robots, spareParts, purchaseOrders, purchaseOrderItems } from '../db/schema';
import { createNotification } from './notifications';
import { generateDueMaintenanceSchedules } from './maintenance';
import { runAutoBackup } from './backup';
import { syncFromPudu } from './pudu-sync';
import { docNumber } from './doc-number';
import { randomUUID } from 'node:crypto';

// Daily 00:00 — logical JSON backup to R2 (see lib/backup.ts for why this
// replaces the original's VACUUM INTO file copy).
export async function dailyBackupJob(db: Db, bucket: R2Bucket): Promise<void> {
  await runAutoBackup(db, bucket);
  await pruneOldNotifications(db);
  await weeklyMaintenanceSummary(db);
  await warrantyExpiryAlerts(db);
  await lowStockDraftPo(db);
}

function thaiDate(offsetDays = 0): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const base = `${parts.find(p => p.type === 'year')!.value}-${parts.find(p => p.type === 'month')!.value}-${parts.find(p => p.type === 'day')!.value}`;
  const d = new Date(`${base}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString().slice(0, 10);
}

async function weeklyMaintenanceSummary(db: Db): Promise<void> {
  const today = thaiDate();
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  if (weekday !== 1) return;
  const monday = today;
  const sunday = thaiDate(6);
  const marker = `week:${monday}`;
  const exists = await db.query.notifications.findFirst({ where: and(eq(notifications.type, 'ma_weekly'), eq(notifications.entityId, marker)) });
  if (exists) return;
  const visits = await db.select({ date: maintenanceVisits.scheduledDate, customerId: maintenancePlans.customerId })
    .from(maintenanceVisits).innerJoin(maintenancePlans, eq(maintenanceVisits.planId, maintenancePlans.id))
    .where(and(eq(maintenanceVisits.status, 'Scheduled'), gte(maintenanceVisits.scheduledDate, monday), lte(maintenanceVisits.scheduledDate, sunday))).limit(500);
  const overdue = await db.select({ customerId: maintenancePlans.customerId }).from(maintenanceVisits).innerJoin(maintenancePlans, eq(maintenanceVisits.planId, maintenancePlans.id))
    .where(and(eq(maintenanceVisits.status, 'Scheduled'), lt(maintenanceVisits.scheduledDate, monday))).limit(500);
  const ids = [...new Set([...visits, ...overdue].map(v => v.customerId))];
  const names = ids.length ? await db.select({ id: customers.id, name: customers.name }).from(customers).where(inArray(customers.id, ids.slice(0, 90))) : [];
  const nameMap = new Map(names.map(c => [c.id, c.name]));
  const customerNames = [...new Set(visits.map(v => nameMap.get(v.customerId)).filter(Boolean))].slice(0, 8).join(', ');
  await createNotification(db, 'ma_weekly', `MA สัปดาห์นี้ (${monday} ถึง ${sunday})`, `นัดหมาย ${visits.length} รายการ (${customerNames || 'ไม่มีรายชื่อลูกค้า'}) และค้างเกินกำหนด ${overdue.length} รายการ`, 'MaintenanceVisit', marker);
}

async function warrantyExpiryAlerts(db: Db): Promise<void> {
  const today = thaiDate();
  const customersById = new Map((await db.select({ id: customers.id, name: customers.name }).from(customers).limit(500)).map(c => [c.id, c.name]));
  for (const threshold of [60, 30]) {
    const date = thaiDate(threshold);
    const rows = await db.select().from(robots).where(eq(robots.warrantyExpiresAt, date)).limit(500);
    for (const robot of rows) {
      const marker = `threshold:${threshold}`;
      const exists = await db.query.notifications.findFirst({ where: and(eq(notifications.type, 'warranty_expiring'), eq(notifications.entityType, 'Robot'), eq(notifications.entityId, robot.id), gte(notifications.createdAt, `${today} 00:00:00`)) });
      if (!exists) await createNotification(db, 'warranty_expiring', `ประกันใกล้หมดอายุใน ${threshold} วัน: ${robot.serialNumber}`, `${customersById.get(robot.customerId || '') || 'ไม่ระบุลูกค้า'} · สิ้นสุด ${date} · ${marker}`, 'Robot', robot.id);
    }
  }
}

async function lowStockDraftPo(db: Db): Promise<void> {
  const low = await db.select().from(spareParts).where(and(gtZero(spareParts.minStock), lte(spareParts.stock, spareParts.minStock))).limit(500);
  if (!low.length) return;
  const openOrders = await db.select({ id: purchaseOrders.id }).from(purchaseOrders).where(inArray(purchaseOrders.status, ['Draft', 'Ordered', 'Partial'])).limit(200);
  const openItems = [] as Array<typeof purchaseOrderItems.$inferSelect>;
  for (let i = 0; i < openOrders.length; i += 90) {
    openItems.push(...await db.select().from(purchaseOrderItems).where(inArray(purchaseOrderItems.purchaseOrderId, openOrders.slice(i, i + 90).map(o => o.id))).limit(1000));
  }
  const covered = new Set(openItems.map(i => i.sparePartId).filter(Boolean));
  const needed = low.filter(p => !covered.has(p.id));
  if (!needed.length) return;
  let draft = await db.query.purchaseOrders.findFirst({ where: and(eq(purchaseOrders.status, 'Draft'), eq(purchaseOrders.createdBy, 'system')), orderBy: desc(purchaseOrders.createdAt), with: { items: true } });
  if (!draft) {
    const id = randomUUID();
    await db.insert(purchaseOrders).values({ id, docNumber: docNumber('PO'), orderDate: thaiDate(), supplier: 'ระบบ', status: 'Draft', createdBy: 'system', totalAmount: 0 });
    draft = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, id), with: { items: true } });
  }
  if (!draft) return;
  for (const part of needed) await db.insert(purchaseOrderItems).values({ id: randomUUID(), purchaseOrderId: draft.id, sparePartId: part.id, sku: part.sku, partName: part.name, quantity: Math.max(part.minStock * 2 - part.stock, 1), unitPrice: part.unitPrice, receivedQty: 0, remark: 'สร้างอัตโนมัติจากสต็อกต่ำ' });
  const items = await db.select({ quantity: purchaseOrderItems.quantity, unitPrice: purchaseOrderItems.unitPrice }).from(purchaseOrderItems).where(eq(purchaseOrderItems.purchaseOrderId, draft.id));
  await db.update(purchaseOrders).set({ totalAmount: items.reduce((s, i) => s + i.quantity * i.unitPrice, 0) }).where(eq(purchaseOrders.id, draft.id));
  // Own type so it isn't counted as a stock alert in /stats/dashboard-trends.
  await createNotification(db, 'po_draft', `สร้าง/ขยาย PO ร่าง ${draft.docNumber}`, `เพิ่มอะไหล่สต็อกต่ำ ${needed.length} รายการ`, 'PurchaseOrder', draft.id);
}

const gtZero = (column: any) => sql`${column} > 0`;

// Notifications are never deleted otherwise, and every open tab lists them on a poll —
// keep the table small so it stays cheap on D1's rows_read quota.
async function pruneOldNotifications(db: Db): Promise<void> {
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().replace('T', ' ').slice(0, 19);
  await db.delete(notifications).where(and(eq(notifications.read, true), lt(notifications.createdAt, daysAgo(30))));
  await db.delete(notifications).where(lt(notifications.createdAt, daysAgo(180)));
}

// Auto-skip MA visits overdue by more than 180 days (used to run on every GET /ma-plans).
async function skipStaleMaVisits(db: Db): Promise<void> {
  const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10);
  await db.update(maintenanceVisits).set({ status: 'Skipped' })
    .where(and(eq(maintenanceVisits.status, 'Scheduled'), lt(maintenanceVisits.scheduledDate, cutoff)));
}

// Daily 08:00 — notify on robot loans past their expected return date.
export async function overdueLoanAlertJob(db: Db): Promise<void> {
  const today = new Date().toISOString().split('T')[0];
  // SQLite's CURRENT_TIMESTAMP (used for `createdAt` defaults) formats as
  // "YYYY-MM-DD HH:MM:SS" — match that exactly so the string comparison below
  // (D1/SQLite has no DATE type) sorts correctly instead of comparing 'T' vs ' '.
  const todayStart = `${today} 00:00:00`;
  const overdueLoans = await db.select().from(robotLoans)
    .where(and(inArray(robotLoans.status, ['Active', 'Approved']), lt(robotLoans.expectedReturn, today)));

  for (const loan of overdueLoans) {
    const existing = await db.query.notifications.findFirst({
      where: and(eq(notifications.entityId, loan.id), eq(notifications.type, 'overdue_loan'), gte(notifications.createdAt, todayStart)),
    });
    if (!existing) {
      await createNotification(db, 'overdue_loan', `ใบยืมเกินกำหนดคืน: ${loan.docNumber}`, `${loan.borrowerName} กำหนดคืน ${loan.expectedReturn} (เกินกำหนด)`, 'RobotLoan', loan.id);
    }
  }
}

// Hourly — SLA breach detection + escalation, plus due-maintenance-schedule generation
// (the original bundles all three into the same hourly cron.schedule call).
export async function slaAndScheduleJob(db: Db): Promise<void> {
  const now = new Date().toISOString();

  const breached = await db.select().from(maintenanceTickets)
    .where(and(ne(maintenanceTickets.status, 'Completed'), lt(maintenanceTickets.slaDueAt, now), isNull(maintenanceTickets.slaBreachedAt)));
  for (const t of breached) {
    await db.update(maintenanceTickets).set({ slaBreachedAt: now, escalationLevel: 1 }).where(eq(maintenanceTickets.id, t.id));
    await createNotification(db, 'ticket_updated', `SLA Breached: Ticket #${t.id.slice(0, 8).toUpperCase()}`, `Ticket "${t.issueDescription.slice(0, 60)}" has exceeded its SLA deadline`, 'MaintenanceTicket', t.id);
  }

  const escalatable = await db.select().from(maintenanceTickets)
    .where(and(ne(maintenanceTickets.status, 'Completed'), eq(maintenanceTickets.escalationLevel, 1)));
  for (const t of escalatable) {
    if (!t.slaDueAt || !t.slaBreachedAt) continue;
    const slaMs = new Date(t.slaDueAt).getTime() - new Date(t.reportDate).getTime();
    if (Date.now() - new Date(t.slaBreachedAt).getTime() > slaMs) {
      await db.update(maintenanceTickets).set({ escalationLevel: 2 }).where(eq(maintenanceTickets.id, t.id));
      await createNotification(db, 'ticket_updated', `SLA Critical: Ticket #${t.id.slice(0, 8).toUpperCase()}`, 'Ticket escalated to level 2 — needs admin attention', 'MaintenanceTicket', t.id);
    }
  }

  await generateDueMaintenanceSchedules(db, 'system');
  await skipStaleMaVisits(db);
}

// Every 6 hours — Pudu auto-sync (replaces the original's `setInterval(..., 6h)`,
// which doesn't survive Worker isolate recycling the way a Cron Trigger does).
export async function puduAutoSyncJob(db: Db, env: { PUDUAPIKEY: string; PUDUAPIsecret: string }): Promise<void> {
  await syncFromPudu(db, env);
}
