import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq, asc } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { validatePasswordPolicy } from '../lib/password';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

export const usersRoutes = new Hono<AppEnv>();

usersRoutes.get('/', authenticate, requireAdmin, async (c) => {
  const db = getDb(c.env.DB);
  const rows = await db.select({ id: users.id, username: users.username, role: users.role, googleEmail: users.googleEmail })
    .from(users).orderBy(asc(users.username));
  return c.json(rows);
});

usersRoutes.post('/', authenticate, requireAdmin, async (c) => {
  const { username, password, googleEmail } = await c.req.json();
  if (!username || !password) return c.json({ error: 'Username and password required' }, 400);
  const policyError = validatePasswordPolicy(password);
  if (policyError) return c.json({ error: policyError }, 400);

  const db = getDb(c.env.DB);
  const existing = await db.query.users.findFirst({ where: eq(users.username, username) });
  if (existing) return c.json({ error: 'Username already exists' }, 409);

  const hashed = await bcrypt.hash(password, 10);
  const newId = randomUUID();
  // passwordChangedAt = null → user must change on first login
  await db.insert(users).values({
    id: newId, username, password: hashed, role: 'ADMIN',
    passwordChangedAt: null, googleEmail: googleEmail || null,
  });
  const user = await db.query.users.findFirst({ where: eq(users.id, newId) });
  return c.json({ id: user!.id, username: user!.username, role: user!.role, googleEmail: user!.googleEmail }, 201);
});

usersRoutes.put('/:id', authenticate, requireAdmin, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const { username, password, googleEmail } = body;
  if (password) return c.json({ error: 'เปลี่ยนรหัสผ่านได้เฉพาะบัญชีของตัวเอง และต้องยืนยันผ่านอีเมล' }, 403);
  const data: Record<string, unknown> = {};
  if (username) data.username = username;
  data.role = 'ADMIN';
  if ('googleEmail' in body) data.googleEmail = googleEmail || null;
  const db = getDb(c.env.DB);
  await db.update(users).set(data).where(eq(users.id, id));
  const user = await db.query.users.findFirst({ where: eq(users.id, id) });
  return c.json({ id: user!.id, username: user!.username, role: user!.role, googleEmail: user!.googleEmail });
});

usersRoutes.delete('/:id', authenticate, requireAdmin, async (c) => {
  const authUser = c.get('user');
  const id = c.req.param('id');
  if (authUser.id === id) return c.json({ error: 'Cannot delete your own account' }, 400);
  const db = getDb(c.env.DB);
  await db.delete(users).where(eq(users.id, id));
  return c.json({ success: true });
});
