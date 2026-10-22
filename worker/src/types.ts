export interface Bindings {
  DB: D1Database;
  UPLOADS: R2Bucket;
  JWT_SECRET: string;
  ALLOWED_ORIGINS: string;
  GOOGLE_CLIENT_ID: string;
  OZONE_DOMAIN: string;
  PUDUAPIKEY: string;
  PUDUAPIsecret: string;
  /** CallbackCode PUDU sends with early-warning callbacks; the callback endpoint is disabled when unset. */
  PUDU_CALLBACK_CODE?: string;
  LOGIN_LIMITER: RateLimit;
  UPLOAD_LIMITER: RateLimit;
  API_LIMITER: RateLimit;
  PORTAL_LIMITER: RateLimit;
  PUBLIC_REPORT_LIMITER: RateLimit;
  RESEND_API_KEY?: string;
  EMAIL_FROM?: string;
}

export interface AuthUser {
  id: string;
  username: string;
  role: string;
}

export interface Variables {
  user: AuthUser;
}

export type AppEnv = { Bindings: Bindings; Variables: Variables };
