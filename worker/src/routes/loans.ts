import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq, and, isNull, inArray, desc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { robotLoans, robotLoanItems, robots } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { restoreRobotStatus } from '../lib/robot-status';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { Db } from '../db/client';
import type { AppEnv } from '../types';

const LOAN_FIELDS = ['docNumber', 'purpose', 'loanDate', 'expectedReturn', 'actualReturn', 'status', 'borrowerName', 'borrowerPhone', 'borrowerDept', 'customerId', 'notes'] as const;

function loanDocNumber(): string {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `LN${y}${m}${d}-${rand}`;
}

function fullLoan(db: Db, id: string) {
  return db.query.robotLoans.findFirst({ where: eq(robotLoans.id, id), with: { customer: true, items: true } });
}

async function buildLoanItems(db: Db, loanId: string, robotIds: string[]) {
  const rs = await db.query.robots.findMany({ where: inArray(robots.id, robotIds), with: { model: true } });
  for (const r of rs) {
    await db.insert(robotLoanItems).values({
      id: randomUUID(), loanId, robotId: r.id, serialNumber: r.serialNumber, modelName: r.model?.name || '-',
    });
  }
  return rs.length;
}

export const loansRoutes = new Hono<AppEnv>();

loansRoutes.get('/', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  // `?robotId=` narrows to loans containing that robot (robot drawer) instead of listing every loan.
  const robotId = c.req.query('robotId');
  const loanIds = robotId
    ? (await db.select({ loanId: robotLoanItems.loanId }).from(robotLoanItems).where(eq(robotLoanItems.robotId, robotId)).limit(90)).map((r) => r.loanId)
    : null;
  if (loanIds && !loanIds.length) return c.json([]);
  const loans = await db.query.robotLoans.findMany({
    where: loanIds ? inArray(robotLoans.id, loanIds) : undefined,
    orderBy: desc(robotLoans.createdAt),
    with: { customer: { columns: { id: true, name: true } }, items: true },
  });
  return c.json(loans);
});

loansRoutes.get('/:id', authenticate, async (c) => {
  const db = getDb(c.env.DB);
  const loan = await fullLoan(db, c.req.param('id'));
  if (!loan) return c.json({ error: 'Not found' }, 404);
  return c.json(loan);
});

loansRoutes.post('/', authenticate, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const { robotIds } = body;
  if (!body.borrowerName || !body.loanDate || !body.expectedReturn) {
    return c.json({ error: 'borrowerName, loanDate, and expectedReturn are required' }, 400);
  }
  if (!robotIds?.length) return c.json({ error: 'At least one robot is required' }, 400);

  const db = getDb(c.env.DB);
  const newId = randomUUID();
  const data: Record<string, unknown> = {
    id: newId, createdBy: user.username,
    docNumber: body.docNumber || loanDocNumber(),
    status: body.status || 'Pending',
  };
  for (const f of LOAN_FIELDS) if (f in body && f !== 'docNumber' && f !== 'status') data[f] = body[f];
  await db.insert(robotLoans).values(data as typeof robotLoans.$inferInsert);
  const robotCount = await buildLoanItems(db, newId, robotIds);
  const loan = await fullLoan(db, newId);
  await logActivity(db, {
    entityType: 'RobotLoan', entityId: newId, entityName: loan!.docNumber,
    action: 'created', newValues: { docNumber: loan!.docNumber, borrowerName: loan!.borrowerName, robotCount }, performedBy: user.username,
  });
  return c.json(loan, 201);
});

loansRoutes.patch('/:id/status', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const { status, notes, returnConditions } = await c.req.json();
  const valid = ['Pending', 'Approved', 'Active', 'Returned', 'Cancelled'];
  if (!valid.includes(status)) return c.json({ error: 'Invalid status' }, 400);

  const db = getDb(c.env.DB);
  const existing = await db.query.robotLoans.findFirst({ where: eq(robotLoans.id, id), with: { items: true } });
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const today = new Date().toISOString().split('T')[0];
  const updateData: Record<string, unknown> = { status };
  if (status === 'Approved') { updateData.approvedBy = user.username; updateData.approvedAt = today; }
  if (status === 'Returned') {
    updateData.actualReturn = today;
    await db.update(robotLoanItems).set({ returnedAt: today, condition: returnConditions || 'Good' })
      .where(and(eq(robotLoanItems.loanId, id), isNull(robotLoanItems.returnedAt)));
    for (const item of existing.items) await restoreRobotStatus(db, item.robotId);
  }
  if (status === 'Active') {
    for (const item of existing.items) await db.update(robots).set({ status: 'In Maintenance' }).where(eq(robots.id, item.robotId));
  }
  if (status === 'Cancelled') {
    for (const item of existing.items) if (!item.returnedAt) await restoreRobotStatus(db, item.robotId);
  }
  if (notes) updateData.notes = notes;

  await db.update(robotLoans).set(updateData).where(eq(robotLoans.id, id));
  await logActivity(db, {
    entityType: 'RobotLoan', entityId: id, entityName: existing.docNumber,
    action: 'status_changed', oldValues: { status: existing.status }, newValues: { status }, performedBy: user.username,
  });
  return c.json(await fullLoan(db, id));
});

loansRoutes.patch('/:id/items/:itemId/return', authenticate, async (c) => {
  const id = c.req.param('id');
  const itemId = c.req.param('itemId');
  const { condition } = await c.req.json();
  const today = new Date().toISOString().split('T')[0];
  const db = getDb(c.env.DB);

  const item = await db.query.robotLoanItems.findFirst({ where: and(eq(robotLoanItems.id, itemId), eq(robotLoanItems.loanId, id)) });
  if (!item) return c.json({ error: 'Loan item not found' }, 404);
  if (item.returnedAt) return c.json({ error: 'รายการนี้คืนแล้ว' }, 400);

  await db.update(robotLoanItems).set({ returnedAt: today, condition: condition || 'Good' }).where(eq(robotLoanItems.id, itemId));
  await restoreRobotStatus(db, item.robotId);

  const allItems = await db.select().from(robotLoanItems).where(eq(robotLoanItems.loanId, id));
  if (allItems.every((i) => i.returnedAt)) {
    await db.update(robotLoans).set({ status: 'Returned', actualReturn: today }).where(eq(robotLoans.id, id));
  }
  return c.json(await fullLoan(db, id));
});

loansRoutes.put('/:id', authenticate, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json();
  const { robotIds } = body;
  const db = getDb(c.env.DB);
  const data: Record<string, unknown> = {};
  for (const f of LOAN_FIELDS) if (f in body) data[f] = body[f];
  if (Object.keys(data).length) await db.update(robotLoans).set(data).where(eq(robotLoans.id, id));
  if (robotIds?.length) {
    await db.delete(robotLoanItems).where(eq(robotLoanItems.loanId, id));
    await buildLoanItems(db, id, robotIds);
  }
  const loan = await fullLoan(db, id);
  await logActivity(db, {
    entityType: 'RobotLoan', entityId: id, entityName: loan?.docNumber, action: 'updated', performedBy: user.username,
  });
  return c.json(loan);
});

loansRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const db = getDb(c.env.DB);
  const loan = await db.query.robotLoans.findFirst({ where: eq(robotLoans.id, id) });
  await db.delete(robotLoans).where(eq(robotLoans.id, id));
  await logActivity(db, {
    entityType: 'RobotLoan', entityId: id, entityName: loan?.docNumber, action: 'deleted', performedBy: user.username,
  });
  return c.json({ success: true });
});
