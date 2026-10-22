import { createRemoteJWKSet, jwtVerify } from 'jose';

const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export interface GoogleIdTokenPayload {
  email: string;
  email_verified: boolean;
  name?: string;
}

// Verifies a Google Sign-In ID token against Google's published JWKS.
// Replaces google-auth-library's OAuth2Client.verifyIdToken (Node-only), for Workers.
export async function verifyGoogleIdToken(idToken: string, audience: string): Promise<GoogleIdTokenPayload> {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience,
  });
  return {
    email: payload.email as string,
    email_verified: payload.email_verified as boolean,
    name: payload.name as string | undefined,
  };
}
