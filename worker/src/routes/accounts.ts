import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, asc, ne } from 'drizzle-orm';
import { getDb } from '../db/client';
import { accounts, journalEntryLines, invoices } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

const ACCOUNT_TYPES = ['Asset', 'Liability', 'Income', 'Expense', 'Equity'];

export const accountsRoutes = new Hono<AppEnv>();

accountsRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.query.accounts.findMany({ orderBy: asc(accounts.code), with: { parent: true } });
  return c.json(rows);
});

// AR/AP/Revenue/Expense summary — registered before /:id-style routes (static path).
accountsRoutes.get('/summary', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const all = await db.select().from(invoices).where(ne(invoices.status, 'Cancelled'));
  const sales = all.filter((i) => i.invoiceType === 'Sales');
  const purchase = all.filter((i) => i.invoiceType === 'Purchase');
  const today = new Date().toISOString().split('T')[0];
  return c.json({
    totalAR: sales.reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0),
    totalAP: purchase.reduce((s, i) => s + (i.totalAmount - i.paidAmount), 0),
    totalRevenue: sales.reduce((s, i) => s + i.totalAmount, 0),
    totalExpense: purchase.reduce((s, i) => s + i.totalAmount, 0),
    totalReceived: sales.reduce((s, i) => s + i.paidAmount, 0),
    totalPaid: purchase.reduce((s, i) => s + i.paidAmount, 0),
    overdueInvoices: all.filter((i) => i.status !== 'Paid' && i.status !== 'Cancelled' && i.dueDate < today).length,
    invoiceCount: all.length,
  });
});

accountsRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const { code, name, type, parentId } = await c.req.json();
  if (!code || !name || !type) return c.json({ error: 'code, name, type required' }, 400);
  if (!ACCOUNT_TYPES.includes(type)) return c.json({ error: 'Invalid account type' }, 400);
  const db = getDb(c.env.DB);
  const newId = randomUUID();
  await db.insert(accounts).values({ id: newId, code, name, type, parentId: parentId || null });
  const account = await db.query.accounts.findFirst({ where: eq(accounts.id, newId) });
  await logActivity(db, { entityType: 'Account', entityId: newId, entityName: `${code} - ${name}`, action: 'created', performedBy: user.username });
  return c.json(account, 201);
});

accountsRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { code, name, type, parentId, isActive } = await c.req.json();
  const db = getDb(c.env.DB);
  const existing = await db.query.accounts.findFirst({ where: eq(accounts.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  await db.update(accounts).set({ code, name, type, parentId: parentId || null, isActive: isActive ?? true }).where(eq(accounts.id, id));
  const account = await db.query.accounts.findFirst({ where: eq(accounts.id, id) });
  await logActivity(db, { entityType: 'Account', entityId: id, entityName: `${account!.code} - ${account!.name}`, action: 'updated', performedBy: user.username });
  return c.json(account);
});

accountsRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const existing = await db.query.accounts.findFirst({ where: eq(accounts.id, id) });
  if (!existing) return c.json({ error: 'Not found' }, 404);
  const lines = await db.select({ id: journalEntryLines.id }).from(journalEntryLines).where(eq(journalEntryLines.accountId, id));
  if (lines.length > 0) return c.json({ error: 'Cannot delete account with journal entries' }, 400);
  const children = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.parentId, id));
  if (children.length > 0) return c.json({ error: 'Cannot delete account with sub-accounts' }, 400);
  await db.delete(accounts).where(eq(accounts.id, id));
  await logActivity(db, { entityType: 'Account', entityId: id, entityName: `${existing.code} - ${existing.name}`, action: 'deleted', performedBy: user.username });
  return c.json({ success: true });
});

// Seed the default Thai chart of accounts (parents first, then children).
accountsRoutes.post('/seed', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const db = getDb(c.env.DB);
  const existing = await db.select({ id: accounts.id }).from(accounts).limit(1);
  if (existing.length > 0) return c.json({ error: 'Chart of accounts already has entries. Clear first to re-seed.' }, 400);

  const defaults = [
    { code: '1000', name: 'สินทรัพย์', type: 'Asset' },
    { code: '1100', name: 'เงินสด / ธนาคาร', type: 'Asset', parentCode: '1000' },
    { code: '1200', name: 'ลูกหนี้การค้า', type: 'Asset', parentCode: '1000' },
    { code: '1300', name: 'สินค้าคงเหลือ (อะไหล่)', type: 'Asset', parentCode: '1000' },
    { code: '1400', name: 'สินทรัพย์ถาวร (หุ่นยนต์)', type: 'Asset', parentCode: '1000' },
    { code: '2000', name: 'หนี้สิน', type: 'Liability' },
    { code: '2100', name: 'เจ้าหนี้การค้า', type: 'Liability', parentCode: '2000' },
    { code: '2200', name: 'ภาษีมูลค่าเพิ่มขาย', type: 'Liability', parentCode: '2000' },
    { code: '3000', name: 'ส่วนของเจ้าของ', type: 'Equity' },
    { code: '4000', name: 'รายได้', type: 'Income' },
    { code: '4100', name: 'รายได้จากการขาย / บริการซ่อม', type: 'Income', parentCode: '4000' },
    { code: '4200', name: 'รายได้อื่น', type: 'Income', parentCode: '4000' },
    { code: '5000', name: 'ค่าใช้จ่าย', type: 'Expense' },
    { code: '5100', name: 'ต้นทุนอะไหล่', type: 'Expense', parentCode: '5000' },
    { code: '5200', name: 'ค่าแรงช่าง', type: 'Expense', parentCode: '5000' },
    { code: '5300', name: 'ค่าขนส่ง', type: 'Expense', parentCode: '5000' },
    { code: '5400', name: 'ค่าใช้จ่ายทั่วไป', type: 'Expense', parentCode: '5000' },
  ];
  const idMap: Record<string, string> = {};
  for (const d of defaults.filter((x) => !x.parentCode)) {
    const nid = randomUUID();
    await db.insert(accounts).values({ id: nid, code: d.code, name: d.name, type: d.type });
    idMap[d.code] = nid;
  }
  for (const d of defaults.filter((x) => x.parentCode)) {
    const nid = randomUUID();
    await db.insert(accounts).values({ id: nid, code: d.code, name: d.name, type: d.type, parentId: idMap[d.parentCode!] || null });
    idMap[d.code] = nid;
  }
  await logActivity(db, { entityType: 'Account', entityId: 'seed', entityName: 'Chart of Accounts', action: 'created', newValues: { count: defaults.length }, performedBy: user.username });
  return c.json({ success: true, count: defaults.length }, 201);
});
