import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import {
  invoices, invoiceItems, payments, deliveryNotes, purchaseOrders,
  maintenanceTickets, projectRequests,
} from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { docNumber } from '../lib/doc-number';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

const INVOICE_FIELDS = ['docNumber', 'invoiceType', 'status', 'invoiceDate', 'dueDate', 'customerId', 'customerName', 'supplier', 'notes', 'sourceType', 'sourceId'] as const;

function invDoc(type: 'Sales' | 'Purchase') { return docNumber(type === 'Sales' ? 'INV' : 'BILL'); }

function fullInvoice(db: Db, id: string) {
  return db.query.invoices.findFirst({ where: eq(invoices.id, id), with: { items: true, payments: true } });
}

async function insertInvoiceItems(db: Db, invoiceId: string, items: any[]) {
  for (const i of items || []) {
    await db.insert(invoiceItems).values({
      id: randomUUID(), invoiceId, description: i.description || '', quantity: Number(i.quantity),
      unit: i.unit || 'ชิ้น', unitPrice: Number(i.unitPrice), amount: i.amount ?? Number(i.quantity) * Number(i.unitPrice),
      remark: i.remark || '',
    });
  }
}

function computeTotals(items: any[], taxRate: number) {
  const subtotal = (items || []).reduce((s, i) => s + (i.amount ?? Number(i.quantity) * Number(i.unitPrice)), 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  return { subtotal, taxAmount, totalAmount: subtotal + taxAmount };
}

// Shared "create invoice from source doc" flow; returns the created invoice or a duplicate error.
async function createFromSource(db: Db, opts: {
  sourceType: string; sourceId: string; invoiceType: 'Sales' | 'Purchase';
  items: any[]; taxRate: number; customerId?: string | null; customerName?: string; supplier?: string; createdBy: string;
}) {
  const dup = await db.query.invoices.findFirst({ where: and(eq(invoices.sourceType, opts.sourceType), eq(invoices.sourceId, opts.sourceId)) });
  if (dup) return { error: `Already invoiced: ${dup.docNumber}` } as const;
  const due = new Date(); due.setDate(due.getDate() + 30);
  const { subtotal, taxAmount, totalAmount } = computeTotals(opts.items, opts.taxRate);
  const newId = randomUUID();
  const doc = invDoc(opts.invoiceType);
  await db.insert(invoices).values({
    id: newId, docNumber: doc, invoiceType: opts.invoiceType, status: 'Draft',
    invoiceDate: new Date().toISOString().split('T')[0], dueDate: due.toISOString().split('T')[0],
    customerId: opts.customerId ?? null, customerName: opts.customerName ?? null, supplier: opts.supplier ?? null,
    subtotal, taxRate: opts.taxRate, taxAmount, totalAmount, paidAmount: 0,
    sourceType: opts.sourceType, sourceId: opts.sourceId, createdBy: opts.createdBy,
  });
  await insertInvoiceItems(db, newId, opts.items);
  return { id: newId, docNumber: doc } as const;
}

async function recalcInvoice(db: Db, invoiceId: string, opts: { emptyStatus: string }) {
  const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, invoiceId), with: { payments: true } });
  if (!inv) return;
  const totalPaid = inv.payments.reduce((s, p) => s + p.amount, 0);
  const newStatus = totalPaid <= 0 ? opts.emptyStatus : totalPaid >= inv.totalAmount ? 'Paid' : 'Partial';
  await db.update(invoices).set({ paidAmount: totalPaid, status: newStatus }).where(eq(invoices.id, invoiceId));
}

export const invoicesRoutes = new Hono<AppEnv>();

invoicesRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.invoices.findMany({ orderBy: desc(invoices.createdAt), with: { items: true, payments: true } });
  return c.json(rows);
});

invoicesRoutes.get('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const inv = await fullInvoice(db, c.req.param('id'));
  if (!inv) return c.json({ error: 'Not found' }, 404);
  return c.json(inv);
});

invoicesRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { items } = body;
  if (!body.invoiceType || !body.invoiceDate || !body.dueDate) return c.json({ error: 'invoiceType, invoiceDate, dueDate required' }, 400);
  const db = getDb(c.env.DB);
  const taxRate = Number(body.taxRate ?? 7);
  const { subtotal, taxAmount, totalAmount } = computeTotals(items, taxRate);
  const newId = randomUUID();
  const data: Record<string, unknown> = {
    id: newId, taxRate, subtotal, taxAmount, totalAmount, paidAmount: 0, createdBy: user.username,
    docNumber: body.docNumber || invDoc(body.invoiceType),
  };
  for (const f of INVOICE_FIELDS) if (f in body && f !== 'docNumber') data[f] = body[f];
  await db.insert(invoices).values(data as typeof invoices.$inferInsert);
  await insertInvoiceItems(db, newId, items);
  await logActivity(db, { entityType: 'Invoice', entityId: newId, entityName: data.docNumber as string, action: 'created', newValues: { invoiceType: body.invoiceType, total: totalAmount }, performedBy: user.username });
  return c.json(await fullInvoice(db, newId), 201);
});

invoicesRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { items } = body;
  const db = getDb(c.env.DB);
  const existing = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (items !== undefined) await db.delete(invoiceItems).where(eq(invoiceItems.invoiceId, id));
  const taxRate = Number(body.taxRate ?? existing.taxRate);
  let totals = { subtotal: existing.subtotal, taxAmount: existing.taxAmount, totalAmount: existing.totalAmount };
  if (items !== undefined) totals = computeTotals(items, taxRate);
  const data: Record<string, unknown> = { taxRate, ...totals };
  for (const f of INVOICE_FIELDS) if (f in body) data[f] = body[f];
  await db.update(invoices).set(data).where(eq(invoices.id, id));
  if (items !== undefined) await insertInvoiceItems(db, id, items);
  await logActivity(db, { entityType: 'Invoice', entityId: id, entityName: existing.docNumber, action: 'updated', performedBy: user.username });
  return c.json(await fullInvoice(db, id));
});

invoicesRoutes.patch('/:id/status', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status } = await c.req.json();
  const valid = ['Draft', 'Issued', 'Paid', 'Partial', 'Cancelled', 'Overdue'];
  if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const db = getDb(c.env.DB);
  const existing = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await db.update(invoices).set({ status }).where(eq(invoices.id, id));
  await logActivity(db, { entityType: 'Invoice', entityId: id, entityName: existing.docNumber, action: 'status_changed', oldValues: { status: existing.status }, newValues: { status }, performedBy: user.username });
  return c.json(await db.query.invoices.findFirst({ where: eq(invoices.id, id) }));
});

invoicesRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const inv = await db.query.invoices.findFirst({ where: eq(invoices.id, id) });
  if (!inv) return c.json({ error: 'Not found' }, 404);
  await db.delete(invoices).where(eq(invoices.id, id));
  await logActivity(db, { entityType: 'Invoice', entityId: id, entityName: inv.docNumber, action: 'deleted', performedBy: user.username });
  return c.json({ success: true });
});

invoicesRoutes.post('/from-delivery-note/:id', authenticate, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const dn = await db.query.deliveryNotes.findFirst({ where: eq(deliveryNotes.id, c.req.param('id')), with: { items: true, customer: true } });
  if (!dn) return c.json({ error: 'Delivery note not found' }, 404);
  const taxRate = Number((await c.req.json().catch(() => ({}))).taxRate ?? 7);
  const items = dn.items.map((it) => ({ description: it.description, quantity: it.quantity, unit: 'ชิ้น', unitPrice: 0, amount: 0, remark: it.remark || '' }));
  const r = await createFromSource(db, { sourceType: 'DeliveryNote', sourceId: dn.id, invoiceType: 'Sales', items, taxRate, customerId: dn.customerId, customerName: dn.customer?.name || '', createdBy: user.username });
  if ('error' in r) return c.json({ error: r.error }, 400);
  await logActivity(db, { entityType: 'Invoice', entityId: r.id, entityName: r.docNumber, action: 'created', newValues: { source: `DN: ${dn.docNumber}` }, performedBy: user.username });
  return c.json(await fullInvoice(db, r.id), 201);
});

invoicesRoutes.post('/from-purchase-order/:id', authenticate, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const po = await db.query.purchaseOrders.findFirst({ where: eq(purchaseOrders.id, c.req.param('id')), with: { items: true } });
  if (!po) return c.json({ error: 'Purchase order not found' }, 404);
  const taxRate = Number((await c.req.json().catch(() => ({}))).taxRate ?? 7);
  const items = po.items.map((it) => ({ description: it.partName, quantity: it.receivedQty || it.quantity, unit: 'ชิ้น', unitPrice: it.unitPrice, amount: (it.receivedQty || it.quantity) * it.unitPrice, remark: it.remark || '' }));
  const r = await createFromSource(db, { sourceType: 'PurchaseOrder', sourceId: po.id, invoiceType: 'Purchase', items, taxRate, supplier: po.supplier, createdBy: user.username });
  if ('error' in r) return c.json({ error: r.error }, 400);
  await logActivity(db, { entityType: 'Invoice', entityId: r.id, entityName: r.docNumber, action: 'created', newValues: { source: `PO: ${po.docNumber}` }, performedBy: user.username });
  return c.json(await fullInvoice(db, r.id), 201);
});

invoicesRoutes.post('/from-maintenance-ticket/:id', authenticate, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const body = await c.req.json().catch(() => ({}));
  const ticket = await db.query.maintenanceTickets.findFirst({
    where: eq(maintenanceTickets.id, c.req.param('id')),
    with: { usedParts: { with: { sparePart: true } }, customer: true },
  });
  if (!ticket) return c.json({ error: 'Ticket not found' }, 404);
  const taxRate = Number(body.taxRate ?? 7);
  const laborCost = Number(body.laborCost ?? 0);
  const items: any[] = (ticket.usedParts || []).map((up) => ({
    description: `อะไหล่: ${up.sparePart?.name || 'Unknown'}`, quantity: up.quantity, unit: 'ชิ้น',
    unitPrice: up.sparePart?.unitPrice || 0, amount: up.quantity * (up.sparePart?.unitPrice || 0),
  }));
  if (laborCost > 0) items.push({ description: 'ค่าแรงซ่อม', quantity: 1, unit: 'งาน', unitPrice: laborCost, amount: laborCost });
  const r = await createFromSource(db, { sourceType: 'MaintenanceTicket', sourceId: ticket.id, invoiceType: 'Sales', items, taxRate, customerId: ticket.customerId, customerName: ticket.customer?.name || '', createdBy: user.username });
  if ('error' in r) return c.json({ error: r.error }, 400);
  await logActivity(db, { entityType: 'Invoice', entityId: r.id, entityName: r.docNumber, action: 'created', newValues: { source: `Ticket: ${ticket.id.slice(0, 8)}` }, performedBy: user.username });
  return c.json(await fullInvoice(db, r.id), 201);
});

invoicesRoutes.post('/from-project-request/:id', authenticate, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const pr = await db.query.projectRequests.findFirst({ where: eq(projectRequests.id, c.req.param('id')), with: { items: true } });
  if (!pr) return c.json({ error: 'Project request not found' }, 404);
  const taxRate = Number((await c.req.json().catch(() => ({}))).taxRate ?? 7);
  const items = pr.items.map((it) => ({ description: `${it.itemType}: ${it.description}`, quantity: it.quantity, unit: it.unit || 'ชิ้น', unitPrice: it.unitPrice, amount: it.totalPrice || it.quantity * it.unitPrice, remark: it.remark || '' }));
  const r = await createFromSource(db, { sourceType: 'ProjectRequest', sourceId: pr.id, invoiceType: 'Sales', items, taxRate, customerId: pr.customerId || null, createdBy: user.username });
  if ('error' in r) return c.json({ error: r.error }, 400);
  await logActivity(db, { entityType: 'Invoice', entityId: r.id, entityName: r.docNumber, action: 'created', newValues: { source: `PR: ${pr.docNumber}` }, performedBy: user.username });
  return c.json(await fullInvoice(db, r.id), 201);
});

// ── Payments ─────────────────────────────────────────────────────────────────
export const paymentsRoutes = new Hono<AppEnv>();

paymentsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.payments.findMany({ orderBy: desc(payments.createdAt), with: { invoice: true } });
  return c.json(rows);
});

paymentsRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  if (!body.paymentType || !body.paymentDate || !body.amount) return c.json({ error: 'paymentType, paymentDate, amount required' }, 400);
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(payments).values({
    id: newId, docNumber: body.docNumber || docNumber('PAY'), paymentType: body.paymentType,
    paymentDate: body.paymentDate, amount: Number(body.amount), method: body.method || 'Transfer',
    reference: body.reference ?? null, invoiceId: body.invoiceId ?? null, notes: body.notes ?? null, createdBy: user.username,
  });
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, newId), with: { invoice: true } });
  if (payment?.invoiceId) await recalcInvoice(db, payment.invoiceId, { emptyStatus: 'Partial' });
  await logActivity(db, { entityType: 'Payment', entityId: newId, entityName: payment!.docNumber, action: 'created', newValues: { type: payment!.paymentType, amount: payment!.amount }, performedBy: user.username });
  return c.json(payment, 201);
});

paymentsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const payment = await db.query.payments.findFirst({ where: eq(payments.id, id) });
  if (!payment) return c.json({ error: 'Not found' }, 404);
  await db.delete(payments).where(eq(payments.id, id));
  if (payment.invoiceId) await recalcInvoice(db, payment.invoiceId, { emptyStatus: 'Issued' });
  await logActivity(db, { entityType: 'Payment', entityId: id, entityName: payment.docNumber, action: 'deleted', performedBy: user.username });
  return c.json({ success: true });
});
