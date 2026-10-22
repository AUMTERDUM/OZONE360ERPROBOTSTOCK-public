import { SignJWT, jwtVerify } from 'jose';
import type { AuthUser } from '../types';

export async function signAuthToken(user: AuthUser, secret: string): Promise<string> {
  const key = new TextEncoder().encode(secret);
  return new SignJWT({ username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(key);
}

export async function verifyAuthToken(token: string, secret: string): Promise<AuthUser> {
  const key = new TextEncoder().encode(secret);
  const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
  return {
    id: payload.sub as string,
    username: payload.username as string,
    role: payload.role as string,
  };
}
