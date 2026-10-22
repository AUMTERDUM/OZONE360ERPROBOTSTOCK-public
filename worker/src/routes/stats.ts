import { Hono } from 'hono';
import { and, gte, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { deliveryNotes, maintenanceTickets, usedParts, purchaseOrders, notifications } from '../db/schema';
import { authenticate } from '../middleware/auth';
import type { AppEnv } from '../types';

export const statsRoutes = new Hono<AppEnv>();

// Last-12-months rollup of deliveries, tickets, and parts used/cost.
statsRoutes.get('/monthly', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const now = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` });
  }

  // Fetch once and bucket by YYYY-MM in JS (createdAt is stored as text; reportDate is a date string).
  const [dns, tickets, parts] = await Promise.all([
    db.select({ createdAt: deliveryNotes.createdAt }).from(deliveryNotes),
    db.select({ reportDate: maintenanceTickets.reportDate }).from(maintenanceTickets),
    db.query.usedParts.findMany({ with: { sparePart: true, ticket: { columns: { reportDate: true } } } }),
  ]);

  const results = months.map((m) => {
    const deliveries = dns.filter((d) => (d.createdAt || '').slice(0, 7) === m.label).length;
    const monthTickets = tickets.filter((t) => (t.reportDate || '').slice(0, 7) === m.label).length;
    const monthParts = parts.filter((p) => (p.ticket?.reportDate || '').slice(0, 7) === m.label);
    const partsUsed = monthParts.reduce((s, p) => s + p.quantity, 0);
    const partsCost = monthParts.reduce((s, p) => s + p.quantity * (p.sparePart?.unitPrice ?? 0), 0);
    return { label: m.label, deliveries, tickets: monthTickets, partsUsed, partsCost };
  });
  return c.json(results);
});

// 30-day daily trend of tickets, purchase orders, and low-stock alerts.
statsRoutes.get('/dashboard-trends', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const dayCount = 30;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setDate(start.getDate() - (dayCount - 1));
  const startKey = start.toISOString().slice(0, 10);

  const series = Array.from({ length: dayCount }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    return { date: key, label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`, tickets: 0, purchaseOrders: 0, stockAlerts: 0 };
  });
  const byDate = new Map(series.map((item) => [item.date, item]));

  const [ticketRows, poRows, alertRows] = await Promise.all([
    db.select({ reportDate: maintenanceTickets.reportDate }).from(maintenanceTickets).where(gte(maintenanceTickets.reportDate, startKey)),
    db.select({ orderDate: purchaseOrders.orderDate }).from(purchaseOrders).where(gte(purchaseOrders.orderDate, startKey)),
    db.select({ createdAt: notifications.createdAt }).from(notifications).where(and(eq(notifications.type, 'low_stock'), gte(notifications.createdAt, startKey))),
  ]);

  for (const r of ticketRows) { const b = byDate.get(r.reportDate); if (b) b.tickets += 1; }
  for (const r of poRows) { const b = byDate.get(r.orderDate); if (b) b.purchaseOrders += 1; }
  for (const r of alertRows) { const b = byDate.get((r.createdAt || '').slice(0, 10)); if (b) b.stockAlerts += 1; }

  return c.json(series);
});
