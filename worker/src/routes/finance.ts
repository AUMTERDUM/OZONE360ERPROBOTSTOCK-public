import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { journalEntries, journalEntryLines, budgets, travelExpenseClaims, travelExpenseItems } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { docNumber } from '../lib/doc-number';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

// ── Journal Entries ──────────────────────────────────────────────────────────
export const journalRoutes = new Hono<AppEnv>();

journalRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.journalEntries.findMany({
    orderBy: desc(journalEntries.createdAt),
    with: { lines: { with: { account: true } } },
  });
  return c.json(rows);
});

journalRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { lines } = body;
  if (!body.entryDate || !lines || lines.length < 2) return c.json({ error: 'entryDate and at least 2 lines required' }, 400);
  const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) return c.json({ error: `Debit (${totalDebit}) must equal Credit (${totalCredit})` }, 400);

  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(journalEntries).values({
    id: newId, docNumber: body.docNumber || docNumber('JE'), entryDate: body.entryDate,
    description: body.description ?? null, sourceType: body.sourceType ?? null, sourceId: body.sourceId ?? null,
    createdBy: user.username,
  });
  for (const l of lines) {
    await db.insert(journalEntryLines).values({
      id: randomUUID(), journalEntryId: newId, accountId: l.accountId,
      debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description || '',
    });
  }
  await logActivity(db, { entityType: 'JournalEntry', entityId: newId, entityName: (await db.query.journalEntries.findFirst({ where: eq(journalEntries.id, newId) }))!.docNumber, action: 'created', newValues: { totalDebit }, performedBy: user.username });
  const entry = await db.query.journalEntries.findFirst({ where: eq(journalEntries.id, newId), with: { lines: { with: { account: true } } } });
  return c.json(entry, 201);
});

journalRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const entry = await db.query.journalEntries.findFirst({ where: eq(journalEntries.id, id) });
  if (!entry) return c.json({ error: 'Not found' }, 404);
  await db.delete(journalEntries).where(eq(journalEntries.id, id));
  await logActivity(db, { entityType: 'JournalEntry', entityId: id, entityName: entry.docNumber, action: 'deleted', performedBy: user.username });
  return c.json({ success: true });
});

// ── Budgets ──────────────────────────────────────────────────────────────────
export const budgetsRoutes = new Hono<AppEnv>();

budgetsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.budgets.findMany({ orderBy: desc(budgets.createdAt), with: { account: true } });
  return c.json(rows);
});

budgetsRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const { name, accountId, fiscalYear, budgetAmount, notes } = await c.req.json();
  if (!name || !accountId || !fiscalYear || budgetAmount == null) return c.json({ error: 'name, accountId, fiscalYear, budgetAmount required' }, 400);
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(budgets).values({ id: newId, name, accountId, fiscalYear, budgetAmount: Number(budgetAmount), notes: notes || '' });
  const budget = await db.query.budgets.findFirst({ where: eq(budgets.id, newId) });
  await logActivity(db, { entityType: 'Budget', entityId: newId, entityName: budget!.name, action: 'created', performedBy: user.username });
  return c.json(budget, 201);
});

budgetsRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { name, accountId, fiscalYear, budgetAmount, spentAmount, notes } = await c.req.json();
  const db = getDb(c.env.DB);
  const existing = await db.query.budgets.findFirst({ where: eq(budgets.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const data: Record<string, unknown> = { name, accountId, fiscalYear, budgetAmount: Number(budgetAmount), notes };
  if (spentAmount != null) data.spentAmount = Number(spentAmount);
  await db.update(budgets).set(data).where(eq(budgets.id, id));
  const budget = await db.query.budgets.findFirst({ where: eq(budgets.id, id), with: { account: true } });
  await logActivity(db, { entityType: 'Budget', entityId: id, entityName: budget!.name, action: 'updated', performedBy: user.username });
  return c.json(budget);
});

budgetsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const existing = await db.query.budgets.findFirst({ where: eq(budgets.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await db.delete(budgets).where(eq(budgets.id, id));
  await logActivity(db, { entityType: 'Budget', entityId: id, entityName: existing.name, action: 'deleted', performedBy: user.username });
  return c.json({ success: true });
});

// ── Travel Expense Claims ────────────────────────────────────────────────────
const TE_FIELDS = ['docNumber', 'claimDate', 'province', 'destination', 'purpose', 'staffName', 'staffDept', 'travelDateFrom', 'travelDateTo', 'status', 'notes', 'customerId', 'maVisitId', 'ticketId'] as const;
// Link columns are foreign keys: an empty string from a cleared <select> must be stored as NULL.
const TE_LINK_FIELDS = new Set(['customerId', 'maVisitId', 'ticketId']);
const teValue = (field: string, value: unknown) => (TE_LINK_FIELDS.has(field) ? (value || null) : value);

function fullClaim(db: Db, id: string) {
  return db.query.travelExpenseClaims.findFirst({ where: eq(travelExpenseClaims.id, id), with: { items: true } });
}

function claimTotals(items: any[]) {
  return {
    totalAdvance: (items || []).filter((i) => i.itemType === 'advance').reduce((s, i) => s + Number(i.amount), 0),
    totalReimbursed: (items || []).filter((i) => i.itemType === 'reimbursed').reduce((s, i) => s + Number(i.amount), 0),
  };
}

async function insertClaimItems(db: Db, claimId: string, items: any[]) {
  for (const i of items || []) {
    await db.insert(travelExpenseItems).values({
      id: randomUUID(), claimId, itemType: i.itemType, description: i.description || '',
      amount: Number(i.amount), receiptNo: i.receiptNo || null, remark: i.remark || null,
    });
  }
}

export const travelExpensesRoutes = new Hono<AppEnv>();

travelExpensesRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const customerId = c.req.query('customerId');
  const rows = await db.query.travelExpenseClaims.findMany({
    where: customerId ? eq(travelExpenseClaims.customerId, customerId) : undefined,
    orderBy: desc(travelExpenseClaims.createdAt), with: { items: true },
  });
  return c.json(rows);
});

travelExpensesRoutes.get('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const claim = await fullClaim(db, c.req.param('id'));
  if (!claim) return c.json({ error: 'Not found' }, 404);
  return c.json(claim);
});

travelExpensesRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { items } = body;
  if (!body.staffName || !body.purpose || !body.claimDate || !body.province || !body.travelDateFrom || !body.travelDateTo) {
    return c.json({ error: 'staffName, purpose, claimDate, province, travelDateFrom and travelDateTo are required' }, 400);
  }
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  const { totalAdvance, totalReimbursed } = claimTotals(items);
  const data: Record<string, unknown> = {
    id: newId, createdBy: user.username, totalAdvance, totalReimbursed,
    docNumber: body.docNumber || docNumber('TE'), status: body.status || 'Draft',
  };
  for (const f of TE_FIELDS) if (f in body && f !== 'docNumber' && f !== 'status') data[f] = teValue(f, body[f]);
  await db.insert(travelExpenseClaims).values(data as typeof travelExpenseClaims.$inferInsert);
  await insertClaimItems(db, newId, items);
  await logActivity(db, { entityType: 'TravelExpenseClaim', entityId: newId, entityName: data.docNumber as string, action: 'created', newValues: { docNumber: data.docNumber, staffName: body.staffName, province: body.province }, performedBy: user.username });
  return c.json(await fullClaim(db, newId), 201);
});

travelExpensesRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { items } = body;
  const db = getDb(c.env.DB);
  const existing = await db.query.travelExpenseClaims.findFirst({ where: eq(travelExpenseClaims.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  if (items !== undefined) await db.delete(travelExpenseItems).where(eq(travelExpenseItems.claimId, id));
  const totals = items !== undefined ? claimTotals(items) : { totalAdvance: existing.totalAdvance, totalReimbursed: existing.totalReimbursed };
  const data: Record<string, unknown> = { ...totals };
  for (const f of TE_FIELDS) if (f in body) data[f] = teValue(f, body[f]);
  await db.update(travelExpenseClaims).set(data).where(eq(travelExpenseClaims.id, id));
  if (items !== undefined) await insertClaimItems(db, id, items);
  await logActivity(db, { entityType: 'TravelExpenseClaim', entityId: id, entityName: existing.docNumber, action: 'updated', performedBy: user.username });
  return c.json(await fullClaim(db, id));
});

travelExpensesRoutes.patch('/:id/status', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status } = await c.req.json();
  const valid = ['Draft', 'Submitted', 'Approved', 'Paid', 'Cancelled'];
  if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400);
  const db = getDb(c.env.DB);
  const existing = await db.query.travelExpenseClaims.findFirst({ where: eq(travelExpenseClaims.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const data: Record<string, unknown> = { status };
  if (status === 'Approved') { data.approvedBy = user.username; data.approvedAt = new Date().toISOString().split('T')[0]; }
  await db.update(travelExpenseClaims).set(data).where(eq(travelExpenseClaims.id, id));
  await logActivity(db, { entityType: 'TravelExpenseClaim', entityId: id, entityName: existing.docNumber, action: `status_changed_to_${status}`, performedBy: user.username });
  return c.json(await fullClaim(db, id));
});

travelExpensesRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const existing = await db.query.travelExpenseClaims.findFirst({ where: eq(travelExpenseClaims.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await db.delete(travelExpenseClaims).where(eq(travelExpenseClaims.id, id));
  await logActivity(db, { entityType: 'TravelExpenseClaim', entityId: id, entityName: existing.docNumber, action: 'deleted', performedBy: user.username });
  return c.json({ ok: true });
});
