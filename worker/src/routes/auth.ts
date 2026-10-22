import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { users } from '../db/schema';
import { signAuthToken } from '../lib/jwt';
import { verifyGoogleIdToken } from '../lib/google-auth';
import { setAuthCookies, issueCsrfCookie, clearAuthCookies } from '../lib/cookies';
import { getCookie } from 'hono/cookie';
import { logActivity } from '../lib/activity-log';
import { authenticate } from '../middleware/auth';
import { validatePasswordPolicy } from '../lib/password';
import { rateLimit } from '../middleware/rate-limit';
import type { AppEnv } from '../types';

const PASSWORD_EXPIRY_DAYS = 90;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const loginLimiter = rateLimit('LOGIN_LIMITER', 'Too many login attempts. Please try again later.');

export const authRoutes = new Hono<AppEnv>();

authRoutes.post('/login', loginLimiter, async (c) => {
  const { username, password } = await c.req.json<{ username?: string; password?: string }>();
  if (!username || !password) {
    return c.json({ error: 'Username and password required' }, 400);
  }
  const db = getDb(c.env.DB);
  const user = await db.query.users.findFirst({ where: eq(users.username, username) });

  if (user?.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    const remaining = Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 60000);
    return c.json({ error: `บัญชีถูกล็อคชั่วคราว กรุณาลองใหม่ใน ${remaining} นาที` }, 429);
  }

  const valid = user && (await bcrypt.compare(password, user.password));
  if (!user || !valid) {
    if (user) {
      const newAttempts = (user.failedAttempts ?? 0) + 1;
      const lockedUntil = newAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000).toISOString()
        : null;
      await db.update(users)
        .set({ failedAttempts: newAttempts, ...(lockedUntil ? { lockedUntil } : {}) })
        .where(eq(users.id, user.id));
      if (lockedUntil) {
        return c.json({ error: `ลองผิดพลาดหลายครั้ง บัญชีถูกล็อคชั่วคราว ${LOCKOUT_MINUTES} นาที` }, 429);
      }
    }
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  await db.update(users)
    .set({ failedAttempts: 0, lockedUntil: null })
    .where(eq(users.id, user.id));

  const elevatedUser = user.role === 'ADMIN'
    ? user
    : {
        ...user,
        ...(await (async () => {
          await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, user.id));
          return { role: 'ADMIN' as const };
        })()),
      };

  const token = await signAuthToken({ id: elevatedUser.id, username: elevatedUser.username, role: elevatedUser.role }, c.env.JWT_SECRET);
  const csrfToken = randomUUID();
  setAuthCookies(c, token, csrfToken);

  const requirePasswordChange = elevatedUser.passwordChangedAt === null ||
    (Date.now() - new Date(elevatedUser.passwordChangedAt as string).getTime() > PASSWORD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  return c.json({ user: { id: elevatedUser.id, username: elevatedUser.username, role: elevatedUser.role }, requirePasswordChange });
});

authRoutes.post('/logout', (c) => {
  clearAuthCookies(c);
  return c.json({ success: true });
});

authRoutes.get('/me', authenticate, async (c) => {
  const authUser = c.get('user');
  const db = getDb(c.env.DB);
  const user = await db.query.users.findFirst({
    where: eq(users.id, authUser.id),
    columns: { id: true, username: true, role: true },
  });
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  if (user.role !== 'ADMIN') {
    await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, user.id));
  }
  if (!getCookie(c, 'erp_csrf')) issueCsrfCookie(c, randomUUID());
  return c.json({ user: { ...user, role: 'ADMIN' } });
});

authRoutes.post('/google', loginLimiter, async (c) => {
  const { credential } = await c.req.json<{ credential?: string }>();
  if (!credential) return c.json({ error: 'Missing Google credential' }, 400);
  if (!c.env.GOOGLE_CLIENT_ID) return c.json({ error: 'Google login not configured' }, 503);

  let email: string;
  let name: string;
  try {
    const payload = await verifyGoogleIdToken(credential, c.env.GOOGLE_CLIENT_ID);
    if (!payload.email_verified || !payload.email) {
      return c.json({ error: 'Google account email not verified' }, 401);
    }
    email = payload.email;
    name = payload.name ?? payload.email;
  } catch {
    return c.json({ error: 'Invalid Google token' }, 401);
  }

  const db = getDb(c.env.DB);
  const isOzoneDomain = email.toLowerCase().endsWith(c.env.OZONE_DOMAIN);

  let user = await db.query.users.findFirst({ where: eq(users.googleEmail, email) });

  if (!user && isOzoneDomain) {
    const randomPwd = await bcrypt.hash(randomUUID(), 10);
    const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    let username = baseUsername;
    let attempt = 0;
    while (await db.query.users.findFirst({ where: eq(users.username, username) })) {
      attempt++;
      username = `${baseUsername}${attempt}`;
    }
    const newUserId = randomUUID();
    await db.insert(users).values({ id: newUserId, username, password: randomPwd, role: 'ADMIN', googleEmail: email });
    user = await db.query.users.findFirst({ where: eq(users.id, newUserId) });
    await logActivity(db, {
      entityType: 'User', entityId: user!.id, entityName: user!.username, action: 'AUTO_REGISTER_GOOGLE',
      newValues: { email, name, domain: c.env.OZONE_DOMAIN, role: 'ADMIN' },
    });
  }

  if (!user) {
    return c.json({ error: `ไม่พบบัญชี Google (${email}) ในระบบ กรุณาติดต่อ Admin เพื่อเปิดสิทธิ์` }, 403);
  }

  const elevatedGoogleUser = user.role === 'ADMIN'
    ? user
    : {
        ...user,
        ...(await (async () => {
          await db.update(users).set({ role: 'ADMIN' }).where(eq(users.id, user.id));
          return { role: 'ADMIN' as const };
        })()),
      };

  const token = await signAuthToken({ id: elevatedGoogleUser.id, username: elevatedGoogleUser.username, role: elevatedGoogleUser.role }, c.env.JWT_SECRET);
  const csrfToken = randomUUID();
  setAuthCookies(c, token, csrfToken);

  await logActivity(db, { entityType: 'User', entityId: elevatedGoogleUser.id, entityName: elevatedGoogleUser.username, action: 'LOGIN_GOOGLE', newValues: { email, name } });

  return c.json({ user: { id: elevatedGoogleUser.id, username: elevatedGoogleUser.username, role: elevatedGoogleUser.role }, requirePasswordChange: false });
});

authRoutes.post('/change-password', authenticate, async (c) => {
  const authUser = c.get('user');
  const { currentPassword, newPassword } = await c.req.json<{ currentPassword?: string; newPassword?: string }>();
  if (!currentPassword || !newPassword) {
    return c.json({ error: 'currentPassword and newPassword required' }, 400);
  }
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) return c.json({ error: policyError }, 400);

  const db = getDb(c.env.DB);
  const user = await db.query.users.findFirst({ where: eq(users.id, authUser.id) });
  if (!user) return c.json({ error: 'Unauthorized' }, 401);
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return c.json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' }, 401);

  await db.update(users).set({ password: await bcrypt.hash(newPassword, 10), passwordChangedAt: new Date().toISOString(), failedAttempts: 0, lockedUntil: null }).where(eq(users.id, authUser.id));

  return c.json({ success: true });
});
