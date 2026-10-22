import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import { verifyAuthToken } from '../lib/jwt';
import type { AppEnv } from '../types';

export const authenticate: MiddlewareHandler<AppEnv> = async (c, next) => {
  const authHeader = c.req.header('Authorization');
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearerToken || getCookie(c, 'erp_token') || null;
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  try {
    const user = await verifyAuthToken(token, c.env.JWT_SECRET);
    c.set('user', user);
    await next();
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
};

export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = c.get('user');
  if (user?.role !== 'ADMIN') {
    return c.json({ error: 'Admin access required' }, 403);
  }
  await next();
};
