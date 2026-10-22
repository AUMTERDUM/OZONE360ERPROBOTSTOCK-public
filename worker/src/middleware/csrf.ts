import type { MiddlewareHandler } from 'hono';
import { getCookie } from 'hono/cookie';
import type { AppEnv } from '../types';

// Double-submit cookie CSRF check — mirrors server/index.ts's csrfProtection.
export const csrfProtection: MiddlewareHandler<AppEnv> = async (c, next) => {
  const method = c.req.method;
  if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    return next();
  }
  const path = c.req.path.replace(/^\/api/, '');
  if (path === '/auth/login' || path === '/auth/google') {
    return next();
  }
  if (path.startsWith('/portal/') || path.startsWith('/robots/public/')) {
    return next();
  }
  const sessionCookie = getCookie(c, 'erp_token');
  if (!sessionCookie) {
    return next();
  }
  const csrfCookie = getCookie(c, 'erp_csrf');
  const csrfHeader = c.req.header('X-CSRF-Token');
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    return c.json({ error: 'Invalid CSRF token' }, 403);
  }
  return next();
};
