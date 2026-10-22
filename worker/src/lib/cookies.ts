import type { Context } from 'hono';
import { setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv } from '../types';

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export function setAuthCookies(c: Context<AppEnv>, token: string, csrfToken: string) {
  setCookie(c, 'erp_token', token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: SEVEN_DAYS,
    path: '/',
  });
  setCookie(c, 'erp_csrf', csrfToken, {
    httpOnly: false,
    secure: true,
    sameSite: 'Strict',
    maxAge: SEVEN_DAYS,
    path: '/',
  });
}

export function issueCsrfCookie(c: Context<AppEnv>, csrfToken: string) {
  setCookie(c, 'erp_csrf', csrfToken, {
    httpOnly: false,
    secure: true,
    sameSite: 'Strict',
    maxAge: SEVEN_DAYS,
    path: '/',
  });
}

export function clearAuthCookies(c: Context<AppEnv>) {
  deleteCookie(c, 'erp_token', { path: '/' });
  deleteCookie(c, 'erp_csrf', { path: '/' });
}
