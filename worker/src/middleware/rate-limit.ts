import type { MiddlewareHandler } from 'hono';
import type { AppEnv, Bindings } from '../types';

// Only CF-Connecting-IP is trusted: Cloudflare sets it at the edge and strips any
// client-supplied copy. Origin/Referer/Host/X-Forwarded-* are all attacker-controlled,
// so the old localhost sniff let anyone skip every limiter (login included) by sending
// `Origin: http://localhost:5173`.
function isLocalRequest(c: Parameters<MiddlewareHandler<AppEnv>>[0]): boolean {
  const ip = c.req.header('CF-Connecting-IP') || '';
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

// Cloudflare's native Rate Limiting binding only supports 10s/60s windows, so
// longer Express windows (e.g. login's 10/15min) are approximated on a 60s
// window — see wrangler.toml for the exact per-binding limit/period chosen.
// The per-account lockout in routes/auth.ts (5 failed attempts → 15min lock)
// remains the primary brute-force defense; this is a secondary IP-level guard.
export function rateLimit(binding: keyof Pick<Bindings,
  'LOGIN_LIMITER' | 'UPLOAD_LIMITER' | 'API_LIMITER' | 'PORTAL_LIMITER' | 'PUBLIC_REPORT_LIMITER'
>, message: string): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (isLocalRequest(c)) return next();
    // ponytail: no CF-Connecting-IP (direct/non-CF traffic) shares one bucket.
    // Split by a fingerprint if that shared bucket ever starts throttling real users.
    const ip = c.req.header('CF-Connecting-IP') || 'unknown';
    const { success } = await c.env[binding].limit({ key: `${binding}:${ip}` });
    if (!success) return c.json({ error: message }, 429);
    return next();
  };
}
