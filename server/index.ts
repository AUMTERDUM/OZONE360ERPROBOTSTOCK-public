import 'dotenv/config';
import express, { type Request, type Response, type NextFunction } from 'express';
import { OAuth2Client } from 'google-auth-library';

// Fix for @types/express v5: ParamsDictionary index signature changed to string | string[].
// Named properties override index signatures, restoring correct string typing for route params.
declare module 'express-serve-static-core' {
  interface ParamsDictionary {
    id: string;
    token: string;
    elementType: string;
    elementId: string;
    shopId: string;
    itemId: string;
    filename: string;
    serialNumber: string;
  }
}

import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';
import { randomUUID } from 'crypto';
import * as cron from 'node-cron';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';

// ── Prisma setup ──────────────────────────────────────────────────────────────
// PrismaLibSql supports both file: (SQLite) and libsql:// (Turso remote) URLs.
const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
const adapter = new PrismaLibSql({ url: dbUrl });
let prisma = new PrismaClient({ adapter } as any);

// Reconnect the Prisma client (used after restoring the SQLite DB from a backup).
async function reconnectPrisma(): Promise<void> {
  try { await prisma.$disconnect(); } catch { /* ignore */ }
  const freshAdapter = new PrismaLibSql({ url: dbUrl });
  prisma = new PrismaClient({ adapter: freshAdapter } as any);
  await prisma.$connect();
  await ensureFixedWarehouses();
  await ensureSparePartCatalogColumnsSafe();
  await ensureSparePartItemTable();
}



// ── Express setup ─────────────────────────────────────────────────────────────
const app = express();
const PORT = process.env.PORT || 3001;
if (!process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable must be set. Refusing to start.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID ?? '';
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const isLocalDevOrigin = (process.env.ALLOWED_ORIGINS ?? '').includes('http://localhost:5173');
const COOKIE_SECURE = !isLocalDevOrigin;
const COOKIE_SAME_SITE: 'lax' | 'strict' = isLocalDevOrigin ? 'lax' : 'strict';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

const CSRF_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: COOKIE_SECURE,
  sameSite: COOKIE_SAME_SITE,
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: '/',
};

// Trust proxy (nginx → cloudflare tunnel) so rate-limit and req.ip use real client IP
app.set('trust proxy', 1);

const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',')
  : ['https://erp.example.com'];

app.use(cors({
  origin: (origin, callback) => {
    // Allow server-to-server (no origin) or whitelisted origins
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

function isLocalRequest(req: Request): boolean {
  const forwardedFor = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
  const realIp = String(req.headers['x-real-ip'] ?? '').trim();
  const ip = forwardedFor || realIp || req.ip || '';
  const origin = String(req.headers.origin ?? '');
  const referer = String(req.headers.referer ?? '');
  const host = String(req.headers.host ?? '');
  const forwardedHost = String(req.headers['x-forwarded-host'] ?? '');
  const localHostHints = [origin, referer, host, forwardedHost];
  return (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip === '::ffff:127.0.0.1' ||
    localHostHints.some((value) =>
      value.startsWith('http://localhost:') ||
      value.startsWith('http://127.0.0.1:') ||
      value.startsWith('localhost:') ||
      value.startsWith('127.0.0.1:')
    )
  );
}

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // max 10 attempts per IP per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLocalRequest(req),
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
});

// Upload limiter: max 20 uploads per minute per IP
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many uploads. Please slow down.' },
});

// Global API rate limiter: 300 requests per minute per IP
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => isLocalRequest(req),
  message: { error: 'Too many requests. Please slow down.' },
});
app.use('/api/', apiLimiter);

// Portal limiter: 30 req/min per IP for public portal endpoints
const portalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many portal requests. Please try again in a minute.' },
});
app.use('/api/portal/', portalLimiter);

app.use(express.json({ limit: '1mb' }));

function getCookieValue(req: Request, name: string): string | null {
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return null;
  const cookies = cookieHeader.split(';').map(part => part.trim());
  const matched = cookies.find(part => part.startsWith(`${name}=`));
  if (!matched) return null;
  return decodeURIComponent(matched.slice(name.length + 1));
}

function issueCsrfCookie(res: Response, csrfToken?: string): string {
  const token = csrfToken || randomUUID();
  res.cookie('erp_csrf', token, CSRF_COOKIE_OPTIONS);
  return token;
}

function clearAuthCookies(res: Response): void {
  res.clearCookie('erp_token', { path: '/', httpOnly: true, secure: COOKIE_SECURE, sameSite: COOKIE_SAME_SITE });
  res.clearCookie('erp_csrf', { path: '/', httpOnly: false, secure: COOKIE_SECURE, sameSite: COOKIE_SAME_SITE });
}

function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  if (req.path === '/auth/login' || req.path === '/auth/google') {
    next();
    return;
  }
  // Portal & public-robot endpoints use token-in-URL auth, not cookies — skip CSRF
  if (req.path.startsWith('/portal/') || req.path.startsWith('/robots/public/')) {
    next();
    return;
  }
  const sessionCookie = getCookieValue(req, 'erp_token');
  if (!sessionCookie) {
    next();
    return;
  }
  const csrfCookie = getCookieValue(req, 'erp_csrf');
  const headerValue = req.headers['x-csrf-token'];
  const csrfHeader = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
    res.status(403).json({ error: 'Invalid CSRF token' });
    return;
  }
  next();
}

app.use('/api', csrfProtection);

// ── File upload setup ─────────────────────────────────────────────────────────
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const ALLOWED_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

const storage = multer.diskStorage({
  destination: uploadsDir,
  filename: (_req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

// xlsx/xls only — memory storage (no disk write needed)
const XLSX_MIME_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
];
const xlsxUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    const ok = XLSX_MIME_TYPES.includes(file.mimetype);
    cb(ok ? null : new Error('Only .xlsx / .xls files allowed') as any, ok);
  },
});

// ── Auth types & middleware ───────────────────────────────────────────────────
interface AuthRequest extends Request {
  user?: { id: string; username: string; role: string };
}

function getUploadFilePath(filename: string): string {
  return path.join(uploadsDir, filename);
}

function normalizeAttachmentEntityType(entityType: string): string {
  switch (entityType) {
    case 'Loan':
      return 'RobotLoan';
    case 'delivery-note':
      return 'DeliveryNote';
    default:
      return entityType;
  }
}

function getAttachmentEntityTypeAliases(entityType: string): string[] {
  const normalized = normalizeAttachmentEntityType(entityType);
  if (normalized === 'RobotLoan') return ['RobotLoan', 'Loan'];
  if (normalized === 'DeliveryNote') return ['DeliveryNote', 'delivery-note'];
  return [normalized];
}

async function entityExists(entityType: string, entityId: string): Promise<boolean> {
  if (!entityId) return false;
  switch (normalizeAttachmentEntityType(entityType)) {
    case 'Robot':
      return !!(await prisma.robot.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'Customer':
      return !!(await prisma.customer.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'RobotModel':
      return !!(await prisma.robotModel.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'MaintenanceTicket':
      return !!(await prisma.maintenanceTicket.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'MaintenanceSchedule':
      return !!(await (prisma as any).maintenanceSchedule.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'Warehouse':
      return !!(await prisma.warehouse.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'SparePart':
      return !!(await prisma.sparePart.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'PurchaseOrder':
      return !!(await prisma.purchaseOrder.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'ProjectRequest':
      return !!(await prisma.projectRequest.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'Invoice':
      return !!(await prisma.invoice.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'Account':
      return !!(await prisma.account.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'RobotLoan':
      return !!(await prisma.robotLoan.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'DeliveryNote':
      return !!(await prisma.deliveryNote.findUnique({ where: { id: entityId }, select: { id: true } }));
    case 'SiteSurvey':
      return !!(await (prisma as any).siteSurvey.findUnique({ where: { id: entityId }, select: { id: true } }));
    default:
      return false;
  }
}

async function ensureEntityExists(res: Response, entityType: string, entityId: string): Promise<boolean> {
  const exists = await entityExists(entityType, entityId);
  if (!exists) {
    res.status(404).json({ error: 'Entity not found' });
    return false;
  }
  return true;
}

async function hasRequiredLoanAttachment(loanId: string, attachmentType: string): Promise<boolean> {
  const count = await prisma.attachment.count({
    where: {
      elementId: loanId,
      attachmentType,
      elementType: { in: getAttachmentEntityTypeAliases('RobotLoan') },
    },
  });
  return count > 0;
}

async function findConflictingLoanRobots(loanId: string | null, robotIds: string[]): Promise<string[]> {
  if (robotIds.length === 0) return [];
  const items = await prisma.robotLoanItem.findMany({
    where: {
      robotId: { in: robotIds },
      loan: {
        status: { in: ['Pending', 'Approved', 'Active'] },
        ...(loanId ? { id: { not: loanId } } : {}),
      },
    },
    select: { robotId: true },
  });
  return Array.from(new Set(items.map(item => item.robotId)));
}

async function isPublicMediaReference(filename: string): Promise<boolean> {
  const safeFilename = filename.trim();
  if (!safeFilename || safeFilename.includes('/') || safeFilename.includes('\\')) return false;
  const [modelCount, ticketCount] = await Promise.all([
    prisma.robotModel.count({ where: { imageUrl: { endsWith: `/${safeFilename}` } } }),
    prisma.maintenanceTicket.count({ where: { issueImageUrl: { endsWith: `/${safeFilename}` } } }),
  ]);
  return modelCount + ticketCount > 0;
}

async function sendPublicMedia(req: Request, res: Response): Promise<void> {
  const { filename } = req.params;
  if (!(await isPublicMediaReference(filename))) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  const filePath = getUploadFilePath(filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.sendFile(filePath);
}

function getCookieToken(req: Request): string | null {
  return getCookieValue(req, 'erp_token');
}

function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  const token = bearerToken || getCookieToken(req);
  if (!token) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { id: string; username: string; role: string };
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireAdmin(req: AuthRequest, res: Response, next: NextFunction): void {
  if (req.user?.role !== 'ADMIN') {
    res.status(403).json({ error: 'Admin access required' });
    return;
  }
  next();
}

// ── Password policy ──────────────────────────────────────────────────────────
// Returns null if OK, otherwise an error message (Thai).
function validatePasswordPolicy(pwd: string): string | null {
  if (!pwd || typeof pwd !== 'string') return 'Password is required';
  if (pwd.length < 8) return 'Password must be at least 8 characters';
  if (pwd.length > 128) return 'Password must not exceed 128 characters';
  if (!/[a-z]/.test(pwd)) return 'Password must contain at least one lowercase letter';
  if (!/[A-Z]/.test(pwd)) return 'Password must contain at least one uppercase letter';
  if (!/[0-9]/.test(pwd)) return 'Password must contain at least one digit';
  return null;
}

// ── Mass-assignment guard ─────────────────────────────────────────────────────
// Pick only the allowed keys from the request body, preventing attackers from
// injecting protected fields (id, role, archivedAt, relation fields, etc.).
function pickFields<T extends Record<string, any>>(body: any, allowed: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  if (!body || typeof body !== 'object') return out;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(body, key as string)) {
      (out as any)[key] = body[key as string];
    }
  }
  return out;
}

const ROBOT_MODEL_FIELDS = ['name', 'type', 'payloadCapacity', 'batteryLife', 'imageUrl', 'puduProductCode'] as const;
const ROBOT_FIELDS = ['serialNumber', 'status', 'purchaseDate', 'puduMac', 'notes', 'warrantyExpiresAt', 'modelId', 'customerId', 'locationId'] as const;
const CUSTOMER_FIELDS = ['name', 'contactPerson', 'email', 'phone', 'address', 'logoUrl', 'type', 'agentCode', 'puduShopId', 'puduCompanyId'] as const;
const SPARE_PART_FIELDS = ['sku', 'name', 'description', 'category', 'productModel', 'partType', 'location', 'warehouseId', 'minStock', 'unitPrice', 'supplier', 'status', 'sourceFile', 'sourceSheet'] as const;
const CONTACT_FIELDS = ['name', 'role', 'email', 'phone', 'lineId', 'isPrimary'] as const;
const FIXED_WAREHOUSE_NAMES = ['OZONE-BKK', 'OZONE-CNX'] as const;

function formatDateParts(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizePlainDate(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    const year = Number(slash[3].length === 2 ? `20${slash[3]}` : slash[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return formatDateParts(year, month, day);
  }

  const dash = raw.match(/^(\d{1,2})-(\d{1,2})-(\d{2,4})$/);
  if (dash) {
    const day = Number(dash[1]);
    const month = Number(dash[2]);
    const year = Number(dash[3].length === 2 ? `20${dash[3]}` : dash[3]);
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) return formatDateParts(year, month, day);
  }

  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return null;
}

function normalizeExcelDate(value: unknown, XLSX?: any): string | null {
  if (typeof value === 'number' && Number.isFinite(value) && XLSX?.SSF?.parse_date_code) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (parsed?.y && parsed?.m && parsed?.d) return formatDateParts(parsed.y, parsed.m, parsed.d);
  }
  return normalizePlainDate(value);
}

async function syncSparePartTrackedStock(sparePartId: string): Promise<number> {
  const count = await (prisma as any).sparePartItem.count({ where: { sparePartId } });
  await prisma.sparePart.update({ where: { id: sparePartId }, data: { stock: count } });
  return count;
}

async function syncAllSparePartTrackedStock(): Promise<void> {
  const parts = await prisma.sparePart.findMany({ select: { id: true } });
  for (const part of parts) {
    await syncSparePartTrackedStock(part.id);
  }
}

async function listTrackedSparePartItems(sparePartId: string) {
  return await (prisma as any).sparePartItem.findMany({
    where: { sparePartId },
    orderBy: [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
  });
}

async function consumeTrackedSparePartItems(sparePartId: string, quantity: number): Promise<number> {
  if (quantity <= 0) return 0;
  const items = await listTrackedSparePartItems(sparePartId);
  const toDelete = items.slice(0, quantity);
  if (!toDelete.length) return 0;
  await (prisma as any).sparePartItem.deleteMany({ where: { id: { in: toDelete.map((item: any) => item.id) } } });
  await syncSparePartTrackedStock(sparePartId);
  return toDelete.length;
}

async function ensureSparePartItemTable(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "SparePartItem" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "sparePartId" TEXT NOT NULL,
      "serialNumber" TEXT NOT NULL,
      "receivedDate" TEXT NOT NULL,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "SparePartItem_sparePartId_fkey"
        FOREIGN KEY ("sparePartId") REFERENCES "SparePart" ("id")
        ON DELETE CASCADE ON UPDATE CASCADE
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "SparePartItem_sparePartId_serialNumber_key" ON "SparePartItem"("sparePartId", "serialNumber")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SparePartItem_sparePartId_idx" ON "SparePartItem"("sparePartId")`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "SparePartItem_receivedDate_idx" ON "SparePartItem"("receivedDate")`);
}

async function ensureSparePartCatalogColumnsSafe(): Promise<void> {
  const statements = [
    `ALTER TABLE "SparePart" ADD COLUMN "productModel" TEXT`,
    `ALTER TABLE "SparePart" ADD COLUMN "partType" TEXT`,
    `ALTER TABLE "SparePart" ADD COLUMN "status" TEXT`,
    `ALTER TABLE "SparePart" ADD COLUMN "sourceFile" TEXT`,
    `ALTER TABLE "SparePart" ADD COLUMN "sourceSheet" TEXT`,
  ];
  for (const statement of statements) {
    try {
      await prisma.$executeRawUnsafe(statement);
    } catch (error: any) {
      const message = String(error?.message ?? '');
      if (!message.includes('duplicate column name')) throw error;
    }
  }
}

async function ensureFixedWarehouses(): Promise<void> {
  for (const name of FIXED_WAREHOUSE_NAMES) {
    const existing = await prisma.warehouse.findFirst({ where: { name }, select: { id: true } });
    if (!existing) {
      await prisma.warehouse.create({ data: { name, notes: null, parentId: null } });
    }
  }
}

async function listFixedWarehouses() {
  await ensureFixedWarehouses();
  return prisma.warehouse.findMany({
    where: { name: { in: [...FIXED_WAREHOUSE_NAMES] } },
    orderBy: { name: 'asc' },
    include: { _count: { select: { robots: true } } },
  });
}

async function resolveWarehouseAssignment(warehouseId: unknown) {
  const rawId = String(warehouseId ?? '').trim();
  if (!rawId) return { warehouseId: null, warehouseName: null };
  const warehouse = await prisma.warehouse.findUnique({ where: { id: rawId }, select: { id: true, name: true } });
  if (!warehouse || !FIXED_WAREHOUSE_NAMES.includes(warehouse.name as typeof FIXED_WAREHOUSE_NAMES[number])) {
    throw new Error('กรุณาเลือกคลังที่รองรับ');
  }
  return { warehouseId: warehouse.id, warehouseName: warehouse.name };
}

// ── ActivityLog helper ────────────────────────────────────────────────────────
async function logActivity(params: {
  entityType: string;
  entityId: string;
  entityName?: string | null;
  action: string;
  oldValues?: object | null;
  newValues?: object | null;
  performedBy?: string;
}) {
  try {
    await prisma.activityLog.create({
      data: {
        entityType: params.entityType,
        entityId: params.entityId,
        entityName: params.entityName ?? undefined,
        action: params.action,
        oldValues: params.oldValues ? JSON.stringify(params.oldValues) : null,
        newValues: params.newValues ? JSON.stringify(params.newValues) : null,
        performedBy: params.performedBy,
      },
    });
  } catch { /* non-critical */ }
}

// ── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/uploads/:filename', (req: Request, res: Response) => {
  void sendPublicMedia(req, res);
});

// ── Public robot info (no auth — for QR scan) ────────────────────────────────
app.get('/api/robots/public/:serialNumber', async (req: Request, res: Response): Promise<void> => {
  const robot = await prisma.robot.findUnique({
    where: { serialNumber: req.params.serialNumber },
    include: {
      model: true,
      customer: { select: { id: true, name: true, contactPerson: true, phone: true, portalToken: true } },
      location: { select: { name: true } },
      tickets: {
        orderBy: { reportDate: 'desc' },
        take: 3,
        select: {
          id: true,
          status: true,
          reportDate: true,
          issueDescription: true,
          resolution: true,
          trackingToken: true,
        },
      },
    },
  });
  if (!robot || robot.archivedAt) { res.status(404).json({ error: 'ไม่พบข้อมูลหุ่นยนต์' }); return; }
  res.json({
    id: robot.id,
    serialNumber: robot.serialNumber,
    model: robot.model.name,
    type: robot.model.type,
    status: robot.status,
    purchaseDate: robot.purchaseDate,
    warrantyExpiresAt: robot.warrantyExpiresAt ?? null,
    customer: robot.customer ? { name: robot.customer.name, contactPerson: robot.customer.contactPerson, phone: robot.customer.phone, portalToken: robot.customer.portalToken ?? null } : null,
    location: robot.location?.name ?? null,
    recentTickets: robot.tickets.map(t => ({
      id: t.id,
      status: t.status,
      reportDate: t.reportDate,
      issueDescription: t.issueDescription,
      resolution: t.resolution,
      trackingToken: t.trackingToken,
    })),
  });
});

// ── Public robot issue report (no auth — for QR scan by anyone) ──────────────
const publicReportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 5,                  // 5 reports per 5 min per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'ส่งแจ้งปัญหาได้สูงสุด 5 ครั้ง / 5 นาที กรุณาลองใหม่ภายหลัง' },
});

app.post('/api/robots/public/:serialNumber/report', publicReportLimiter, async (req: Request, res: Response): Promise<void> => {
  const { issueDescription, reporterName, reporterPhone } = req.body;
  if (!issueDescription || typeof issueDescription !== 'string' || !issueDescription.trim()) {
    res.status(400).json({ error: 'กรุณาอธิบายปัญหาที่พบ' }); return;
  }
  if (issueDescription.length > 2000) {
    res.status(400).json({ error: 'คำอธิบายปัญหายาวเกินไป (สูงสุด 2,000 ตัวอักษร)' }); return;
  }
  const robot = await prisma.robot.findUnique({
    where: { serialNumber: req.params.serialNumber },
    include: { customer: { select: { id: true, name: true } } },
  });
  if (!robot || robot.archivedAt) {
    res.status(404).json({ error: 'ไม่พบข้อมูลหุ่นยนต์' }); return;
  }
  // Build description with optional reporter info
  let fullDescription = issueDescription.trim();
  const contactParts: string[] = [];
  if (reporterName && typeof reporterName === 'string' && reporterName.trim()) contactParts.push(`ผู้แจ้ง: ${reporterName.trim().slice(0, 100)}`);
  if (reporterPhone && typeof reporterPhone === 'string' && reporterPhone.trim()) contactParts.push(`เบอร์: ${reporterPhone.trim().slice(0, 20)}`);
  if (contactParts.length) fullDescription += `\n\n--- ข้อมูลผู้แจ้ง ---\n${contactParts.join('\n')}`;

  const ticket = await createMaintenanceTicketFromInput({
    robotId: robot.id,
    customerId: robot.customerId || null,
    issueDescription: fullDescription,
    status: 'Pending',
    priorityLevel: 'Normal',
  }, `qr-scan:${robot.serialNumber}`);
  await createNotification(
    'ticket_updated',
    `QR Scan: แจ้งปัญหาหุ่นยนต์ ${robot.serialNumber}`,
    `${robot.customer?.name || 'ไม่ระบุลูกค้า'} — ${issueDescription.trim().slice(0, 60)}`,
    'MaintenanceTicket',
    ticket.id,
  );
  res.status(201).json({
    id: ticket.id,
    trackingToken: ticket.trackingToken,
    status: ticket.status,
  });
});

// ── Auth routes ───────────────────────────────────────────────────────────────

const PASSWORD_EXPIRY_DAYS = 90;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

app.post('/api/auth/login', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }
  const user = await prisma.user.findUnique({ where: { username } });

  // Account lockout check
  if (user?.lockedUntil && user.lockedUntil > new Date()) {
    const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
    res.status(429).json({ error: `บัญชีถูกล็อคชั่วคราว กรุณาลองใหม่ใน ${remaining} นาที` });
    return;
  }

  const valid = user && (await bcrypt.compare(password, user.password));
  if (!user || !valid) {
    // Increment failed attempts and lock if threshold reached
    if (user) {
      const newAttempts = (user.failedAttempts ?? 0) + 1;
      const lockedUntil = newAttempts >= MAX_FAILED_ATTEMPTS
        ? new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000)
        : null;
      await prisma.user.update({
        where: { id: user.id },
        data: { failedAttempts: newAttempts, ...(lockedUntil ? { lockedUntil } : {}) },
      });
      if (lockedUntil) {
        res.status(429).json({ error: `ลองผิดพลาดหลายครั้ง บัญชีถูกล็อคชั่วคราว ${LOCKOUT_MINUTES} นาที` });
        return;
      }
    }
    res.status(401).json({ error: 'Invalid credentials' });
    return;
  }

  // Reset failed attempts on successful login
  await prisma.user.update({
    where: { id: user.id },
    data: { failedAttempts: 0, lockedUntil: null },
  });

  const elevatedUser = user.role === 'ADMIN'
    ? user
    : await prisma.user.update({
        where: { id: user.id },
        data: { role: 'ADMIN' },
      });

  const token = jwt.sign(
    { id: elevatedUser.id, username: elevatedUser.username, role: elevatedUser.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  // Set HttpOnly secure cookie (works for browser + image requests)
  res.cookie('erp_token', token, COOKIE_OPTIONS);
  issueCsrfCookie(res);

  // Password expiry: null = admin-set (never changed) = require change on first login
  const requirePasswordChange = elevatedUser.passwordChangedAt === null ||
    (Date.now() - (elevatedUser.passwordChangedAt as Date).getTime() > PASSWORD_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  res.json({ user: { id: elevatedUser.id, username: elevatedUser.username, role: elevatedUser.role }, requirePasswordChange });
});

app.post('/api/auth/logout', (_req: Request, res: Response) => {
  clearAuthCookies(res);
  res.json({ success: true });
});

app.get('/api/auth/me', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const current = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { id: true, username: true, role: true } });
  const user = current && current.role !== 'ADMIN'
    ? await prisma.user.update({ where: { id: current.id }, data: { role: 'ADMIN' }, select: { id: true, username: true, role: true } })
    : current;
  if (!user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (!getCookieValue(req, 'erp_csrf')) issueCsrfCookie(res);
  res.json({ user });
});

// POST /api/auth/google — verify Google ID token, login if email is pre-registered by admin
app.post('/api/auth/google', loginLimiter, async (req: Request, res: Response): Promise<void> => {
  const { credential } = req.body;
  if (!credential) { res.status(400).json({ error: 'Missing Google credential' }); return; }
  if (!GOOGLE_CLIENT_ID) { res.status(503).json({ error: 'Google login not configured' }); return; }

  let email: string;
  let name: string;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
    const payload = ticket.getPayload();
    if (!payload?.email_verified || !payload.email) {
      res.status(401).json({ error: 'Google account email not verified' });
      return;
    }
    email = payload.email;
    name = payload.name ?? payload.email;
  } catch {
    res.status(401).json({ error: 'Invalid Google token' });
    return;
  }

  const OZONE_DOMAIN = '@example.com';
  const isOzoneDomain = email.toLowerCase().endsWith(OZONE_DOMAIN);

  let user = await prisma.user.findUnique({ where: { googleEmail: email } });

  if (!user && isOzoneDomain) {
    // Auto-provision: @example.com accounts become ADMIN immediately.
    const randomPwd = await bcrypt.hash(randomUUID(), 10);
    const baseUsername = email.split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '');
    let username = baseUsername;
    let attempt = 0;
    while (await prisma.user.findUnique({ where: { username } })) {
      attempt++;
      username = `${baseUsername}${attempt}`;
    }
    user = await prisma.user.create({
      data: { username, password: randomPwd, role: 'ADMIN', googleEmail: email },
    });
    await logActivity({ entityType: 'User', entityId: user.id, entityName: user.username, action: 'AUTO_REGISTER_GOOGLE', newValues: { email, name, domain: OZONE_DOMAIN, role: 'ADMIN' } });
  }

  if (!user) {
    res.status(403).json({ error: `ไม่พบบัญชี Google (${email}) ในระบบ กรุณาติดต่อ Admin เพื่อเปิดสิทธิ์` });
    return;
  }

  if (user.role !== 'ADMIN') {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { role: 'ADMIN' },
    });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '7d' }
  );

  res.cookie('erp_token', token, COOKIE_OPTIONS);
  issueCsrfCookie(res);

  await logActivity({ entityType: 'User', entityId: user.id, entityName: user.username, action: 'LOGIN_GOOGLE', newValues: { email, name } });

  res.json({ user: { id: user.id, username: user.username, role: user.role }, requirePasswordChange: false });
});

app.post('/api/auth/change-password', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    res.status(400).json({ error: 'currentPassword and newPassword required' });
    return;
  }
  const policyError = validatePasswordPolicy(newPassword);
  if (policyError) { res.status(400).json({ error: policyError }); return; }
  const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
  if (!user || !(await bcrypt.compare(currentPassword, user.password))) {
    res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    return;
  }
  const hashed = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hashed, passwordChangedAt: new Date(), failedAttempts: 0, lockedUntil: null },
  });
  res.json({ success: true });
});

// ── User management ───────────────────────────────────────────────────────────

app.get('/api/users', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const users = await prisma.user.findMany({
    select: { id: true, username: true, role: true, googleEmail: true },
    orderBy: { username: 'asc' },
  });
  res.json(users);
});

app.post('/api/users', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { username, password, googleEmail } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: 'Username and password required' });
    return;
  }
  const policyError = validatePasswordPolicy(password);
  if (policyError) { res.status(400).json({ error: policyError }); return; }
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    res.status(409).json({ error: 'Username already exists' });
    return;
  }
  const hashed = await bcrypt.hash(password, 10);
  // passwordChangedAt = null → signals user must change on first login
  const user = await prisma.user.create({
    data: { username, password: hashed, role: 'ADMIN', passwordChangedAt: null, googleEmail: googleEmail || null },
  });
  res.status(201).json({ id: user.id, username: user.username, role: user.role, googleEmail: user.googleEmail });
});

app.put('/api/users/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { username, password, googleEmail } = req.body;
  if (password) {
    const policyError = validatePasswordPolicy(password);
    if (policyError) { res.status(400).json({ error: policyError }); return; }
  }
  const data: any = {};
  if (username) data.username = username;
  data.role = 'ADMIN';
  if ('googleEmail' in req.body) data.googleEmail = googleEmail || null;
  if (password) {
    data.password = await bcrypt.hash(password, 10);
    data.passwordChangedAt = null; // force change on next login
  }
  const user = await prisma.user.update({ where: { id: req.params.id }, data });
  res.json({ id: user.id, username: user.username, role: user.role, googleEmail: user.googleEmail });
});

app.delete('/api/users/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  if (req.user?.id === req.params.id) {
    res.status(400).json({ error: 'Cannot delete your own account' });
    return;
  }
  await prisma.user.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── Robot Models ──────────────────────────────────────────────────────────────

app.get('/api/models', authenticate, async (_req: AuthRequest, res: Response) => {
  const models = await prisma.robotModel.findMany({ orderBy: { name: 'asc' } });
  res.json(models);
});

app.post('/api/models', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, ROBOT_MODEL_FIELDS);
  if (!data.name) { res.status(400).json({ error: 'name is required' }); return; }
  const model = await prisma.robotModel.create({ data: data as any });
  await logActivity({
    entityType: 'RobotModel', entityId: model.id, entityName: model.name,
    action: 'created', newValues: data, performedBy: req.user?.username,
  });
  res.status(201).json(model);
});

app.put('/api/models/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, ROBOT_MODEL_FIELDS);
  const old = await prisma.robotModel.findUnique({ where: { id: req.params.id } });
  const model = await prisma.robotModel.update({ where: { id: req.params.id }, data: data as any });
  await logActivity({
    entityType: 'RobotModel', entityId: model.id, entityName: model.name,
    action: 'updated', oldValues: old, newValues: data, performedBy: req.user?.username,
  });
  res.json(model);
});

app.delete('/api/models/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const model = await prisma.robotModel.findUnique({ where: { id: req.params.id } });
  if (!model) { res.status(404).json({ error: 'Not found' }); return; }
  const robotCount = await prisma.robot.count({ where: { modelId: req.params.id } });
  if (robotCount > 0) {
    res.status(409).json({ error: `ไม่สามารถลบได้ เนื่องจากมี Robot ${robotCount} รายการที่ใช้ Model นี้อยู่` });
    return;
  }
  await (prisma as any).trashItem.create({ data: {
    entityType: 'RobotModel', entityId: model.id, entityName: model.name,
    entityData: JSON.stringify(model), deletedBy: req.user?.username,
  }});
  await prisma.robotModel.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'RobotModel', entityId: req.params.id, entityName: model.name,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// ── Customers ─────────────────────────────────────────────────────────────────

app.get('/api/customers', authenticate, async (_req: AuthRequest, res: Response) => {
  try {
    const customers = await prisma.customer.findMany({ orderBy: { name: 'asc' } });
    res.json(customers);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to fetch customers' });
  }
});

app.post('/api/customers', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  try {
    const name: string = (req.body.name || '').trim();
    if (!name) { res.status(400).json({ error: 'กรุณาระบุชื่อลูกค้า' }); return; }
    // libsql adapter does not support mode:'insensitive' — do case-insensitive check in JS
    const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true } });
    const existing = allCustomers.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (existing) { res.status(409).json({ error: `มีลูกค้าชื่อ "${existing.name}" อยู่แล้ว` }); return; }
    const { contactPerson, email, phone, address, logoUrl, type, agentCode, puduShopId, puduCompanyId } = req.body;
    const customer = await prisma.customer.create({
      data: { name, contactPerson: contactPerson || '', email: email || '', phone: phone || '', address: address || '', logoUrl: logoUrl || null, type: type || 'customer', agentCode: agentCode || null, puduShopId: puduShopId || null, puduCompanyId: puduCompanyId || null },
    });
    await logActivity({
      entityType: 'Customer', entityId: customer.id, entityName: customer.name,
      action: 'created', newValues: req.body, performedBy: req.user?.username,
    });
    res.status(201).json(customer);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Failed to create customer' });
  }
});

app.put('/api/customers/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, CUSTOMER_FIELDS);
  const old = await prisma.customer.findUnique({ where: { id: req.params.id } });
  const customer = await prisma.customer.update({ where: { id: req.params.id }, data: data as any });
  await logActivity({
    entityType: 'Customer', entityId: customer.id, entityName: customer.name,
    action: 'updated', oldValues: old, newValues: data, performedBy: req.user?.username,
  });
  res.json(customer);
});

app.delete('/api/customers/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!customer) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).trashItem.create({ data: {
    entityType: 'Customer', entityId: customer.id, entityName: customer.name,
    entityData: JSON.stringify(customer), deletedBy: req.user?.username,
  }});
  await prisma.customer.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'Customer', entityId: req.params.id, entityName: customer.name,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// ── Contacts (per-customer) ───────────────────────────────────────────────────
app.get('/api/customers/:id/contacts', authenticate, async (req: AuthRequest, res: Response) => {
  const contacts = await (prisma as any).contact.findMany({
    where: { customerId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(contacts);
});

app.post('/api/customers/:id/contacts', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const data = pickFields(req.body, CONTACT_FIELDS);
  if (!data.name) { res.status(400).json({ error: 'name is required' }); return; }
  const contact = await (prisma as any).contact.create({
    data: { ...data, customerId: req.params.id },
  });
  res.status(201).json(contact);
});

app.put('/api/contacts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, CONTACT_FIELDS);
  const contact = await (prisma as any).contact.update({ where: { id: req.params.id }, data });
  res.json(contact);
});

app.delete('/api/contacts/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await (prisma as any).contact.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── Sites (per-customer) ─────────────────────────────────────────────────────
app.get('/api/customers/:id/sites', authenticate, async (req: AuthRequest, res: Response) => {
  const sites = await (prisma as any).site.findMany({
    where: { customerId: req.params.id },
    orderBy: { createdAt: 'desc' },
  });
  res.json(sites);
});

app.post('/api/customers/:id/sites', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const site = await (prisma as any).site.create({
    data: { ...req.body, customerId: req.params.id },
  });
  res.status(201).json(site);
});

app.put('/api/sites/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const site = await (prisma as any).site.update({ where: { id: req.params.id }, data: req.body });
  res.json(site);
});

app.delete('/api/sites/:id', authenticate, async (req: AuthRequest, res: Response) => {
  await (prisma as any).site.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

function addDays(isoDate: string, days: number): string {
  const next = new Date(isoDate);
  next.setDate(next.getDate() + days);
  return next.toISOString().slice(0, 10);
}

async function syncRobotStatusForTicket(ticket: { robotId: string; status: string }): Promise<void> {
  if (!ticket.robotId) return;
  if (ticket.status === 'In Progress' || ticket.status === 'Waiting Quotation' || ticket.status === 'Ready to Ship' || ticket.status === 'Pending') {
    await prisma.robot.update({ where: { id: ticket.robotId }, data: { status: 'In Maintenance' } });
    return;
  }
  if (ticket.status === 'Completed') {
    const robot = await prisma.robot.findUnique({ where: { id: ticket.robotId } });
    if (robot && robot.status !== 'Missing') {
      const restoreStatus = robot.customerId ? 'Assigned' : 'In Stock';
      await prisma.robot.update({ where: { id: ticket.robotId }, data: { status: restoreStatus } });
    }
  }
}

// ── SLA Configuration (hours) by priority ─────────────────────────────────────
const SLA_HOURS: Record<string, number> = { Critical: 4, High: 8, Normal: 24, Low: 72 };

function computeSlaDueAt(reportDate: string, priorityLevel: string): string {
  const base = new Date(reportDate);
  const hours = SLA_HOURS[priorityLevel] ?? SLA_HOURS.Normal;
  base.setHours(base.getHours() + hours);
  return base.toISOString();
}

// Round-robin auto-assign: pick the technician with fewest open tickets
async function autoAssignTechnician(): Promise<string | null> {
  const users = await prisma.user.findMany({ select: { username: true } });
  if (users.length === 0) return null;
  // Single aggregate query instead of N+1
  const grouped = await prisma.maintenanceTicket.groupBy({
    by: ['assignedTo'],
    where: { status: { not: 'Completed' }, assignedTo: { in: users.map(u => u.username) } },
    _count: { _all: true },
  });
  const countMap = new Map<string, number>();
  for (const g of grouped) if (g.assignedTo) countMap.set(g.assignedTo, g._count._all);
  const counts = users.map(u => ({ username: u.username, count: countMap.get(u.username) ?? 0 }));
  counts.sort((a, b) => a.count - b.count);
  return counts[0].username;
}

async function createMaintenanceTicketFromInput(input: {
  robotId: string;
  issueDescription: string;
  status?: string;
  reportDate?: string;
  issueImageUrl?: string | null;
  customerId?: string | null;
  assignedTo?: string | null;
  priorityLevel?: string | null;
  scheduleId?: string | null;
}, performedBy?: string) {
  const priority = input.priorityLevel || 'Normal';
  const assignedTo = input.assignedTo || await autoAssignTechnician();
  const reportDate = input.reportDate || new Date().toISOString().slice(0, 10);
  const slaHours = SLA_HOURS[priority] ?? SLA_HOURS.Normal;
  const slaDueAt = computeSlaDueAt(reportDate, priority);

  const ticket = await prisma.maintenanceTicket.create({
    data: {
      ...input,
      status: input.status || 'Pending',
      reportDate,
      trackingToken: randomUUID(),
      customerId: input.customerId || null,
      assignedTo,
      priorityLevel: priority,
      scheduleId: input.scheduleId || null,
      slaHours,
      slaDueAt,
    },
  });
  await syncRobotStatusForTicket(ticket);
  await logActivity({
    entityType: 'MaintenanceTicket',
    entityId: ticket.id,
    action: 'created',
    newValues: input,
    performedBy,
  });
  return ticket;
}

async function generateDueMaintenanceSchedules(performedBy?: string) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const dueSchedules = await (prisma as any).maintenanceSchedule.findMany({
    where: { active: true, nextDueDate: { lte: todayKey } },
    orderBy: { nextDueDate: 'asc' },
  });

  let created = 0;
  const generatedTickets = [] as any[];

  for (const schedule of dueSchedules) {
    const existingOpen = await prisma.maintenanceTicket.findFirst({
      where: {
        scheduleId: schedule.id,
        status: { not: 'Completed' },
      },
    });
    if (existingOpen) continue;

    const robot = await prisma.robot.findUnique({ where: { id: schedule.robotId } });
    const ticket = await createMaintenanceTicketFromInput({
      robotId: schedule.robotId,
      customerId: schedule.customerId || robot?.customerId || null,
      issueDescription: `Preventive maintenance: ${schedule.title}`,
      status: 'Pending',
      reportDate: todayKey,
      assignedTo: schedule.assignedTo,
      priorityLevel: schedule.priorityLevel,
      scheduleId: schedule.id,
    }, performedBy);

    await (prisma as any).maintenanceSchedule.update({
      where: { id: schedule.id },
      data: {
        lastGeneratedAt: todayKey,
        nextDueDate: addDays(schedule.nextDueDate, schedule.frequencyDays),
      },
    });
    await logActivity({
      entityType: 'MaintenanceSchedule',
      entityId: schedule.id,
      entityName: schedule.title,
      action: 'generated',
      newValues: { ticketId: ticket.id, generatedAt: todayKey },
      performedBy,
    });
    created += 1;
    generatedTickets.push(ticket);
  }

  return { created, generatedTickets };
}

async function generateDueMAVisitTickets(performedBy?: string) {
  const todayKey = new Date().toISOString().slice(0, 10);
  const dueVisits = await (prisma as any).maintenanceVisit.findMany({
    where: { status: 'Scheduled', scheduledDate: { lte: todayKey } },
    include: {
      plan: {
        include: {
          customer: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ scheduledDate: 'asc' }, { visitNumber: 'asc' }],
  });

  let created = 0;
  const generatedTickets = [] as any[];

  for (const visit of dueVisits) {
    const customerId = visit.plan?.customer?.id;
    if (!customerId) continue;

    const robots = await prisma.robot.findMany({
      where: {
        customerId,
        archivedAt: null,
      },
      orderBy: { serialNumber: 'asc' },
      select: { id: true, serialNumber: true },
    });
    const primaryRobot = robots[0];
    if (!primaryRobot) continue;

    const issueDescription = `MA Visit รอบที่ ${visit.visitNumber} - ${visit.plan.customer.name}`;
    const existingTicket = await prisma.maintenanceTicket.findFirst({
      where: {
        customerId,
        issueDescription,
        status: { not: 'Completed' },
      },
    });
    if (existingTicket) continue;

    const ticket = await createMaintenanceTicketFromInput({
      robotId: primaryRobot.id,
      customerId,
      issueDescription,
      status: 'Pending',
      reportDate: visit.scheduledDate,
      priorityLevel: 'Normal',
    }, performedBy);

    await logActivity({
      entityType: 'MaintenanceVisit',
      entityId: visit.id,
      entityName: visit.plan.customer.name,
      action: 'generated_ticket',
      newValues: { ticketId: ticket.id, visitNumber: visit.visitNumber, scheduledDate: visit.scheduledDate, robotId: primaryRobot.id },
      performedBy,
    });

    created += 1;
    generatedTickets.push(ticket);
  }

  return { created, generatedTickets };
}

// ── Customer Portal (public, token-based) ─────────────────────────────────────
// Generate portal token for a customer
app.post('/api/customers/:id/portal-token', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const token = randomUUID();
  const customer = await prisma.customer.update({
    where: { id: req.params.id },
    data: { portalToken: token },
  });
  res.json({ portalToken: token, customerName: customer.name });
});

// Public portal: view customer's robots
app.get('/api/portal/:token/robots', async (req: Request, res: Response): Promise<void> => {
  const customer = await prisma.customer.findUnique({ where: { portalToken: req.params.token } });
  if (!customer) { res.status(404).json({ error: 'Invalid portal token' }); return; }
  const robots = await prisma.robot.findMany({
    where: { customerId: customer.id },
    select: { id: true, serialNumber: true, status: true, purchaseDate: true, warrantyExpiresAt: true, modelId: true },
  });
  const models = await prisma.robotModel.findMany({ select: { id: true, name: true, type: true } });
  const modelMap = Object.fromEntries(models.map(m => [m.id, m]));
  res.json({
    customer: { name: customer.name },
    robots: robots.map(r => ({ ...r, model: modelMap[r.modelId] || null })),
  });
});

// Public portal: view customer's tickets
app.get('/api/portal/:token/tickets', async (req: Request, res: Response): Promise<void> => {
  const customer = await prisma.customer.findUnique({ where: { portalToken: req.params.token } });
  if (!customer) { res.status(404).json({ error: 'Invalid portal token' }); return; }
  const tickets = await prisma.maintenanceTicket.findMany({
    where: { customerId: customer.id },
    orderBy: { reportDate: 'desc' },
    select: {
      id: true, status: true, reportDate: true, issueDescription: true,
      resolution: true, priorityLevel: true, robotId: true, slaDueAt: true,
      slaBreachedAt: true,
    },
    take: 50,
  });
  res.json(tickets);
});

// Public portal: submit a new ticket request
app.post('/api/portal/:token/tickets', async (req: Request, res: Response): Promise<void> => {
  const customer = await prisma.customer.findUnique({ where: { portalToken: req.params.token } });
  if (!customer) { res.status(404).json({ error: 'Invalid portal token' }); return; }
  const { robotId, issueDescription } = req.body;
  if (!robotId || !issueDescription) {
    res.status(400).json({ error: 'robotId and issueDescription required' }); return;
  }
  // Verify robot belongs to this customer
  const robot = await prisma.robot.findUnique({ where: { id: robotId } });
  if (!robot || robot.customerId !== customer.id) {
    res.status(400).json({ error: 'Robot does not belong to this customer' }); return;
  }
  const ticket = await createMaintenanceTicketFromInput({
    robotId,
    customerId: customer.id,
    issueDescription,
    status: 'Pending',
    priorityLevel: 'Normal',
  }, `portal:${customer.name}`);
  await createNotification('ticket_updated', `Portal: ลูกค้าแจ้งซ่อม`, `${customer.name} แจ้งปัญหา: ${issueDescription.slice(0, 60)}`, 'MaintenanceTicket', ticket.id);
  res.status(201).json({ id: ticket.id, trackingToken: ticket.trackingToken, status: ticket.status });
});

// Public portal: view customer's delivery notes
app.get('/api/portal/:token/delivery-notes', async (req: Request, res: Response): Promise<void> => {
  const customer = await prisma.customer.findUnique({ where: { portalToken: req.params.token } });
  if (!customer) { res.status(404).json({ error: 'Invalid portal token' }); return; }
  const notes = await prisma.deliveryNote.findMany({
    where: { customerId: customer.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, docNumber: true, deliveryDate: true, status: true, trackingNumber: true, installedAt: true, acceptedAt: true },
    take: 50,
  });
  res.json(notes);
});

// ── Status Workflow Validation ─────────────────────────────────────────────────
const TICKET_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['In Progress', 'Cancelled'],
  'In Progress': ['Waiting Quotation', 'Ready to Ship', 'Completed', 'Pending'],
  'Waiting Quotation': ['In Progress', 'Ready to Ship', 'Cancelled'],
  'Ready to Ship': ['Completed', 'In Progress'],
  'Completed': [],
  'Cancelled': ['Pending'],
};

const PO_TRANSITIONS: Record<string, string[]> = {
  'Draft': ['Ordered', 'Cancelled'],
  'Ordered': ['Partial', 'Received', 'Cancelled'],
  'Partial': ['Received', 'Cancelled'],
  'Received': [],
  'Cancelled': ['Draft'],
};

const DN_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Packed', 'In Transit', 'Delivered'],
  'Packed': ['In Transit', 'Delivered', 'Pending'],
  'In Transit': ['Delivered', 'Packed'],
  'Delivered': ['Accepted', 'In Transit'],
  'Accepted': ['Invoiced'],
  'Invoiced': [],
};

const LOAN_TRANSITIONS: Record<string, string[]> = {
  'Pending': ['Approved', 'Cancelled'],
  'Approved': ['Active', 'Cancelled'],
  'Active': ['Returned', 'Cancelled'],
  'Returned': [],
  'Cancelled': ['Pending'],
};

const PROJECT_REQUEST_TRANSITIONS: Record<string, string[]> = {
  'Draft': ['Pending', 'Cancelled'],
  'Pending': ['Approved', 'Cancelled'],
  'Approved': ['InProgress', 'Cancelled'],
  'InProgress': ['Completed', 'Cancelled'],
  'Completed': [],
  'Cancelled': ['Draft'],
};

function isValidTransition(transitions: Record<string, string[]>, from: string, to: string): boolean {
  if (from === to) return true; // no-op is always ok
  const allowed = transitions[from];
  return allowed ? allowed.includes(to) : false;
}

// ── Robots ────────────────────────────────────────────────────────────────────

app.get('/api/robots', authenticate, async (_req: AuthRequest, res: Response) => {
  const robots = await prisma.robot.findMany({ orderBy: { serialNumber: 'asc' } });
  res.json(robots);
});

app.post('/api/robots', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, ROBOT_FIELDS);
  if (!data.serialNumber || !data.modelId || !data.status || !data.purchaseDate) {
    res.status(400).json({ error: 'serialNumber, modelId, status, purchaseDate are required' }); return;
  }
  const robot = await prisma.robot.create({ data: data as any });
  await logActivity({
    entityType: 'Robot', entityId: robot.id, entityName: robot.serialNumber,
    action: 'created', newValues: data, performedBy: req.user?.username,
  });
  res.status(201).json(robot);
});

app.put('/api/robots/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, ROBOT_FIELDS);
  const old = await prisma.robot.findUnique({ where: { id: req.params.id } });
  const robot = await prisma.robot.update({ where: { id: req.params.id }, data: data as any });
  const action = old?.status !== robot.status ? 'status_changed' : 'updated';
  await logActivity({
    entityType: 'Robot', entityId: robot.id, entityName: robot.serialNumber,
    action,
    oldValues: { status: old?.status },
    newValues: { status: robot.status },
    performedBy: req.user?.username,
  });
  res.json(robot);
});

// Bulk status update for robots
app.post('/api/robots/bulk-status', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { ids, status, customerId } = req.body;
  if (!ids?.length || !status) { res.status(400).json({ error: 'ids and status required' }); return; }
  await prisma.robot.updateMany({ where: { id: { in: ids } }, data: { status, customerId: customerId || null } });
  for (const id of ids) {
    const r = await prisma.robot.findUnique({ where: { id } });
    if (r) await logActivity({ entityType: 'Robot', entityId: r.id, entityName: r.serialNumber, action: 'status_changed', newValues: { status }, performedBy: req.user?.username });
  }
  res.json({ updated: ids.length });
});

app.delete('/api/robots/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const robot = await prisma.robot.findUnique({ where: { id: req.params.id } });
  if (!robot) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).trashItem.create({ data: {
    entityType: 'Robot', entityId: robot.id, entityName: robot.serialNumber,
    entityData: JSON.stringify(robot), deletedBy: req.user?.username,
  }});
  await prisma.robot.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'Robot', entityId: req.params.id, entityName: robot.serialNumber,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// ── Maintenance Tickets ───────────────────────────────────────────────────────

app.get('/api/maintenance-schedules', authenticate, async (_req: AuthRequest, res: Response) => {
  const schedules = await (prisma as any).maintenanceSchedule.findMany({
    orderBy: [{ active: 'desc' }, { nextDueDate: 'asc' }],
  });
  res.json(schedules);
});

app.post('/api/maintenance-schedules', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const payload = req.body || {};
  if (!payload.title || !payload.robotId || !payload.frequencyDays || !payload.nextDueDate) {
    res.status(400).json({ error: 'title, robotId, frequencyDays and nextDueDate required' });
    return;
  }
  const robot = await prisma.robot.findUnique({ where: { id: payload.robotId } });
  if (!robot) {
    res.status(404).json({ error: 'Robot not found' });
    return;
  }
  const schedule = await (prisma as any).maintenanceSchedule.create({
    data: {
      title: String(payload.title).trim(),
      robotId: payload.robotId,
      customerId: payload.customerId || robot.customerId || null,
      frequencyDays: Number(payload.frequencyDays),
      leadDays: Number(payload.leadDays || 7),
      nextDueDate: payload.nextDueDate,
      assignedTo: payload.assignedTo || null,
      priorityLevel: payload.priorityLevel || 'Normal',
      notes: payload.notes || null,
      active: payload.active !== false,
    },
  });
  await logActivity({
    entityType: 'MaintenanceSchedule',
    entityId: schedule.id,
    entityName: schedule.title,
    action: 'created',
    newValues: payload,
    performedBy: req.user?.username,
  });
  res.status(201).json(schedule);
});

app.put('/api/maintenance-schedules/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const old = await (prisma as any).maintenanceSchedule.findUnique({ where: { id: req.params.id } });
  if (!old) {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }
  const data = {
    ...(req.body.title !== undefined ? { title: String(req.body.title).trim() } : {}),
    ...(req.body.robotId !== undefined ? { robotId: req.body.robotId } : {}),
    ...(req.body.customerId !== undefined ? { customerId: req.body.customerId || null } : {}),
    ...(req.body.frequencyDays !== undefined ? { frequencyDays: Number(req.body.frequencyDays) } : {}),
    ...(req.body.leadDays !== undefined ? { leadDays: Number(req.body.leadDays) } : {}),
    ...(req.body.nextDueDate !== undefined ? { nextDueDate: req.body.nextDueDate } : {}),
    ...(req.body.lastCompletedAt !== undefined ? { lastCompletedAt: req.body.lastCompletedAt || null } : {}),
    ...(req.body.assignedTo !== undefined ? { assignedTo: req.body.assignedTo || null } : {}),
    ...(req.body.priorityLevel !== undefined ? { priorityLevel: req.body.priorityLevel || 'Normal' } : {}),
    ...(req.body.notes !== undefined ? { notes: req.body.notes || null } : {}),
    ...(req.body.active !== undefined ? { active: !!req.body.active } : {}),
  };
  const schedule = await (prisma as any).maintenanceSchedule.update({ where: { id: req.params.id }, data });
  await logActivity({
    entityType: 'MaintenanceSchedule',
    entityId: schedule.id,
    entityName: schedule.title,
    action: 'updated',
    oldValues: old,
    newValues: data,
    performedBy: req.user?.username,
  });
  res.json(schedule);
});

app.delete('/api/maintenance-schedules/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const schedule = await (prisma as any).maintenanceSchedule.findUnique({ where: { id: req.params.id } });
  if (!schedule) {
    res.status(404).json({ error: 'Schedule not found' });
    return;
  }
  await (prisma as any).maintenanceSchedule.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'MaintenanceSchedule',
    entityId: schedule.id,
    entityName: schedule.title,
    action: 'deleted',
    performedBy: req.user?.username,
  });
  res.json({ success: true });
});

app.post('/api/maintenance-schedules/generate-due', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await generateDueMaintenanceSchedules(req.user?.username);
  res.json(result);
});

// ── Maintenance Plans (per-customer MA round, every N months) ─────────────────
function addMonths(isoDate: string, months: number): string {
  const [y, m, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, day));
  // Handle month-end overflow (e.g. Jan 31 + 1m → Mar 3 → roll back to Feb 28)
  if (d.getUTCDate() !== day) { d.setUTCDate(0); }
  return d.toISOString().slice(0, 10);
}

function buildPlanVisitDates(startDate: string, endDate: string | null, intervalMonths: number): string[] {
  const dates: string[] = [];
  const interval = Math.max(1, Number(intervalMonths) || 3);
  const cap = endDate || addMonths(startDate, interval * 24); // safety cap: 24 visits if open-ended
  let cursor = addMonths(startDate, interval); // first visit = start + interval (not start day itself)
  let guard = 0;
  while (cursor <= cap && guard < 200) {
    dates.push(cursor);
    cursor = addMonths(cursor, interval);
    guard += 1;
  }
  return dates;
}

async function regeneratePlanVisits(planId: string): Promise<{ created: number; kept: number }> {
  const plan = await (prisma as any).maintenancePlan.findUnique({ where: { id: planId } });
  if (!plan) return { created: 0, kept: 0 };
  const wantedDates = buildPlanVisitDates(plan.startDate, plan.endDate, plan.intervalMonths);
  const existing = await (prisma as any).maintenanceVisit.findMany({ where: { planId } });
  const existingByDate = new Map<string, any>(existing.map((v: any) => [v.scheduledDate, v]));

  // Delete future Scheduled visits that are no longer wanted
  const wantedSet = new Set(wantedDates);
  const stale = existing.filter((v: any) => v.status === 'Scheduled' && !wantedSet.has(v.scheduledDate));
  for (const v of stale) {
    await (prisma as any).maintenanceVisit.delete({ where: { id: v.id } });
  }

  let created = 0;
  let kept = 0;
  let visitNumber = 0;
  for (const date of wantedDates) {
    visitNumber += 1;
    const found = existingByDate.get(date);
    if (found) {
      if (found.visitNumber !== visitNumber) {
        await (prisma as any).maintenanceVisit.update({ where: { id: found.id }, data: { visitNumber } });
      }
      kept += 1;
      continue;
    }
    await (prisma as any).maintenanceVisit.create({
      data: { planId, visitNumber, scheduledDate: date, status: 'Scheduled' },
    });
    created += 1;
  }
  return { created, kept };
}

// A plan with no robots covers all of the customer's robots; otherwise only the listed ones.
async function withPlanRobotIds<T extends { id: string }>(plans: T[]): Promise<(T & { robotIds: string[] })[]> {
  const links: { planId: string; robotId: string }[] = plans.length
    ? await (prisma as any).maintenancePlanRobot.findMany({ where: { planId: { in: plans.map(plan => plan.id) } } })
    : [];
  const byPlan = new Map<string, string[]>();
  for (const link of links) {
    const list = byPlan.get(link.planId);
    if (list) list.push(link.robotId); else byPlan.set(link.planId, [link.robotId]);
  }
  return plans.map(plan => ({ ...plan, robotIds: byPlan.get(plan.id) ?? [] }));
}

async function validatePlanRobotIds(customerId: string, raw: unknown): Promise<{ ids: string[] } | { error: string }> {
  if (raw === undefined || raw === null) return { ids: [] };
  if (!Array.isArray(raw) || raw.some(value => typeof value !== 'string')) return { error: 'robotIds must be an array of ids' };
  const ids = [...new Set(raw as string[])];
  if (ids.length === 0) return { ids };
  const owned = await prisma.robot.count({ where: { id: { in: ids }, customerId } });
  if (owned !== ids.length) return { error: 'พบหุ่นยนต์ที่ไม่ได้เป็นของลูกค้าที่เลือก' };
  return { ids };
}

async function replacePlanRobots(planId: string, robotIds: string[]) {
  await (prisma as any).maintenancePlanRobot.deleteMany({ where: { planId } });
  if (robotIds.length > 0) {
    await (prisma as any).maintenancePlanRobot.createMany({ data: robotIds.map(robotId => ({ planId, robotId })) });
  }
}

// ── /api/site-surveys — AMR / cleaning-robot site survey forms ─────────────────
const SITE_SURVEY_FORM_TYPES = new Set(['amr', 'cleaning']);
const toSiteSurveyJson = (row: any) => ({ ...row, answers: (() => { try { return JSON.parse(row.answers); } catch { return {}; } })() });

app.get('/api/site-surveys', authenticate, async (_req: AuthRequest, res: Response) => {
  const rows = await (prisma as any).siteSurvey.findMany({ orderBy: { createdAt: 'desc' } });
  res.json(rows.map(toSiteSurveyJson));
});

app.get('/api/site-surveys/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const row = await (prisma as any).siteSurvey.findUnique({ where: { id: req.params.id } });
  if (!row) { res.status(404).json({ error: 'Survey not found' }); return; }
  res.json(toSiteSurveyJson(row));
});

app.post('/api/site-surveys', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body || {};
  if (!SITE_SURVEY_FORM_TYPES.has(b.formType)) { res.status(400).json({ error: 'formType must be amr or cleaning' }); return; }
  if (!b.siteName?.trim()) { res.status(400).json({ error: 'กรุณากรอกชื่อโรงงาน/สถานที่' }); return; }
  const row = await (prisma as any).siteSurvey.create({
    data: {
      formType: b.formType,
      siteName: b.siteName.trim(),
      surveyDate: b.surveyDate || null,
      engineerName: b.engineerName || null,
      zone: b.zone || null,
      answers: JSON.stringify(b.answers ?? {}),
      createdBy: req.user?.username,
    },
  });
  await logActivity({ entityType: 'SiteSurvey', entityId: row.id, entityName: row.siteName, action: 'created', newValues: b, performedBy: req.user?.username });
  res.status(201).json(toSiteSurveyJson(row));
});

app.put('/api/site-surveys/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body || {};
  const old = await (prisma as any).siteSurvey.findUnique({ where: { id: req.params.id } });
  if (!old) { res.status(404).json({ error: 'Survey not found' }); return; }
  const data: Record<string, unknown> = {};
  if (b.siteName !== undefined) data.siteName = String(b.siteName).trim();
  if (b.surveyDate !== undefined) data.surveyDate = b.surveyDate || null;
  if (b.engineerName !== undefined) data.engineerName = b.engineerName || null;
  if (b.zone !== undefined) data.zone = b.zone || null;
  if (b.answers !== undefined) data.answers = JSON.stringify(b.answers ?? {});
  const row = await (prisma as any).siteSurvey.update({ where: { id: req.params.id }, data });
  await logActivity({ entityType: 'SiteSurvey', entityId: row.id, action: 'updated', oldValues: old, newValues: b, performedBy: req.user?.username });
  res.json(toSiteSurveyJson(row));
});

app.delete('/api/site-surveys/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const row = await (prisma as any).siteSurvey.findUnique({ where: { id: req.params.id } });
  if (!row) { res.status(404).json({ error: 'Survey not found' }); return; }
  await (prisma as any).siteSurvey.delete({ where: { id: req.params.id } });
  await logActivity({ entityType: 'SiteSurvey', entityId: row.id, entityName: row.siteName, action: 'deleted', performedBy: req.user?.username });
  res.json({ success: true });
});

app.get('/api/ma-plans', authenticate, async (_req: AuthRequest, res: Response) => {
  await generateDueMAVisitTickets('system');
  // Auto-skip visits overdue by more than 180 days
  const cutoff = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const stale = await (prisma as any).maintenanceVisit.findMany({
    where: { status: 'Scheduled', scheduledDate: { lt: cutoff } },
  });
  if (stale.length > 0) {
    for (const v of stale) {
      await (prisma as any).maintenanceVisit.update({
        where: { id: v.id },
        data: { status: 'Skipped' },
      });
    }
    console.log(`[ma-plans] Auto-skipped ${stale.length} visits overdue > 180 days (cutoff: ${cutoff})`);
  }

  const plans = await (prisma as any).maintenancePlan.findMany({
    orderBy: [{ active: 'desc' }, { startDate: 'asc' }],
    include: { visits: { orderBy: { visitNumber: 'asc' } } },
  });
  res.json(await withPlanRobotIds(plans));
});

app.post('/api/ma-plans', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const b = req.body || {};
  if (!b.customerId || !b.startDate) {
    res.status(400).json({ error: 'customerId and startDate are required' });
    return;
  }
  const customer = await prisma.customer.findUnique({ where: { id: b.customerId } });
  if (!customer) { res.status(404).json({ error: 'Customer not found' }); return; }
  const robotCheck = await validatePlanRobotIds(b.customerId, b.robotIds);
  if ('error' in robotCheck) { res.status(400).json({ error: robotCheck.error }); return; }
  const plan = await (prisma as any).maintenancePlan.create({
    data: {
      customerId: b.customerId,
      startDate: b.startDate,
      endDate: b.endDate || null,
      intervalMonths: Number(b.intervalMonths || 3),
      notes: b.notes || null,
      active: b.active !== false,
    },
  });
  await replacePlanRobots(plan.id, robotCheck.ids);
  await regeneratePlanVisits(plan.id);
  await logActivity({
    entityType: 'MaintenancePlan',
    entityId: plan.id,
    entityName: customer.name,
    action: 'created',
    newValues: b,
    performedBy: req.user?.username,
  });
  const full = await (prisma as any).maintenancePlan.findUnique({
    where: { id: plan.id },
    include: { visits: { orderBy: { visitNumber: 'asc' } } },
  });
  const [withIds] = await withPlanRobotIds([full]);
  res.status(201).json(withIds);
});

app.put('/api/ma-plans/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const old = await (prisma as any).maintenancePlan.findUnique({ where: { id: req.params.id } });
  if (!old) { res.status(404).json({ error: 'Plan not found' }); return; }
  const b = req.body || {};
  const robotCheck = b.robotIds !== undefined ? await validatePlanRobotIds(old.customerId, b.robotIds) : null;
  if (robotCheck && 'error' in robotCheck) { res.status(400).json({ error: robotCheck.error }); return; }
  const data = {
    ...(b.startDate !== undefined ? { startDate: b.startDate } : {}),
    ...(b.endDate !== undefined ? { endDate: b.endDate || null } : {}),
    ...(b.intervalMonths !== undefined ? { intervalMonths: Number(b.intervalMonths) } : {}),
    ...(b.notes !== undefined ? { notes: b.notes || null } : {}),
    ...(b.active !== undefined ? { active: !!b.active } : {}),
  };
  await (prisma as any).maintenancePlan.update({ where: { id: req.params.id }, data });
  if (robotCheck) await replacePlanRobots(req.params.id, robotCheck.ids);
  const scheduleAffected =
    data.startDate !== undefined ||
    data.endDate !== undefined ||
    data.intervalMonths !== undefined;
  if (scheduleAffected) await regeneratePlanVisits(req.params.id);
  await logActivity({
    entityType: 'MaintenancePlan',
    entityId: req.params.id,
    action: 'updated',
    oldValues: old,
    newValues: robotCheck ? { ...data, robotIds: robotCheck.ids } : data,
    performedBy: req.user?.username,
  });
  const full = await (prisma as any).maintenancePlan.findUnique({
    where: { id: req.params.id },
    include: { visits: { orderBy: { visitNumber: 'asc' } } },
  });
  const [withIds] = await withPlanRobotIds([full]);
  res.json(withIds);
});

app.delete('/api/ma-plans/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const plan = await (prisma as any).maintenancePlan.findUnique({ where: { id: req.params.id } });
  if (!plan) { res.status(404).json({ error: 'Plan not found' }); return; }
  await (prisma as any).maintenancePlan.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'MaintenancePlan',
    entityId: req.params.id,
    action: 'deleted',
    performedBy: req.user?.username,
  });
  res.json({ success: true });
});

app.post('/api/ma-plans/:id/regenerate', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await regeneratePlanVisits(req.params.id);
  res.json(result);
});

// ── MA Plans — Import from Excel upload ─────────────────────────────────────
app.post('/api/ma-plans/import/upload', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    console.log('[ma-plans/import/upload] File received:', req.file.originalname, req.file.size, 'bytes');
    const XLSX = await import('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: null });
    if (rows.length === 0) { res.status(400).json({ error: 'ไฟล์ไม่มีข้อมูล' }); return; }
    console.log('[ma-plans/import/upload] Parsed', rows.length, 'rows');

    const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true } }) as any[];
    const byName = new Map(allCustomers.map((c: any) => [c.name.trim().toLowerCase(), c]));
    const existingPlans = await (prisma as any).maintenancePlan.findMany();
    const planByCustomer = new Map(existingPlans.map((p: any) => [p.customerId, p]));
    console.log('[ma-plans/import/upload] Existing plans:', existingPlans.length, 'customers:', allCustomers.length);

    let createdCustomers = 0, createdPlans = 0, skipped = 0, totalVisits = 0;
    const details: any[] = [];

    for (const row of rows) {
      const name = (row['Store Name'] || '').toString().trim();
      const creation = (row['Creation Time'] || '').toString().trim();
      const rowStatus = (row['Status'] || '').toString().trim();
      if (!name || !creation) { skipped++; details.push({ name: name || '(ว่าง)', action: 'skip', reason: 'ชื่อหรือวันที่ว่าง' }); continue; }

      let startDate: string;
      if (row['Creation Time'] instanceof Date) {
        startDate = row['Creation Time'].toISOString().slice(0, 10);
      } else {
        const m = creation.match(/^(\d{4}-\d{2}-\d{2})/);
        if (!m) { skipped++; details.push({ name, action: 'skip', reason: `วันที่ไม่ถูกต้อง: ${creation}` }); continue; }
        startDate = m[1];
      }

      let cust = byName.get(name.toLowerCase());
      if (!cust) {
        cust = await prisma.customer.create({
          data: { name, contactPerson: '', email: '', phone: row['Contact Information'] || '', address: row['Detailed Address'] || '', type: 'customer' },
        });
        byName.set(name.toLowerCase(), cust);
        createdCustomers++;
      }

      if (planByCustomer.has(cust.id)) {
        skipped++; details.push({ name, action: 'skip', reason: 'มี MA Plan อยู่แล้ว' }); continue;
      }

      const plan = await (prisma as any).maintenancePlan.create({
        data: { customerId: cust.id, startDate, endDate: null, intervalMonths: 3, notes: `นำเข้าจาก Excel · ${rowStatus}`, active: rowStatus.toLowerCase() === 'open' },
      });
      planByCustomer.set(cust.id, plan);
      const { created } = await regeneratePlanVisits(plan.id);
      createdPlans++; totalVisits += created;
      details.push({ name, action: 'create', reason: `สร้าง MA Plan + ${created} visits`, startDate });
    }

    console.log('[ma-plans/import/upload] Done:', { createdCustomers, createdPlans, skipped, totalVisits });
    await logActivity({ entityType: 'MAImport', entityId: 'xlsx', action: 'import-ma-plans', performedBy: req.user?.username, newValues: { createdCustomers, createdPlans, skipped, totalVisits } });
    res.json({ totalRows: rows.length, createdCustomers, createdPlans, skipped, totalVisits, details });
  } catch (err: any) {
    console.error('[ma-plans/import/upload] Error:', err);
    res.status(500).json({ error: err?.message || 'Import failed' });
  }
});

// Visits
app.get('/api/ma-visits', authenticate, async (req: AuthRequest, res: Response) => {
  const { upcomingDays, status, planId } = req.query;
  const where: any = {};
  if (status) where.status = String(status);
  if (planId) where.planId = String(planId);
  if (upcomingDays) {
    const today = new Date().toISOString().slice(0, 10);
    const until = addDays(today, Number(upcomingDays) || 14);
    where.scheduledDate = { gte: today, lte: until };
    where.status = 'Scheduled';
  }
  const visits = await (prisma as any).maintenanceVisit.findMany({
    where,
    orderBy: { scheduledDate: 'asc' },
    include: { plan: { include: { customer: { select: { id: true, name: true } } } } },
  });
  res.json(visits);
});

app.patch('/api/ma-visits/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const old = await (prisma as any).maintenanceVisit.findUnique({ where: { id: req.params.id } });
  if (!old) { res.status(404).json({ error: 'Visit not found' }); return; }
  const b = req.body || {};
  const data: any = {
    ...(b.status !== undefined ? { status: b.status } : {}),
    ...(b.scheduledDate !== undefined ? { scheduledDate: b.scheduledDate } : {}),
    ...(b.completedAt !== undefined ? { completedAt: b.completedAt || null } : {}),
    ...(b.technician !== undefined ? { technician: b.technician || null } : {}),
    ...(b.summary !== undefined ? { summary: b.summary || null } : {}),
    ...(b.report !== undefined ? { reportJson: b.report ? JSON.stringify(b.report) : null } : {}),
  };
  if (data.status === 'Done' && !data.completedAt) {
    data.completedAt = new Date().toISOString().slice(0, 10);
  }
  const visit = await (prisma as any).maintenanceVisit.update({ where: { id: req.params.id }, data });
  await logActivity({
    entityType: 'MaintenanceVisit',
    entityId: visit.id,
    action: 'updated',
    oldValues: old,
    newValues: data,
    performedBy: req.user?.username,
  });
  res.json(visit);
});

app.get('/api/tickets', authenticate, async (_req: AuthRequest, res: Response) => {
  await generateDueMAVisitTickets('system');
  const tickets = await prisma.maintenanceTicket.findMany({ orderBy: { reportDate: 'desc' } });
  res.json(tickets);
});

app.post('/api/tickets', authenticate, async (req: AuthRequest, res: Response) => {
  const ticket = await createMaintenanceTicketFromInput(req.body, req.user?.username);
  res.status(201).json(ticket);
});

app.put('/api/tickets/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const old = await prisma.maintenanceTicket.findUnique({ where: { id: req.params.id } });
  if (!old) { res.status(404).json({ error: 'Not found' }); return; }
  // Validate status transition
  if (req.body.status && req.body.status !== old.status) {
    if (!isValidTransition(TICKET_TRANSITIONS, old.status, req.body.status)) {
      res.status(400).json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${old.status}" เป็น "${req.body.status}" ได้` });
      return;
    }
  }
  const ticket = await prisma.maintenanceTicket.update({ where: { id: req.params.id }, data: req.body });
  const action = old?.status !== ticket.status ? 'status_changed' : 'updated';
  const statusChanged = old?.status !== ticket.status;
  if (statusChanged && ticket.robotId) await syncRobotStatusForTicket(ticket);
  if (statusChanged && ticket.status === 'Completed' && ticket.scheduleId) {
    await (prisma as any).maintenanceSchedule.update({
      where: { id: ticket.scheduleId },
      data: { lastCompletedAt: ticket.reportDate },
    }).catch(() => {});
  }
  // Notify on status change or new assignment
  if (statusChanged) {
    const statusLabel: Record<string, string> = { Pending: 'รอดำเนินการ', 'In Progress': 'กำลังซ่อม', 'Waiting Quotation': 'รอใบเสนอราคา', 'Ready to Ship': 'รอส่งคืน', Completed: 'เสร็จสิ้น' };
    await createNotification('ticket_updated', `Ticket อัปเดต: ${statusLabel[ticket.status] || ticket.status}`, `Ticket #${ticket.id.slice(0,8).toUpperCase()} เปลี่ยนจาก "${old?.status}" → "${ticket.status}"`, 'MaintenanceTicket', ticket.id);
  }
  if ((req.body.assignedTo) && req.body.assignedTo !== (old as any)?.assignedTo) {
    await createNotification('ticket_updated', `มอบหมายงานให้ ${req.body.assignedTo}`, `Ticket #${ticket.id.slice(0,8).toUpperCase()} ถูกมอบหมายให้ ${req.body.assignedTo}`, 'MaintenanceTicket', ticket.id);
  }
  await logActivity({
    entityType: 'MaintenanceTicket', entityId: ticket.id,
    action,
    oldValues: { status: old?.status },
    newValues: { status: ticket.status },
    performedBy: req.user?.username,
  });
  res.json(ticket);
});

app.delete('/api/tickets/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  await prisma.maintenanceTicket.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'MaintenanceTicket', entityId: req.params.id,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// POST /api/tickets/:id/tracking-token — get or generate tracking token
app.post('/api/tickets/:id/tracking-token', authenticate, async (req: AuthRequest, res: Response) => {
  let ticket = await prisma.maintenanceTicket.findUnique({ where: { id: req.params.id } });
  if (!ticket) { res.status(404).json({ error: 'Not found' }); return; }
  if (!ticket.trackingToken) {
    ticket = await prisma.maintenanceTicket.update({
      where: { id: req.params.id },
      data: { trackingToken: randomUUID() },
    });
  }
  res.json({ trackingToken: ticket.trackingToken });
});

// GET /api/tickets/:id/used-parts — list used parts for a ticket
app.get('/api/tickets/:id/used-parts', authenticate, async (req: AuthRequest, res: Response) => {
  const parts = await prisma.usedPart.findMany({
    where: { ticketId: req.params.id },
    include: { sparePart: true },
  });
  res.json(parts);
});

// POST /api/tickets/:id/used-parts — replace used parts and sync stock
app.post('/api/tickets/:id/used-parts', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const ticketId = req.params.id;
  const newParts: { sparePartId: string; quantity: number; note?: string }[] = req.body.parts || [];

  // Restore stock from existing used parts before replacing
  const existing = await prisma.usedPart.findMany({ where: { ticketId } });
  for (const p of existing) {
    await prisma.sparePart.update({
      where: { id: p.sparePartId },
      data: { stock: { increment: p.quantity } },
    });
  }
  // Delete existing used parts
  await prisma.usedPart.deleteMany({ where: { ticketId } });

  // Validate stock sufficiency
  for (const p of newParts) {
    const part = await prisma.sparePart.findUnique({ where: { id: p.sparePartId } });
    if (!part) { res.status(400).json({ error: `SparePart ${p.sparePartId} not found` }); return; }
    if (part.stock < p.quantity) {
      res.status(400).json({ error: `${part.name}: สต็อกไม่พอ (มี ${part.stock}, ต้องการ ${p.quantity})` });
      return;
    }
  }

  // Create new used parts and decrement stock
  const created = [];
  for (const p of newParts) {
    const trackedCount = await (prisma as any).sparePartItem.count({ where: { sparePartId: p.sparePartId } });
    if (trackedCount > 0) {
      if (trackedCount < p.quantity) { res.status(400).json({ error: `SN ของอะไหล่รายการนี้มีเพียง ${trackedCount} ชิ้น` }); return; }
      await consumeTrackedSparePartItems(p.sparePartId, p.quantity);
    } else {
      await prisma.sparePart.update({
        where: { id: p.sparePartId },
        data: { stock: { decrement: p.quantity } },
      });
    }
    const up = await prisma.usedPart.create({ data: { ticketId, ...p } });
    created.push(up);
  }

  res.json(created);
});

// ── Public: Customer Repair Tracking ────────────────────────────────────────
app.get('/api/track/:token', async (req: Request, res: Response): Promise<void> => {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { trackingToken: req.params.token },
    include: {
      robot: { include: { model: true } },
    },
  });
  if (!ticket) { res.status(404).json({ error: 'ไม่พบข้อมูลการซ่อม' }); return; }
  res.json({
    id: ticket.id,
    status: ticket.status,
    reportDate: ticket.reportDate,
    issueDescription: ticket.issueDescription,
    resolution: ticket.resolution,
    robot: {
      serialNumber: ticket.robot.serialNumber,
      model: ticket.robot.model.name,
      type: ticket.robot.model.type,
    },
  });
});

// ── Warehouses ────────────────────────────────────────────────────────────────

app.get('/api/warehouses', authenticate, async (_req: AuthRequest, res: Response) => {
  const warehouses = await listFixedWarehouses();
  res.json(warehouses);
});

app.post('/api/warehouses', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  res.status(403).json({ error: 'คลังสินค้าถูกกำหนดตายตัวเป็น OZONE-BKK และ OZONE-CNX' });
});

app.put('/api/warehouses/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  res.status(403).json({ error: 'ไม่อนุญาตให้แก้ไขคลังตายตัวของระบบ' });
});

app.delete('/api/warehouses/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  res.status(403).json({ error: 'ไม่อนุญาตให้ลบคลังตายตัวของระบบ' });
});

// ── Spare Parts ───────────────────────────────────────────────────────────────

app.get('/api/spare-parts', authenticate, async (_req: AuthRequest, res: Response) => {
  await syncAllSparePartTrackedStock();
  const parts = await prisma.sparePart.findMany({ orderBy: { name: 'asc' }, include: { warehouse: { select: { id: true, name: true } } } });
  res.json(parts);
});

app.get('/api/spare-parts/:id/items', authenticate, async (req: AuthRequest, res: Response) => {
  const part = await prisma.sparePart.findUnique({ where: { id: req.params.id }, select: { id: true, name: true, stock: true } });
  if (!part) { res.status(404).json({ error: 'Not found' }); return; }
  const items = await (prisma as any).sparePartItem.findMany({
    where: { sparePartId: req.params.id },
    orderBy: [{ receivedDate: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ part, items, trackedCount: items.length });
});

app.post('/api/spare-parts/:id/items', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const part = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
  if (!part) { res.status(404).json({ error: 'ไม่พบอะไหล่' }); return; }
  const serialNumber = String(req.body?.serialNumber ?? '').trim();
  const receivedDate = normalizePlainDate(req.body?.receivedDate);
  const warehouseAssignment = await resolveWarehouseAssignment(req.body?.warehouseId);
  if (!serialNumber) { res.status(400).json({ error: 'กรุณากรอก SN' }); return; }
  if (!receivedDate) { res.status(400).json({ error: 'กรุณากรอกวันที่นำของเข้า' }); return; }
  if (!warehouseAssignment.warehouseId || !warehouseAssignment.warehouseName) {
    res.status(400).json({ error: 'กรุณาเลือกคลังสำหรับการรับอะไหล่เข้า' });
    return;
  }

  const existing = await (prisma as any).sparePartItem.findUnique({
    where: { sparePartId_serialNumber: { sparePartId: req.params.id, serialNumber } },
  });
  await prisma.sparePart.update({
    where: { id: req.params.id },
    data: {
      warehouseId: warehouseAssignment.warehouseId,
      location: warehouseAssignment.warehouseName,
    },
  });
  const item = existing
    ? await (prisma as any).sparePartItem.update({ where: { id: existing.id }, data: { receivedDate } })
    : await (prisma as any).sparePartItem.create({ data: { sparePartId: req.params.id, serialNumber, receivedDate } });
  const stock = await syncSparePartTrackedStock(req.params.id);
  await logActivity({
    entityType: 'SparePart',
    entityId: part.id,
    entityName: part.name,
    action: existing ? 'item_updated' : 'item_created',
    newValues: { serialNumber, receivedDate, stock, warehouseId: warehouseAssignment.warehouseId, warehouseName: warehouseAssignment.warehouseName },
    performedBy: req.user?.username,
  });
  res.status(existing ? 200 : 201).json({ item, stock });
});

app.post('/api/spare-parts/scan-out', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const serialNumber = String(req.body?.serialNumber ?? '').trim();
  const details = String(req.body?.details ?? req.body?.note ?? req.body?.description ?? req.body?.reason ?? '').trim();
  if (!serialNumber) { res.status(400).json({ error: 'กรุณากรอก SN' }); return; }

  const matches = await (prisma as any).sparePartItem.findMany({
    where: { serialNumber },
    include: { sparePart: true },
  });

  if (matches.length === 0) { res.status(404).json({ error: 'ไม่พบ SN นี้ในคลังอะไหล่' }); return; }
  if (matches.length > 1) { res.status(409).json({ error: 'พบ SN นี้มากกว่า 1 SKU กรุณาตรวจสอบข้อมูลก่อนนำออก' }); return; }

  const item = matches[0];
  const part = item.sparePart;
  await (prisma as any).sparePartItem.delete({ where: { id: item.id } });
  const stock = await syncSparePartTrackedStock(part.id);
  const updatedPart = await prisma.sparePart.findUnique({ where: { id: part.id } });

  await logActivity({
    entityType: 'SparePart',
    entityId: part.id,
    entityName: part.name,
    action: 'item_scanned_out',
    oldValues: { serialNumber: item.serialNumber, receivedDate: item.receivedDate, stock: part.stock },
    newValues: details ? { stock, details } : { stock },
    performedBy: req.user?.username,
  });

  res.json({
    success: true,
    part: updatedPart,
    item: { id: item.id, serialNumber: item.serialNumber, receivedDate: item.receivedDate, sparePartId: item.sparePartId },
    stock,
  });
});

app.put('/api/spare-parts/:id/items/:itemId', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const part = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
  if (!part) { res.status(404).json({ error: 'ไม่พบอะไหล่' }); return; }
  const existing = await (prisma as any).sparePartItem.findUnique({ where: { id: req.params.itemId } });
  if (!existing || existing.sparePartId !== req.params.id) { res.status(404).json({ error: 'ไม่พบรายการ SN' }); return; }
  const serialNumber = String(req.body?.serialNumber ?? existing.serialNumber).trim();
  const receivedDate = normalizePlainDate(req.body?.receivedDate) ?? existing.receivedDate;
  if (!serialNumber) { res.status(400).json({ error: 'กรุณากรอก SN' }); return; }

  const duplicate = await (prisma as any).sparePartItem.findUnique({
    where: { sparePartId_serialNumber: { sparePartId: req.params.id, serialNumber } },
  });
  if (duplicate && duplicate.id !== req.params.itemId) { res.status(409).json({ error: 'SN นี้มีอยู่แล้วใน SKU นี้' }); return; }

  const item = await (prisma as any).sparePartItem.update({
    where: { id: req.params.itemId },
    data: { serialNumber, receivedDate },
  });
  const stock = await syncSparePartTrackedStock(req.params.id);
  await logActivity({
    entityType: 'SparePart',
    entityId: part.id,
    entityName: part.name,
    action: 'item_updated',
    oldValues: { serialNumber: existing.serialNumber, receivedDate: existing.receivedDate },
    newValues: { serialNumber, receivedDate, stock },
    performedBy: req.user?.username,
  });
  res.json({ item, stock });
});

app.delete('/api/spare-parts/:id/items/:itemId', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const part = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
  if (!part) { res.status(404).json({ error: 'ไม่พบอะไหล่' }); return; }
  const existing = await (prisma as any).sparePartItem.findUnique({ where: { id: req.params.itemId } });
  if (!existing || existing.sparePartId !== req.params.id) { res.status(404).json({ error: 'ไม่พบรายการ SN' }); return; }
  await (prisma as any).sparePartItem.delete({ where: { id: req.params.itemId } });
  const stock = await syncSparePartTrackedStock(req.params.id);
  await logActivity({
    entityType: 'SparePart',
    entityId: part.id,
    entityName: part.name,
    action: 'item_deleted',
    oldValues: { serialNumber: existing.serialNumber, receivedDate: existing.receivedDate },
    newValues: { stock },
    performedBy: req.user?.username,
  });
  res.json({ success: true, stock });
});

app.post('/api/spare-parts', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, SPARE_PART_FIELDS);
  if (!data.sku || !data.name) { res.status(400).json({ error: 'sku and name are required' }); return; }
  const warehouseAssignment = await resolveWarehouseAssignment(data.warehouseId);
  const part = await prisma.sparePart.create({ data: { ...(data as any), warehouseId: warehouseAssignment.warehouseId, location: warehouseAssignment.warehouseName ?? (data.location ?? null), stock: 0 } });
  await syncSparePartTrackedStock(part.id);
  await logActivity({
    entityType: 'SparePart', entityId: part.id, entityName: part.name,
    action: 'created', performedBy: req.user?.username,
  });
  res.status(201).json(await prisma.sparePart.findUnique({ where: { id: part.id } }));
});

app.put('/api/spare-parts/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const data = pickFields(req.body, SPARE_PART_FIELDS);
  const old = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
  const warehouseUpdate: Record<string, string | null> = {};
  if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'warehouseId')) {
    const warehouseAssignment = await resolveWarehouseAssignment(data.warehouseId);
    warehouseUpdate.warehouseId = warehouseAssignment.warehouseId;
    warehouseUpdate.location = warehouseAssignment.warehouseId ? warehouseAssignment.warehouseName : (data.location ?? null);
  }
  const part = await prisma.sparePart.update({
    where: { id: req.params.id },
    data: {
      ...(data as any),
      ...warehouseUpdate,
    } as any,
  });
  await syncSparePartTrackedStock(req.params.id);
  const refreshed = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
  // Notify on low/out-of-stock when stock changes
  if (old && refreshed && refreshed.minStock > 0 && refreshed.stock <= refreshed.minStock && old.stock > refreshed.minStock) {
    const type = refreshed.stock <= 0 ? 'low_stock' : 'low_stock';
    const title = refreshed.stock <= 0 ? `อะไหล่หมดสต๊อก: ${refreshed.name}` : `อะไหล่สต๊อกต่ำ: ${refreshed.name}`;
    await createNotification(type, title, `${refreshed.name} (${refreshed.sku}) เหลือ ${refreshed.stock} ชิ้น (ต่ำกว่า min ${refreshed.minStock})`, 'SparePart', refreshed.id);
  }
  await logActivity({
    entityType: 'SparePart', entityId: part.id, entityName: part.name,
    action: 'updated', performedBy: req.user?.username,
  });
  res.json(refreshed);
});

app.delete('/api/spare-parts/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const part = await prisma.sparePart.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!part) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).trashItem.create({ data: {
    entityType: 'SparePart',
    entityId: part.id,
    entityName: part.name,
    entityData: JSON.stringify(part), deletedBy: req.user?.username,
  }});
  await prisma.sparePart.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'SparePart', entityId: req.params.id, entityName: part.name,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

app.post('/api/spare-parts/bulk-delete', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id: unknown): id is string => typeof id === 'string' && id.trim().length > 0) : [];
  if (ids.length === 0) { res.status(400).json({ error: 'ids are required' }); return; }

  const parts = await prisma.sparePart.findMany({ where: { id: { in: ids } }, include: { items: true } });
  if (parts.length === 0) { res.status(404).json({ error: 'No spare parts found' }); return; }

  for (const part of parts) {
    await (prisma as any).trashItem.create({ data: {
      entityType: 'SparePart',
      entityId: part.id,
      entityName: part.name,
      entityData: JSON.stringify(part),
      deletedBy: req.user?.username,
    }});
  }

  await prisma.sparePart.deleteMany({ where: { id: { in: parts.map(part => part.id) } } });

  for (const part of parts) {
    await logActivity({
      entityType: 'SparePart',
      entityId: part.id,
      entityName: part.name,
      action: 'deleted',
      performedBy: req.user?.username,
    });
  }

  res.json({ success: true, deleted: parts.length });
});

// Transfer spare parts directly to a customer (no delivery note required)
app.post('/api/spare-parts/:id/transfer', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { customerId, quantity, note } = req.body;
  const qty = parseInt(quantity) || 0;
  if (qty <= 0) { res.status(400).json({ error: 'จำนวนต้องมากกว่า 0' }); return; }
  const part = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
  if (!part) { res.status(404).json({ error: 'ไม่พบอะไหล่' }); return; }
  if (part.stock < qty) { res.status(400).json({ error: `สต๊อกไม่พอ (คงเหลือ ${part.stock})` }); return; }
  const customer = customerId ? await prisma.customer.findUnique({ where: { id: customerId } }) : null;
  const trackedCount = await (prisma as any).sparePartItem.count({ where: { sparePartId: req.params.id } });
  let updated;
  if (trackedCount > 0) {
    if (trackedCount < qty) { res.status(400).json({ error: `SN ที่ติดตามไว้มีเพียง ${trackedCount} ชิ้น` }); return; }
    await consumeTrackedSparePartItems(req.params.id, qty);
    updated = await prisma.sparePart.findUnique({ where: { id: req.params.id } });
  } else {
    updated = await prisma.sparePart.update({
      where: { id: req.params.id },
      data: { stock: { decrement: qty } },
    });
  }
  await logActivity({
    entityType: 'SparePart', entityId: part.id, entityName: part.name,
    action: 'transferred',
    oldValues: { stock: part.stock },
    newValues: { stock: updated?.stock, transferredQty: qty, customerId: customerId ?? null, customerName: customer?.name ?? null, note: note ?? null },
    performedBy: req.user?.username,
  });
  if (updated && updated.minStock > 0 && updated.stock <= updated.minStock && part.stock > updated.minStock) {
    const title = updated.stock <= 0 ? `อะไหล่หมดสต๊อก: ${updated.name}` : `อะไหล่สต๊อกต่ำ: ${updated.name}`;
    await createNotification('low_stock', title, `${updated.name} (${updated.sku}) เหลือ ${updated.stock} ชิ้น`, 'SparePart', updated.id);
  }
  res.json({ part: updated, transferred: qty, customerName: customer?.name ?? null });
});

app.post('/api/spare-parts/bulk', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const items: any[] = req.body.items || [];
  let created = 0, updated = 0;
  for (const item of items) {
    const existing = await prisma.sparePart.findUnique({ where: { sku: item.sku } });
    if (existing) {
      await prisma.sparePart.update({ where: { sku: item.sku }, data: item });
      updated++;
    } else {
      await prisma.sparePart.create({ data: item });
      created++;
    }
  }
  res.json({ created, updated, total: items.length });
});

app.post('/api/spare-parts/import', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });
    if (!rawRows.length) { res.status(400).json({ error: 'ไฟล์ไม่มีข้อมูล' }); return; }

    const findHeaderRowIndex = (matrix: any[][]) => {
      const normalize = (value: unknown) => String(value ?? '').trim().toLowerCase();
      for (let i = 0; i < Math.min(matrix.length, 10); i++) {
        const headers = (matrix[i] ?? []).map(normalize);
        const hasSku = headers.includes('sku');
        const hasName = headers.includes('product name') || headers.includes('name') || headers.includes('part name');
        if (hasSku && hasName) return i;
      }
      return -1;
    };

    const headerRowIndex = findHeaderRowIndex(rawRows);
    if (headerRowIndex < 0) {
      res.status(400).json({ error: 'ไม่พบหัวตารางที่มีคอลัมน์ SKU และ Product Name' });
      return;
    }

    const rows: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '', range: headerRowIndex, raw: true });
    if (!rows.length) { res.status(400).json({ error: 'ไฟล์ไม่มีข้อมูลหลังหัวตาราง' }); return; }

    const pick = (row: Record<string, any>, keys: string[]) => {
      for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return String(value).trim();
      }
      return '';
    };
    const pickValue = (row: Record<string, any>, keys: string[]) => {
      for (const key of keys) {
        const value = row[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') return value;
      }
      return null;
    };
    const toInt = (value: unknown) => {
      const num = Number(String(value ?? '').replace(/,/g, '').trim());
      return Number.isFinite(num) ? Math.max(0, Math.trunc(num)) : 0;
    };
    const toFloat = (value: unknown) => {
      const num = Number(String(value ?? '').replace(/,/g, '').trim());
      return Number.isFinite(num) ? Math.max(0, num) : 0;
    };

    const skuKeys = ['SKU', 'P/N'];
    const nameKeys = ['Product Name', 'Name'];
    const descKeys = ['Description', 'Features/Operating Conditions'];
    const categoryKeys = ['Product Model'];
    const dateKeys = ['Date'];
    const serialKeys = ['SN'];

    const importWarehouseIdRaw = String(req.body?.warehouseId ?? '').trim();
    if (!importWarehouseIdRaw) {
      res.status(400).json({ error: 'กรุณาเลือกคลังสำหรับการนำเข้าอะไหล่' });
      return;
    }
    const importWarehouse = await prisma.warehouse.findUnique({ where: { id: importWarehouseIdRaw }, select: { id: true, name: true } });
    if (!importWarehouse || !FIXED_WAREHOUSE_NAMES.includes(importWarehouse.name as typeof FIXED_WAREHOUSE_NAMES[number])) {
      res.status(400).json({ error: 'กรุณาเลือกคลังที่รองรับ' });
      return;
    }

    let created = 0, updated = 0, skipped = 0;
    let itemCreated = 0, itemUpdated = 0;
    const errors: string[] = [];
    const touchedPartIds = new Set<string>();
    const seenSku = new Set<string>();

    for (let index = 0; index < rows.length; index++) {
      const row = rows[index] as Record<string, any>;
      const rowNo = headerRowIndex + index + 2;
      const sku = pick(row, skuKeys);
      const name = pick(row, nameKeys);
      const serialNumber = pick(row, serialKeys);
      const receivedDate = normalizeExcelDate(pickValue(row, dateKeys), XLSX);
      if (!sku || !name) {
        skipped++;
        errors.push(`Row ${rowNo}: missing SKU or name`);
        continue;
      }
      if (serialNumber && !receivedDate) {
        skipped++;
        errors.push(`Row ${rowNo} (${sku}): missing or invalid Date for SN ${serialNumber}`);
        continue;
      }

      const payload = {
        sku,
        name,
        description: pick(row, descKeys) || null,
        category: pick(row, categoryKeys) || null,
        productModel: pick(row, categoryKeys) || null,
        partType: null,
        location: importWarehouse.name,
        warehouseId: importWarehouse.id,
        stock: 0,
        minStock: 0,
        unitPrice: 0,
        supplier: null,
        status: null,
        sourceFile: null,
        sourceSheet: null,
      };

      try {
        const existing = await prisma.sparePart.findUnique({ where: { sku } });
        let part;
        if (existing) {
          part = await prisma.sparePart.update({ where: { sku }, data: payload });
          if (!seenSku.has(sku)) updated++;
        } else {
          part = await prisma.sparePart.create({ data: payload });
          if (!seenSku.has(sku)) created++;
        }
        seenSku.add(sku);

        touchedPartIds.add(part.id);

        if (serialNumber && receivedDate) {
          const existingItem = await (prisma as any).sparePartItem.findUnique({
            where: { sparePartId_serialNumber: { sparePartId: part.id, serialNumber } },
          });
          if (existingItem) {
            await (prisma as any).sparePartItem.update({ where: { id: existingItem.id }, data: { receivedDate } });
            itemUpdated++;
          } else {
            await (prisma as any).sparePartItem.create({ data: { sparePartId: part.id, serialNumber, receivedDate } });
            itemCreated++;
          }
        }
      } catch (err: any) {
        skipped++;
        errors.push(`Row ${rowNo} (${sku}): ${err?.message || 'import failed'}`);
      }
    }

    for (const partId of touchedPartIds) {
      await syncSparePartTrackedStock(partId);
    }

    await logActivity({
      entityType: 'SparePart',
      entityId: 'import-xlsx',
      entityName: 'Spare Parts Import',
      action: 'imported',
      performedBy: req.user?.username,
      newValues: { created, updated, skipped, total: rows.length, itemCreated, itemUpdated, errors: errors.slice(0, 20) },
    });

    res.json({ created, updated, skipped, total: rows.length, errors, itemCreated, itemUpdated });
  } catch (err: any) {
    console.error('[spare-parts/import] Error:', err);
    res.status(500).json({ error: err?.message || 'Import failed' });
  }
});

// ── File upload ───────────────────────────────────────────────────────────────

app.post('/api/upload', authenticate, uploadLimiter, upload.single('image'), (req: AuthRequest, res: Response): void => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  res.json({ url: `/uploads/${req.file.filename}` });
});

// ── Attachments ───────────────────────────────────────────────────────────────

// Newest image attachment of every record of one type — lets a list show thumbnails without one request per row.
// Registered before the /:elementType/:elementId route so "photos" is not read as an elementType.
app.get('/api/attachments/photos/:elementType', authenticate, async (req: AuthRequest, res: Response) => {
  const rows = await prisma.attachment.findMany({
    where: { elementType: { in: getAttachmentEntityTypeAliases(req.params.elementType) } },
    orderBy: { uploadedAt: 'desc' },
  });
  const seen = new Set<string>();
  const photos: { elementId: string; id: string; url: string }[] = [];
  for (const a of rows) {
    const isImage = (a.mimeType ?? '').startsWith('image/') || /\.(jpe?g|png|gif|webp|heic|heif|bmp)$/i.test(a.originalName);
    if (!isImage || seen.has(a.elementId)) continue;
    seen.add(a.elementId);
    photos.push({ elementId: a.elementId, id: a.id, url: `/api/attachments/file/${a.id}` });
  }
  res.json(photos);
});

app.get('/api/attachments/:elementType/:elementId', authenticate, async (req: AuthRequest, res: Response) => {
  const elementType = normalizeAttachmentEntityType(req.params.elementType);
  const { elementId } = req.params;
  if (!(await ensureEntityExists(res, elementType, elementId))) return;
  const attachments = await prisma.attachment.findMany({
    where: { elementType: { in: getAttachmentEntityTypeAliases(elementType) }, elementId },
    orderBy: { uploadedAt: 'desc' },
  });
  res.json(attachments.map(a => ({
    id: a.id,
    attachmentType: a.attachmentType,
    originalName: a.originalName,
    fileSize: a.fileSize,
    mimeType: a.mimeType,
    uploadedBy: a.uploadedBy,
    uploadedAt: a.uploadedAt,
    url: `/api/attachments/file/${a.id}`,
  })));
});

app.post('/api/attachments', authenticate, uploadLimiter, upload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: 'No file uploaded' });
    return;
  }
  const elementType = normalizeAttachmentEntityType(String(req.body.elementType || ''));
  const elementId = String(req.body.elementId || '');
  const attachmentType = req.body.attachmentType;
  if (!(await ensureEntityExists(res, elementType, elementId))) return;
  const attachment = await prisma.attachment.create({
    data: {
      elementType,
      elementId,
      attachmentType: attachmentType || 'other',
      filename: req.file.filename,
      originalName: req.file.originalname,
      fileSize: req.file.size,
      mimeType: req.file.mimetype,
      uploadedBy: req.user?.username,
    },
  });
  await logActivity({
    entityType: elementType,
    entityId: elementId,
    action: 'attachment_added',
    newValues: { filename: req.file.originalname, attachmentType: attachmentType || 'other' },
    performedBy: req.user?.username,
  });
  res.status(201).json({
    id: attachment.id,
    attachmentType: attachment.attachmentType,
    originalName: attachment.originalName,
    fileSize: attachment.fileSize,
    mimeType: attachment.mimeType,
    uploadedBy: attachment.uploadedBy,
    uploadedAt: attachment.uploadedAt,
    url: `/api/attachments/file/${attachment.id}`,
  });
});

app.get('/api/attachments/file/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
  if (!attachment) {
    res.status(404).json({ error: 'Attachment not found' });
    return;
  }
  const filePath = getUploadFilePath(attachment.filename);
  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: 'File not found' });
    return;
  }
  res.setHeader('Content-Type', attachment.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(attachment.originalName)}"`);
  res.sendFile(filePath);
});

app.delete('/api/attachments/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const attachment = await prisma.attachment.findUnique({ where: { id: req.params.id } });
  if (attachment) {
    const canDelete = req.user?.role === 'ADMIN' || attachment.uploadedBy === req.user?.username;
    if (!canDelete) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }
    const filePath = getUploadFilePath(attachment.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    await prisma.attachment.delete({ where: { id: req.params.id } });
  }
  res.json({ success: true });
});

// ── Activity Logs ─────────────────────────────────────────────────────────────

// Part transfer history for a specific customer
app.get('/api/customers/:id/part-transfers', authenticate, async (req: AuthRequest, res: Response) => {
  const customerId = req.params.id;
  const logs = await prisma.activityLog.findMany({
    where: { entityType: 'SparePart', action: 'transferred' },
    orderBy: { performedAt: 'desc' },
    take: 1000,
  });
  const filtered = logs.filter(l => {
    try { return JSON.parse(l.newValues || '{}').customerId === customerId; }
    catch { return false; }
  });
  res.json(filtered);
});

// Every spare part that left stock via "transfer to customer" or "scan out", flattened from the activity log.
// Entries with a customerId are parts held by that customer; the rest are plain take-outs with details.
app.get('/api/customer-parts', authenticate, async (_req: AuthRequest, res: Response) => {
  const logs = await prisma.activityLog.findMany({
    where: { entityType: 'SparePart', action: { in: ['transferred', 'item_scanned_out'] } },
    orderBy: { performedAt: 'desc' },
    take: 5000,
  });
  const [parts, customers] = await Promise.all([
    prisma.sparePart.findMany({ select: { id: true, sku: true, name: true } }),
    prisma.customer.findMany({ select: { id: true, name: true } }),
  ]);
  const partById = new Map(parts.map(part => [part.id, part]));
  const customerNameById = new Map(customers.map(customer => [customer.id, customer.name]));
  const parse = (value: string | null): Record<string, any> => {
    if (!value) return {};
    try { return JSON.parse(value) ?? {}; } catch { return {}; }
  };

  res.json(logs.map(log => {
    const oldValues = parse(log.oldValues);
    const newValues = parse(log.newValues);
    const isTransfer = log.action === 'transferred';
    const serialNumbers: string[] = isTransfer
      ? (Array.isArray(newValues.serialNumbers) ? newValues.serialNumbers : [])
      : (oldValues.serialNumber ? [String(oldValues.serialNumber)] : []);
    const customerId: string | null = newValues.customerId || null;
    const part = partById.get(log.entityId);
    return {
      id: log.id,
      action: log.action,
      performedAt: log.performedAt,
      performedBy: log.performedBy,
      partId: log.entityId,
      sku: part?.sku ?? null,
      partName: part?.name ?? log.entityName ?? '-',
      quantity: isTransfer ? (Number(newValues.transferredQty) || serialNumbers.length) : 1,
      serialNumbers,
      customerId,
      customerName: (customerId && customerNameById.get(customerId)) || newValues.customerName || null,
      robotSerialNumber: newValues.robotSerialNumber || null,
      note: (isTransfer ? newValues.note : newValues.details) || null,
    };
  }));
});

app.get('/api/logs', authenticate, async (req: AuthRequest, res: Response) => {
  const { entityType, entityId } = req.query;
  const isAdmin = req.user?.role === 'ADMIN';
  const entityTypeValue = entityType ? String(entityType) : '';
  const entityIdValue = entityId ? String(entityId) : '';
  if (!isAdmin && (!entityIdValue || !entityTypeValue)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  const where: { entityType?: string; entityId?: string } = {};
  if (entityTypeValue) where.entityType = entityTypeValue;
  if (entityIdValue) where.entityId = entityIdValue;
  if (entityTypeValue && entityIdValue && !(await ensureEntityExists(res, entityTypeValue, entityIdValue))) return;
  const logs = await prisma.activityLog.findMany({
    where,
    orderBy: { performedAt: 'desc' },
    take: entityId ? 100 : 500,
  });
  res.json(logs);
});

// ── Unified Timeline ──────────────────────────────────────────────────────────
app.get('/api/timeline/:entityType/:entityId', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const entityType = normalizeAttachmentEntityType(req.params.entityType as string);
  const entityId = req.params.entityId as string;

  interface TimelineEntry { type: string; date: string; action: string; user: string | null; details: any; oldValues: any; }

  // Gather activity logs
  const logs = await prisma.activityLog.findMany({
    where: { entityType: entityType as any, entityId: entityId as any },
    orderBy: { performedAt: 'desc' },
    take: 100,
  });
  // Gather attachments
  const attachments = await prisma.attachment.findMany({
    where: { elementType: { in: getAttachmentEntityTypeAliases(entityType) } as any, elementId: entityId as any },
    orderBy: { uploadedAt: 'desc' },
  });
  // Merge into unified timeline
  const timeline: TimelineEntry[] = [
    ...logs.map(l => ({
      type: 'activity',
      date: l.performedAt.toISOString(),
      action: l.action,
      user: l.performedBy,
      details: l.newValues ? JSON.parse(l.newValues) : null,
      oldValues: l.oldValues ? JSON.parse(l.oldValues) : null,
    })),
    ...attachments.map(a => ({
      type: 'attachment',
      date: a.uploadedAt.toISOString(),
      action: 'attachment_added',
      user: a.uploadedBy,
      details: { filename: a.originalName, attachmentType: a.attachmentType, id: a.id },
      oldValues: null,
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  // For Robot/Customer, also gather related entity events
  let relatedEvents: TimelineEntry[] = [];
  if (entityType === 'Robot') {
    const tickets = await prisma.maintenanceTicket.findMany({ where: { robotId: entityId as any }, select: { id: true } });
    const ticketIds = tickets.map(t => t.id);
    const ticketLogs = ticketIds.length > 0 ? await prisma.activityLog.findMany({
      where: { entityType: 'MaintenanceTicket', entityId: { in: ticketIds } },
      orderBy: { performedAt: 'desc' },
      take: 200,
    }) : [];
    relatedEvents = ticketLogs
      .map(l => ({
        type: 'related',
        date: l.performedAt.toISOString(),
        action: `ticket.${l.action}`,
        user: l.performedBy,
        details: l.newValues ? JSON.parse(l.newValues) : null,
        oldValues: l.oldValues ? JSON.parse(l.oldValues) : null,
      }));
  }
  if (entityType === 'Customer') {
    const dns = await prisma.deliveryNote.findMany({ where: { customerId: entityId as any }, select: { id: true } });
    const dnIds = dns.map(d => d.id);
    const dnLogs = dnIds.length > 0 ? await prisma.activityLog.findMany({
      where: { entityType: 'DeliveryNote', entityId: { in: dnIds } },
      orderBy: { performedAt: 'desc' },
      take: 200,
    }) : [];
    relatedEvents = dnLogs
      .map(l => ({
        type: 'related',
        date: l.performedAt.toISOString(),
        action: `delivery.${l.action}`,
        user: l.performedBy,
        details: l.newValues ? JSON.parse(l.newValues) : null,
        oldValues: l.oldValues ? JSON.parse(l.oldValues) : null,
      }));
  }

  const fullTimeline = [...timeline, ...relatedEvents]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 200);

  res.json(fullTimeline);
});

// ── Monthly Stats ─────────────────────────────────────────────────────────────

app.get('/api/stats/monthly', authenticate, async (_req: AuthRequest, res: Response) => {
  // Build last 12 months
  const now = new Date();
  const months: { year: number; month: number; label: string; start: Date; end: Date }[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const end = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() + 1, label: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, start: d, end });
  }

  const results = await Promise.all(months.map(async m => {
    const [deliveries, tickets, parts] = await Promise.all([
      prisma.deliveryNote.count({ where: { createdAt: { gte: m.start, lt: m.end } } }),
      prisma.maintenanceTicket.count({ where: { reportDate: { gte: m.start.toISOString().split('T')[0], lt: m.end.toISOString().split('T')[0] } } }),
      prisma.usedPart.findMany({ where: { ticket: { reportDate: { gte: m.start.toISOString().split('T')[0], lt: m.end.toISOString().split('T')[0] } } }, include: { sparePart: true } }),
    ]);
    const partsUsed = parts.reduce((s, p) => s + p.quantity, 0);
    const partsCost = parts.reduce((s, p) => s + p.quantity * ((p.sparePart as any)?.unitPrice ?? 0), 0);
    return { label: m.label, deliveries, tickets, partsUsed, partsCost };
  }));

  res.json(results);
});

app.get('/api/stats/dashboard-trends', authenticate, async (_req: AuthRequest, res: Response) => {
  const dayCount = 30;
  const todayLocal = new Date();
  todayLocal.setHours(0, 0, 0, 0);
  const start = new Date(todayLocal);
  start.setDate(start.getDate() - (dayCount - 1));
  const startKey = start.toISOString().slice(0, 10);

  const series = Array.from({ length: dayCount }, (_, index) => {
    const d = new Date(start);
    d.setDate(start.getDate() + index);
    const key = d.toISOString().slice(0, 10);
    return {
      date: key,
      label: `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`,
      tickets: 0,
      purchaseOrders: 0,
      stockAlerts: 0,
    };
  });
  const byDate = new Map(series.map(item => [item.date, item]));

  const [ticketRows, purchaseOrderRows, stockAlertRows] = await Promise.all([
    prisma.maintenanceTicket.findMany({
      where: { reportDate: { gte: startKey } },
      select: { reportDate: true },
    }),
    prisma.purchaseOrder.findMany({
      where: { orderDate: { gte: startKey } },
      select: { orderDate: true },
    }),
    (prisma as any).notification.findMany({
      where: { type: 'low_stock', createdAt: { gte: start } },
      select: { createdAt: true },
    }),
  ]);

  for (const row of ticketRows) {
    const bucket = byDate.get(row.reportDate);
    if (bucket) bucket.tickets += 1;
  }
  for (const row of purchaseOrderRows) {
    const bucket = byDate.get(row.orderDate);
    if (bucket) bucket.purchaseOrders += 1;
  }
  for (const row of stockAlertRows) {
    const key = new Date(row.createdAt).toISOString().slice(0, 10);
    const bucket = byDate.get(key);
    if (bucket) bucket.stockAlerts += 1;
  }

  res.json(series);
});

// ── Notifications ─────────────────────────────────────────────────────────────

async function createNotification(type: string, title: string, body?: string, entityType?: string, entityId?: string) {
  try {
    await (prisma as any).notification.create({ data: { type, title, body, entityType, entityId } });
  } catch { /* non-critical */ }
}

app.get('/api/notifications', authenticate, async (_req: AuthRequest, res: Response) => {
  const notes = await (prisma as any).notification.findMany({
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  res.json(notes);
});

app.patch('/api/notifications/:id/read', authenticate, async (req: AuthRequest, res: Response) => {
  await (prisma as any).notification.update({ where: { id: req.params.id }, data: { read: true } });
  res.json({ success: true });
});

app.patch('/api/notifications/read-all', authenticate, async (_req: AuthRequest, res: Response) => {
  await (prisma as any).notification.updateMany({ where: { read: false }, data: { read: true } });
  res.json({ success: true });
});

app.delete('/api/notifications/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  await (prisma as any).notification.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── Delivery Notes ────────────────────────────────────────────────────────────

app.get('/api/delivery-notes', authenticate, async (_req: AuthRequest, res: Response) => {
  const notes = await prisma.deliveryNote.findMany({
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, name: true } }, items: true },
  });
  res.json(notes);
});

app.get('/api/delivery-notes/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const note = await prisma.deliveryNote.findUnique({
    where: { id: req.params.id },
    include: { customer: true, items: true },
  });
  if (!note) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(note);
});

function parseSerialList(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((v: unknown): v is string => typeof v === 'string') : [];
    } catch { return []; }
  }
  return [];
}

// Spare-part lines picked by serial number must reference SNs that are in stock (or already on this note).
async function validateDeliveryPartSerials(items: any[], noteId?: string): Promise<string | null> {
  const oldSerialsByPart = new Map<string, Set<string>>();
  if (noteId) {
    const oldItems = await prisma.deliveryNoteItem.findMany({ where: { deliveryNoteId: noteId } });
    for (const old of oldItems as any[]) {
      if (!old.sparePartId) continue;
      const set = oldSerialsByPart.get(old.sparePartId) ?? new Set<string>();
      parseSerialList(old.serialNumbers).forEach(sn => set.add(sn));
      oldSerialsByPart.set(old.sparePartId, set);
    }
  }
  for (const item of items || []) {
    const serials = item.sparePartId ? parseSerialList(item.serialNumbers) : [];
    if (serials.length === 0) continue;
    if (new Set(serials).size !== serials.length) return 'พบ SN ซ้ำในรายการอะไหล่';
    const rows = await (prisma as any).sparePartItem.findMany({ where: { sparePartId: item.sparePartId }, select: { serialNumber: true } });
    const inStock = new Set<string>(rows.map((r: { serialNumber: string }) => r.serialNumber));
    const missing = serials.filter(sn => !inStock.has(sn) && !oldSerialsByPart.get(item.sparePartId)?.has(sn));
    if (missing.length) return `SN ไม่อยู่ในสต๊อก: ${missing.join(', ')}`;
  }
  return null;
}

// Stock leaves a part by the picked SNs, else by its oldest tracked SNs, else by plain quantity.
async function consumeDeliveryPartStock(partId: string, quantity: number, serials: string[]) {
  const trackedCount = await (prisma as any).sparePartItem.count({ where: { sparePartId: partId } });
  if (trackedCount === 0) {
    await prisma.sparePart.update({ where: { id: partId }, data: { stock: { decrement: quantity } } });
    return;
  }
  if (serials.length > 0) {
    await (prisma as any).sparePartItem.deleteMany({ where: { sparePartId: partId, serialNumber: { in: serials } } });
    await syncSparePartTrackedStock(partId);
    return;
  }
  if (trackedCount < quantity) throw new Error(`Tracked SN for spare part ${partId} has only ${trackedCount} items`);
  await consumeTrackedSparePartItems(partId, quantity);
}

async function returnDeliveryPartStock(item: { sparePartId: string | null; quantity: number; serialNumbers: string }) {
  if (!item.sparePartId) return;
  const part = await prisma.sparePart.findUnique({ where: { id: item.sparePartId } });
  if (!part) return;
  const serials = parseSerialList(item.serialNumbers);
  if (serials.length === 0) {
    await prisma.sparePart.update({ where: { id: part.id }, data: { stock: { increment: item.quantity } } });
    return;
  }
  // Put the picked serial numbers back into stock (their original received date is not kept).
  const rows = await (prisma as any).sparePartItem.findMany({ where: { sparePartId: part.id }, select: { serialNumber: true } });
  const existing = new Set<string>(rows.map((r: { serialNumber: string }) => r.serialNumber));
  const today = new Date().toISOString().slice(0, 10);
  for (const serialNumber of serials.filter(sn => !existing.has(sn))) {
    await (prisma as any).sparePartItem.create({
      data: { sparePartId: part.id, serialNumber, receivedDate: today, warehouseId: (part as any).warehouseId ?? null, notes: 'คืนจากใบส่งของ' },
    });
  }
  await syncSparePartTrackedStock(part.id);
}

app.post('/api/delivery-notes', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...noteData } = req.body;
  if (!noteData.docNumber || !noteData.customerId || !noteData.deliveryDate) {
    res.status(400).json({ error: 'docNumber, customerId, and deliveryDate are required' });
    return;
  }
  const serialError = await validateDeliveryPartSerials(items);
  if (serialError) { res.status(400).json({ error: serialError }); return; }
  const note = await prisma.deliveryNote.create({
    data: {
      ...noteData,
      createdBy: req.user?.username,
      items: {
        create: (items || []).map((item: any) => {
          const serials = item.sparePartId ? parseSerialList(item.serialNumbers) : [];
          return {
            description: item.description,
            quantity: serials.length > 0 ? serials.length : Number(item.quantity),
            remark: item.remark || null,
            serialNumbers: Array.isArray(item.serialNumbers)
              ? JSON.stringify(item.serialNumbers)
              : item.serialNumbers || '[]',
            sparePartId: item.sparePartId || null,
          };
        }),
      },
    },
    include: { customer: true, items: true },
  });
  // Deduct stock for spare part items
  for (const item of (items || [])) {
    if (item.sparePartId) {
      const serials = parseSerialList(item.serialNumbers);
      await consumeDeliveryPartStock(item.sparePartId, serials.length > 0 ? serials.length : Number(item.quantity), serials);
    }
  }
  await logActivity({
    entityType: 'DeliveryNote', entityId: note.id, entityName: note.docNumber,
    action: 'created', newValues: { docNumber: note.docNumber, customerId: note.customerId },
    performedBy: req.user?.username,
  });
  res.status(201).json(note);
});

app.put('/api/delivery-notes/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { items, ...noteData } = req.body;
  const serialError = await validateDeliveryPartSerials(items, req.params.id);
  if (serialError) { res.status(400).json({ error: serialError }); return; }
  // Restore stock for old spare part items before replacing
  const oldItems = await prisma.deliveryNoteItem.findMany({ where: { deliveryNoteId: req.params.id } });
  for (const old of oldItems) {
    await returnDeliveryPartStock(old as any);
  }
  // Replace all items: delete old, create new
  await prisma.deliveryNoteItem.deleteMany({ where: { deliveryNoteId: req.params.id } });
  const note = await prisma.deliveryNote.update({
    where: { id: req.params.id },
    data: {
      ...noteData,
      items: {
        create: (items || []).map((item: any) => {
          const serials = item.sparePartId ? parseSerialList(item.serialNumbers) : [];
          return {
            description: item.description,
            quantity: serials.length > 0 ? serials.length : Number(item.quantity),
            remark: item.remark || null,
            serialNumbers: Array.isArray(item.serialNumbers)
              ? JSON.stringify(item.serialNumbers)
              : item.serialNumbers || '[]',
            sparePartId: item.sparePartId || null,
          };
        }),
      },
    },
    include: { customer: true, items: true },
  });
  // Deduct stock for new spare part items
  for (const item of (items || [])) {
    if (item.sparePartId) {
      const serials = parseSerialList(item.serialNumbers);
      await consumeDeliveryPartStock(item.sparePartId, serials.length > 0 ? serials.length : Number(item.quantity), serials);
    }
  }
  await logActivity({
    entityType: 'DeliveryNote', entityId: note.id, entityName: note.docNumber,
    action: 'updated', performedBy: req.user?.username,
  });
  res.json(note);
});

// When a delivery note is completed, hand its robots and spare parts over to the customer:
// robots move to the customer, and spare parts are logged as held by the customer
// (their stock was already deducted when the note was created).
async function transferDeliveryNoteItemsToCustomer(
  note: { id: string; docNumber: string; customerId: string; items: { serialNumbers: string; sparePartId: string | null; quantity: number }[] },
  username?: string,
) {
  const customer = await prisma.customer.findUnique({ where: { id: note.customerId } });
  for (const item of note.items) {
    if (item.sparePartId) {
      const part = await prisma.sparePart.findUnique({ where: { id: item.sparePartId } });
      await logActivity({
        entityType: 'SparePart', entityId: item.sparePartId, entityName: part?.name,
        action: 'transferred',
        newValues: {
          transferredQty: item.quantity, serialNumbers: parseSerialList(item.serialNumbers), customerId: note.customerId, customerName: customer?.name ?? null,
          note: `ใบส่งของ ${note.docNumber}`, deliveryNoteId: note.id,
        },
        performedBy: username,
      });
      continue;
    }
    let serials: string[] = [];
    try { serials = JSON.parse(item.serialNumbers || '[]'); } catch { /* ignore */ }
    for (const sn of serials) {
      const robot = await prisma.robot.findUnique({ where: { serialNumber: sn } });
      if (!robot || robot.customerId === note.customerId) continue;
      const nextStatus = robot.status === 'In Stock' ? 'Assigned' : robot.status;
      await prisma.robot.update({ where: { id: robot.id }, data: { customerId: note.customerId, status: nextStatus } });
      await logActivity({
        entityType: 'Robot', entityId: robot.id, entityName: robot.serialNumber,
        action: nextStatus !== robot.status ? 'status_changed' : 'updated',
        oldValues: { status: robot.status, customerId: robot.customerId },
        newValues: { status: nextStatus, customerId: note.customerId, deliveryNote: note.docNumber },
        performedBy: username,
      });
    }
  }
}

app.patch('/api/delivery-notes/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.body;
  const validDnStatuses = ['Pending', 'Packed', 'In Transit', 'Delivered', 'Accepted', 'Invoiced'];
  if (!validDnStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' }); return;
  }
  const existing = await prisma.deliveryNote.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isValidTransition(DN_TRANSITIONS, existing.status, status)) {
    res.status(400).json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${existing.status}" เป็น "${status}" ได้` });
    return;
  }
  const updateData: any = { status };
  if (status === 'Accepted') updateData.acceptedAt = new Date().toISOString().split('T')[0];
  if (status === 'Delivered') updateData.installedAt = new Date().toISOString().split('T')[0];
  const note = await prisma.deliveryNote.update({
    where: { id: req.params.id },
    data: updateData,
    include: { items: true },
  });
  // Auto-create installation/setup maintenance ticket when delivered
  if (status === 'Delivered') {
    const dnItems = note.items || [];
    // Parse serial numbers from DN items to find robots
    for (const item of dnItems) {
      let serials: string[] = [];
      try { serials = JSON.parse((item as any).serialNumbers || '[]'); } catch { /* ignore */ }
      for (const sn of serials) {
        const robot = await prisma.robot.findUnique({ where: { serialNumber: sn } });
        if (robot) {
          await createMaintenanceTicketFromInput({
            robotId: robot.id,
            customerId: existing.customerId,
            issueDescription: `Installation / Setup after delivery (${existing.docNumber})`,
            status: 'Pending',
            priorityLevel: 'Normal',
          }, req.user?.username);
        }
      }
    }
  }
  if (status === 'Invoiced') await transferDeliveryNoteItemsToCustomer(note as any, req.user?.username);
  await logActivity({
    entityType: 'DeliveryNote', entityId: note.id, entityName: note.docNumber,
    action: 'status_changed', oldValues: { status: existing.status }, newValues: { status }, performedBy: req.user?.username,
  });
  res.json(note);
});

app.delete('/api/delivery-notes/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const note = await prisma.deliveryNote.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!note) { res.status(404).json({ error: 'Not found' }); return; }
  // Restore stock for spare part items before deleting
  for (const item of note.items) {
    await returnDeliveryPartStock(item as any);
  }
  await (prisma as any).trashItem.create({ data: {
    entityType: 'DeliveryNote', entityId: note.id, entityName: note.docNumber,
    entityData: JSON.stringify(note), deletedBy: req.user?.username,
  }});
  await prisma.deliveryNote.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'DeliveryNote', entityId: req.params.id, entityName: note.docNumber,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// ── Trash / Recycle Bin ───────────────────────────────────────────────────────

app.get('/api/trash', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const items = await (prisma as any).trashItem.findMany({ orderBy: { deletedAt: 'desc' } });
  res.json(items);
});

app.post('/api/trash/:id/restore', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const trashItem = await (prisma as any).trashItem.findUnique({ where: { id: req.params.id } });
  if (!trashItem) { res.status(404).json({ error: 'Trash item not found' }); return; }
  const data = JSON.parse(trashItem.entityData);
  try {
    if (trashItem.entityType === 'Robot') {
      await prisma.robot.create({ data: { id: data.id, serialNumber: data.serialNumber, status: data.status, purchaseDate: data.purchaseDate, modelId: data.modelId, customerId: data.customerId ?? null, locationId: data.locationId ?? null, notes: data.notes ?? null, warrantyExpiresAt: data.warrantyExpiresAt ?? null, puduMac: data.puduMac ?? null, archivedAt: data.archivedAt ?? null } });
    } else if (trashItem.entityType === 'Customer') {
      await prisma.customer.create({ data: { id: data.id, name: data.name, contactPerson: data.contactPerson, email: data.email, phone: data.phone, address: data.address, logoUrl: data.logoUrl ?? null, puduShopId: data.puduShopId ?? null, puduCompanyId: data.puduCompanyId ?? null } });
    } else if (trashItem.entityType === 'RobotModel') {
      await prisma.robotModel.create({ data: { id: data.id, name: data.name, type: data.type, payloadCapacity: data.payloadCapacity, batteryLife: data.batteryLife, imageUrl: data.imageUrl ?? null, puduProductCode: data.puduProductCode ?? null } });
    } else if (trashItem.entityType === 'SparePart') {
      await prisma.sparePart.create({
        data: {
          id: data.id,
          sku: data.sku,
          name: data.name,
          description: data.description ?? null,
          category: data.category ?? null,
          productModel: data.productModel ?? null,
          partType: data.partType ?? null,
          location: data.location ?? null,
          stock: data.stock ?? 0,
          minStock: data.minStock ?? 0,
          unitPrice: data.unitPrice ?? 0,
          supplier: data.supplier ?? null,
          status: data.status ?? null,
          sourceFile: data.sourceFile ?? null,
          sourceSheet: data.sourceSheet ?? null,
          items: {
            create: (data.items || []).map((item: any) => ({
              id: item.id,
              serialNumber: item.serialNumber,
              receivedDate: item.receivedDate,
              createdAt: item.createdAt ? new Date(item.createdAt) : undefined,
            })),
          },
        },
      });
    } else if (trashItem.entityType === 'DeliveryNote') {
      const { items, customer, ...noteData } = data;
      await prisma.deliveryNote.create({ data: { id: noteData.id, docNumber: noteData.docNumber, deliveryDate: noteData.deliveryDate, customerId: noteData.customerId, recipientName: noteData.recipientName ?? null, senderName: noteData.senderName ?? null, notes: noteData.notes ?? null, createdBy: noteData.createdBy ?? null, createdAt: new Date(noteData.createdAt), items: { create: (items || []).map((it: any) => ({ description: it.description, quantity: it.quantity, remark: it.remark ?? null, serialNumbers: it.serialNumbers })) } } });
    } else {
      res.status(400).json({ error: 'Unsupported entity type' }); return;
    }
    await (prisma as any).trashItem.delete({ where: { id: req.params.id } });
    await logActivity({ entityType: trashItem.entityType, entityId: trashItem.entityId, entityName: trashItem.entityName, action: 'restored', performedBy: req.user?.username });
    res.json({ success: true });
  } catch (err: any) {
    res.status(409).json({ error: err.message || 'Restore failed — item may already exist or have conflicts' });
  }
});

app.delete('/api/trash/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  await (prisma as any).trashItem.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

app.delete('/api/trash', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  await (prisma as any).trashItem.deleteMany({});
  res.json({ success: true });
});

// ── Robot Loans ───────────────────────────────────────────────────────────────

function loanDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `LN${y}${m}${d}-${rand}`;
}

app.get('/api/loans', authenticate, async (_req: AuthRequest, res: Response) => {
  const loans = await prisma.robotLoan.findMany({
    orderBy: { createdAt: 'desc' },
    include: { customer: { select: { id: true, name: true } }, items: true },
  });
  res.json(loans);
});

app.get('/api/loans/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const loan = await prisma.robotLoan.findUnique({
    where: { id: req.params.id },
    include: { customer: true, items: true },
  });
  if (!loan) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(loan);
});

app.post('/api/loans', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { robotIds, itemRemarksByRobotId, ...loanData } = req.body;
  if (!loanData.borrowerName || !loanData.loanDate || !loanData.expectedReturn) {
    res.status(400).json({ error: 'borrowerName, loanDate, and expectedReturn are required' });
    return;
  }
  if (!robotIds?.length) {
    res.status(400).json({ error: 'At least one robot is required' });
    return;
  }
  const docNumber = loanData.docNumber || loanDocNumber();
  const conflictingRobotIds = await findConflictingLoanRobots(null, robotIds);
  if (conflictingRobotIds.length > 0) {
    res.status(400).json({ error: 'มีหุ่นยนต์บางเครื่องอยู่ในใบยืมที่ยังไม่ปิดแล้ว' });
    return;
  }

  // Fetch robot details (serial numbers + model names) for snapshot
  const robots = await prisma.robot.findMany({
    where: { id: { in: robotIds } },
    include: { model: true },
  });

  const loan = await prisma.robotLoan.create({
    data: {
      ...loanData,
      docNumber,
      status: 'Pending',
      createdBy: req.user?.username,
      items: {
        create: robots.map((r: any) => ({
          robotId: r.id,
          serialNumber: r.serialNumber,
          modelName: r.model?.name || '-',
          remark: itemRemarksByRobotId?.[r.id] || null,
        })),
      },
    },
    include: { customer: true, items: true },
  });

  await logActivity({
    entityType: 'RobotLoan', entityId: loan.id, entityName: loan.docNumber,
    action: 'created', newValues: { docNumber, borrowerName: loan.borrowerName, robotCount: robots.length, status: 'Pending' },
    performedBy: req.user?.username,
  });
  res.status(201).json(loan);
});

// PATCH /api/loans/:id/status — approve, activate, return, cancel
app.patch('/api/loans/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, notes, returnConditions } = req.body;
  const validStatuses = ['Pending', 'Approved', 'Active', 'Returned', 'Cancelled'];
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const existing = await prisma.robotLoan.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (!isValidTransition(LOAN_TRANSITIONS, existing.status, status)) {
    res.status(400).json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${existing.status}" เป็น "${status}" ได้` });
    return;
  }

  const updateData: any = { status };
  if (status === 'Approved') {
    updateData.approvedBy = req.user?.username;
    updateData.approvedAt = new Date().toISOString().split('T')[0];
  }
  if (status === 'Active') {
    const hasEvidence = await hasRequiredLoanAttachment(req.params.id, 'loan-handover');
    if (!hasEvidence) {
      res.status(400).json({ error: 'ต้องแนบหลักฐานใบยืมก่อนเริ่มยืม' });
      return;
    }
    for (const item of existing.items) {
      await prisma.robot.update({ where: { id: item.robotId }, data: { status: 'In Maintenance' } });
    }
  }
  if (status === 'Returned') {
    const hasEvidence = await hasRequiredLoanAttachment(req.params.id, 'loan-return');
    if (!hasEvidence) {
      res.status(400).json({ error: 'ต้องแนบหลักฐานรับคืนก่อนบันทึกคืน' });
      return;
    }
    updateData.actualReturn = new Date().toISOString().split('T')[0];
    // Mark all unreturned items as returned
    await prisma.robotLoanItem.updateMany({
      where: { loanId: req.params.id, returnedAt: null },
      data: {
        returnedAt: new Date().toISOString().split('T')[0],
        condition: returnConditions || 'Good',
      },
    });
    // Restore robot statuses for all items in this loan
    for (const item of existing.items) {
      const robot = await prisma.robot.findUnique({ where: { id: item.robotId } });
      if (robot && robot.status !== 'Missing') {
        const restoreStatus = robot.customerId ? 'Assigned' : 'In Stock';
        await prisma.robot.update({ where: { id: item.robotId }, data: { status: restoreStatus } });
      }
    }
  }
  if (status === 'Cancelled') {
    // Restore robot statuses
    for (const item of existing.items) {
      // Only restore robots that haven't been individually returned
      if (!item.returnedAt) {
        const robot = await prisma.robot.findUnique({ where: { id: item.robotId } });
        if (robot && robot.status !== 'Missing') {
          const restoreStatus = robot.customerId ? 'Assigned' : 'In Stock';
          await prisma.robot.update({ where: { id: item.robotId }, data: { status: restoreStatus } });
        }
      }
    }
  }
  if (notes) updateData.notes = notes;

  const loan = await prisma.robotLoan.update({
    where: { id: req.params.id },
    data: updateData,
    include: { customer: true, items: true },
  });

  await logActivity({
    entityType: 'RobotLoan', entityId: loan.id, entityName: loan.docNumber,
    action: 'status_changed',
    oldValues: { status: existing.status },
    newValues: { status },
    performedBy: req.user?.username,
  });
  res.json(loan);
});

// PATCH /api/loans/:id/items/:itemId/return — partial return of a single robot
app.patch('/api/loans/:id/items/:itemId/return', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { condition } = req.body;
  const today = new Date().toISOString().split('T')[0];
  const hasEvidence = await hasRequiredLoanAttachment(req.params.id, 'loan-return');
  if (!hasEvidence) {
    res.status(400).json({ error: 'ต้องแนบหลักฐานรับคืนก่อนบันทึกคืน' });
    return;
  }

  const item = await prisma.robotLoanItem.findFirst({
    where: { id: req.params.itemId, loanId: req.params.id },
  });
  if (!item) { res.status(404).json({ error: 'Loan item not found' }); return; }
  if (item.returnedAt) { res.status(400).json({ error: 'รายการนี้คืนแล้ว' }); return; }

  // Mark item returned
  await prisma.robotLoanItem.update({
    where: { id: req.params.itemId },
    data: { returnedAt: today, condition: condition || 'Good' },
  });

  // Restore robot status
  const robot = await prisma.robot.findUnique({ where: { id: item.robotId } });
  if (robot && robot.status !== 'Missing') {
    const restoreStatus = robot.customerId ? 'Assigned' : 'In Stock';
    await prisma.robot.update({ where: { id: item.robotId }, data: { status: restoreStatus } });
  }

  // Check if all items are now returned → auto-complete loan
  const allItems = await prisma.robotLoanItem.findMany({ where: { loanId: req.params.id } });
  const allReturned = allItems.every(i => i.returnedAt);
  if (allReturned) {
    await prisma.robotLoan.update({
      where: { id: req.params.id },
      data: { status: 'Returned', actualReturn: today },
    });
  }

  const loan = await prisma.robotLoan.findUnique({
    where: { id: req.params.id },
    include: { customer: true, items: true },
  });
  res.json(loan);
});

app.put('/api/loans/:id', authenticate, async (req: AuthRequest, res: Response) => {
  const { robotIds, itemRemarksByRobotId, ...loanData } = req.body;
  // Rebuild items if robotIds provided
  if (robotIds?.length) {
    const conflictingRobotIds = await findConflictingLoanRobots(req.params.id, robotIds);
    if (conflictingRobotIds.length > 0) {
      res.status(400).json({ error: 'มีหุ่นยนต์บางเครื่องอยู่ในใบยืมที่ยังไม่ปิดแล้ว' });
      return;
    }
    await prisma.robotLoanItem.deleteMany({ where: { loanId: req.params.id } });
    const robots = await prisma.robot.findMany({
      where: { id: { in: robotIds } },
      include: { model: true },
    });
    loanData.items = {
      create: robots.map((r: any) => ({
        robotId: r.id,
        serialNumber: r.serialNumber,
        modelName: r.model?.name || '-',
        remark: itemRemarksByRobotId?.[r.id] || null,
      })),
    };
  }
  const loan = await prisma.robotLoan.update({
    where: { id: req.params.id },
    data: loanData,
    include: { customer: true, items: true },
  });
  await logActivity({
    entityType: 'RobotLoan', entityId: loan.id, entityName: loan.docNumber,
    action: 'updated', performedBy: req.user?.username,
  });
  res.json(loan);
});

app.delete('/api/loans/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const loan = await prisma.robotLoan.findUnique({ where: { id: req.params.id } });
  await prisma.robotLoan.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'RobotLoan', entityId: req.params.id, entityName: loan?.docNumber,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// ── Backup ───────────────────────────────────────────────────────────────────

const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || '/app/dev.db';

// GET /api/backup/info — stats: DB size, upload count/size
app.get('/api/backup/info', authenticate, requireAdmin, async (_req: AuthRequest, res: Response) => {
  const uploadsPath = path.join(__dirname, 'uploads');
  const dbStat = fs.existsSync(DB_PATH) ? fs.statSync(DB_PATH) : null;
  let uploadCount = 0;
  let uploadSize = 0;
  if (fs.existsSync(uploadsPath)) {
    const files = fs.readdirSync(uploadsPath);
    uploadCount = files.length;
    for (const f of files) {
      try { uploadSize += fs.statSync(path.join(uploadsPath, f)).size; } catch { /* ignore */ }
    }
  }
  res.json({
    dbSize: dbStat?.size ?? 0,
    dbModified: dbStat?.mtime ?? null,
    uploadCount,
    uploadSize,
  });
});

// GET /api/backup/db — download SQLite database file
app.get('/api/backup/db', authenticate, requireAdmin, (_req: AuthRequest, res: Response): void => {
  if (!fs.existsSync(DB_PATH)) {
    res.status(404).json({ error: 'Database file not found' });
    return;
  }
  const ts = new Date().toISOString().slice(0, 10);
  const stat = fs.statSync(DB_PATH);
  res.setHeader('Content-Disposition', `attachment; filename="ozone360-backup-${ts}.db"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(DB_PATH).pipe(res);
});

// GET /api/backup/uploads — zip uploads folder and stream download
app.get('/api/backup/uploads', authenticate, requireAdmin, (_req: AuthRequest, res: Response): void => {
  const uploadsPath = path.join(__dirname, 'uploads');
  if (!fs.existsSync(uploadsPath)) {
    res.status(404).json({ error: 'Uploads directory not found' });
    return;
  }
  const ts = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Disposition', `attachment; filename="ozone360-uploads-${ts}.zip"`);
  res.setHeader('Content-Type', 'application/zip');
  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('error', (err: Error) => {
    if (!res.headersSent) res.status(500).json({ error: err.message });
  });
  archive.pipe(res);
  archive.directory(uploadsPath, 'uploads');
  archive.finalize();
});

// POST /api/backup/restore/db — upload and restore a .db file
app.post('/api/backup/restore/db',
  authenticate,
  requireAdmin,
  multer({ dest: '/tmp/restore-upload/', limits: { fileSize: 500 * 1024 * 1024 } }).single('file'),
  async (req: AuthRequest, res: Response): Promise<void> => {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const tmpPath = req.file.path;
    // Basic sanity: check SQLite magic bytes
    const fd = fs.openSync(tmpPath, 'r');
    const magic = Buffer.alloc(16);
    fs.readSync(fd, magic, 0, 16, 0);
    fs.closeSync(fd);
    if (magic.toString('utf8', 0, 6) !== 'SQLite') {
      fs.unlinkSync(tmpPath);
      res.status(400).json({ error: 'File does not appear to be a SQLite database' });
      return;
    }
    try {
      // Disconnect Prisma before touching the DB file
      try { await prisma.$disconnect(); } catch { /* ignore */ }
      // Back up current DB before overwriting
      const bkTs = new Date().toISOString().replace(/[:.]/g, '-');
      if (fs.existsSync(DB_PATH)) {
        fs.copyFileSync(DB_PATH, `${DB_PATH}.bak-${bkTs}`);
      }
      fs.copyFileSync(tmpPath, DB_PATH);
      fs.unlinkSync(tmpPath);
      // Reconnect with fresh adapter/client
      await reconnectPrisma();
      res.json({ success: true, message: 'Database restored and reconnected.' });
    } catch (err: any) {
      console.error('[Restore] Error:', err);
      // Best-effort reconnect so the app stays usable
      try { await reconnectPrisma(); } catch { /* ignore */ }
      res.status(500).json({ error: err?.message || 'Restore failed' });
    }
  }
);

// ── Auto Backup (Scheduled) ─────────────────────────────────────────────────

const BACKUPS_DIR = '/app/backups';
const RETENTION_DAYS = 7;

// Async backup using SQLite's VACUUM INTO (transaction-safe, no corruption on live DB).
// Falls back to fs.copyFileSync only if VACUUM INTO fails (e.g. on Turso remote).
async function runAutoBackup(): Promise<string | null> {
  try {
    if (!fs.existsSync(BACKUPS_DIR)) fs.mkdirSync(BACKUPS_DIR, { recursive: true });
    if (!fs.existsSync(DB_PATH)) { console.error('[AutoBackup] DB not found:', DB_PATH); return null; }

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dest = path.join(BACKUPS_DIR, `auto-${ts}.db`);

    try {
      // VACUUM INTO creates a consistent snapshot of the DB without locking writers.
      const safeDest = dest.replace(/'/g, "''");
      await prisma.$executeRawUnsafe(`VACUUM INTO '${safeDest}'`);
      console.log(`[AutoBackup] VACUUM INTO saved: ${dest}`);
    } catch (vacuumErr) {
      console.warn('[AutoBackup] VACUUM INTO failed, falling back to copy:', vacuumErr);
      fs.copyFileSync(DB_PATH, dest);
      console.log(`[AutoBackup] copy saved: ${dest}`);
    }

    // Purge files older than RETENTION_DAYS
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(BACKUPS_DIR)) {
      if (!f.startsWith('auto-') || !f.endsWith('.db')) continue;
      const fp = path.join(BACKUPS_DIR, f);
      try {
        if (fs.statSync(fp).mtimeMs < cutoff) {
          fs.unlinkSync(fp);
          console.log(`[AutoBackup] Purged: ${f}`);
        }
      } catch { /* ignore */ }
    }
    return dest;
  } catch (err) {
    console.error('[AutoBackup] Error:', err);
    return null;
  }
}

// Schedule: every day at 00:00
cron.schedule('0 0 * * *', async () => {
  console.log('[AutoBackup] Running scheduled backup...');
  await runAutoBackup();
});

// Schedule: every day at 08:00 — check overdue loans
cron.schedule('0 8 * * *', async () => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const overdueLoans = await prisma.robotLoan.findMany({
      where: { status: { in: ['Active', 'Approved'] }, expectedReturn: { lt: today } },
    });
    for (const loan of overdueLoans) {
      // Only notify if not already notified today
      const existing = await (prisma as any).notification.findFirst({
        where: { entityId: loan.id, type: 'overdue_loan', createdAt: { gte: new Date(today) } },
      });
      if (!existing) {
        await createNotification('overdue_loan', `ใบยืมเกินกำหนดคืน: ${loan.docNumber}`, `${loan.borrowerName} กำหนดคืน ${loan.expectedReturn} (เกินกำหนด)`, 'RobotLoan', loan.id);
      }
    }
  } catch (e) { console.error('[OverdueLoanAlert]', e); }
});

// Schedule: every hour — check SLA breaches and escalate
cron.schedule('0 * * * *', async () => {
  try {
    const now = new Date().toISOString();
    // Find tickets where SLA has passed but not yet breached
    const breached = await prisma.maintenanceTicket.findMany({
      where: {
        status: { notIn: ['Completed'] },
        slaDueAt: { not: null, lt: now },
        slaBreachedAt: null,
      },
    });
    for (const t of breached) {
      await prisma.maintenanceTicket.update({
        where: { id: t.id },
        data: { slaBreachedAt: now, escalationLevel: 1 },
      });
      await createNotification('ticket_updated', `SLA Breached: Ticket #${t.id.slice(0, 8).toUpperCase()}`, `Ticket "${t.issueDescription.slice(0, 60)}" has exceeded its SLA deadline`, 'MaintenanceTicket', t.id);
    }
    // Escalate level 1 → 2 if breached > 2x SLA time
    const escalatable = await prisma.maintenanceTicket.findMany({
      where: { status: { notIn: ['Completed'] }, escalationLevel: 1, slaBreachedAt: { not: null } },
    });
    for (const t of escalatable) {
      if (!t.slaDueAt || !t.slaBreachedAt) continue;
      const slaMs = new Date(t.slaDueAt).getTime() - new Date(t.reportDate).getTime();
      if (Date.now() - new Date(t.slaBreachedAt).getTime() > slaMs) {
        await prisma.maintenanceTicket.update({ where: { id: t.id }, data: { escalationLevel: 2 } });
        await createNotification('ticket_updated', `SLA Critical: Ticket #${t.id.slice(0, 8).toUpperCase()}`, `Ticket escalated to level 2 — needs admin attention`, 'MaintenanceTicket', t.id);
      }
    }
    // Auto-generate due maintenance schedules daily via this same cron
    await generateDueMaintenanceSchedules('system');
  } catch (e) { console.error('[SLACron]', e); }
});

// GET /api/backup/auto/list — list saved auto backups
app.get('/api/backup/auto/list', authenticate, requireAdmin, (_req: AuthRequest, res: Response) => {
  if (!fs.existsSync(BACKUPS_DIR)) { res.json([]); return; }
  const files = fs.readdirSync(BACKUPS_DIR)
    .filter(f => f.startsWith('auto-') && f.endsWith('.db'))
    .map(f => {
      const fp = path.join(BACKUPS_DIR, f);
      const stat = fs.statSync(fp);
      return { filename: f, size: stat.size, createdAt: stat.mtime };
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  res.json(files);
});

// POST /api/backup/auto/run — trigger immediate backup
app.post('/api/backup/auto/run', authenticate, requireAdmin, async (_req: AuthRequest, res: Response): Promise<void> => {
  const dest = await runAutoBackup();
  if (!dest) { res.status(500).json({ error: 'Backup failed' }); return; }
  const stat = fs.statSync(dest);
  res.json({ success: true, filename: path.basename(dest), size: stat.size, createdAt: stat.mtime });
});

// GET /api/backup/auto/download/:filename — download a specific auto backup
app.get('/api/backup/auto/download/:filename', authenticate, requireAdmin, (req: AuthRequest, res: Response): void => {
  // validate filename to prevent path traversal
  const name = path.basename(req.params.filename);
  if (!name.startsWith('auto-') || !name.endsWith('.db') || name.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' }); return;
  }
  const fp = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(fp)) { res.status(404).json({ error: 'File not found' }); return; }
  const stat = fs.statSync(fp);
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Content-Length', stat.size);
  fs.createReadStream(fp).pipe(res);
});

// DELETE /api/backup/auto/:filename — delete a specific auto backup
app.delete('/api/backup/auto/:filename', authenticate, requireAdmin, (req: AuthRequest, res: Response): void => {
  const name = path.basename(req.params.filename);
  if (!name.startsWith('auto-') || !name.endsWith('.db') || name.includes('..')) {
    res.status(400).json({ error: 'Invalid filename' }); return;
  }
  const fp = path.join(BACKUPS_DIR, name);
  if (!fs.existsSync(fp)) { res.status(404).json({ error: 'File not found' }); return; }
  fs.unlinkSync(fp);
  res.json({ success: true });
});

// ── Material Requests (auto-reorder) ─────────────────────────────────────────

function mrDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `MR${y}${m}${d}-${rand}`;
}

// Auto-generate material requests for low-stock parts
async function generateMaterialRequests(performedBy?: string): Promise<{ created: number; partCount: number }> {
  const lowParts = await prisma.sparePart.findMany({
    where: { minStock: { gt: 0 } },
  });
  const belowMin = lowParts.filter(p => p.stock <= p.minStock);
  if (belowMin.length === 0) return { created: 0, partCount: 0 };

  // Check if there's already a pending MR with these parts
  const pendingMRs = await (prisma as any).materialRequest.findMany({
    where: { status: 'Pending' },
    include: { items: true },
  });
  const alreadyRequested = new Set<string>();
  for (const mr of pendingMRs) {
    for (const item of mr.items) {
      alreadyRequested.add(item.sparePartId);
    }
  }

  const newItems = belowMin.filter(p => !alreadyRequested.has(p.id));
  if (newItems.length === 0) return { created: 0, partCount: 0 };

  const mr = await (prisma as any).materialRequest.create({
    data: {
      docNumber: mrDocNumber(),
      status: 'Pending',
      requestDate: new Date().toISOString().split('T')[0],
      createdBy: performedBy || 'system',
      items: {
        create: newItems.map(p => ({
          sparePartId: p.id,
          partName: p.name,
          sku: p.sku,
          currentStock: p.stock,
          minStock: p.minStock,
          requestedQty: Math.max(p.minStock * 2 - p.stock, 1), // order up to 2x minStock
        })),
      },
    },
    include: { items: true },
  });

  await createNotification('low_stock', `Material Request สร้างอัตโนมัติ: ${mr.docNumber}`, `${newItems.length} รายการต่ำกว่า min stock`, 'MaterialRequest', mr.id);
  return { created: 1, partCount: newItems.length };
}

app.get('/api/material-requests', authenticate, async (_req: AuthRequest, res: Response) => {
  const mrs = await (prisma as any).materialRequest.findMany({
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  res.json(mrs);
});

app.post('/api/material-requests', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...data } = req.body;
  const mr = await (prisma as any).materialRequest.create({
    data: {
      ...data,
      docNumber: data.docNumber || mrDocNumber(),
      requestDate: data.requestDate || new Date().toISOString().split('T')[0],
      createdBy: req.user?.username,
      items: items?.length ? { create: items } : undefined,
    },
    include: { items: true },
  });
  res.status(201).json(mr);
});

app.patch('/api/material-requests/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.body;
  if (!['Pending', 'Approved', 'Ordered', 'Cancelled'].includes(status)) {
    res.status(400).json({ error: 'Invalid status' }); return;
  }
  const existing = await (prisma as any).materialRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  const patch: any = { status };
  if (status === 'Approved') {
    patch.approvedBy = req.user?.username;
    patch.approvedAt = new Date().toISOString().split('T')[0];
  }
  const mr = await (prisma as any).materialRequest.update({
    where: { id: req.params.id }, data: patch, include: { items: true },
  });
  res.json(mr);
});

app.delete('/api/material-requests/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  await (prisma as any).materialRequest.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// POST /api/material-requests/:id/convert-to-po — create PO from approved MR
app.post('/api/material-requests/:id/convert-to-po', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const mr = await (prisma as any).materialRequest.findUnique({
    where: { id: req.params.id }, include: { items: true },
  });
  if (!mr) { res.status(404).json({ error: 'Not found' }); return; }
  if (mr.status !== 'Approved') { res.status(400).json({ error: 'MR must be Approved before converting' }); return; }

  const { supplier } = req.body;
  if (!supplier) { res.status(400).json({ error: 'supplier is required' }); return; }

  const docNumber = poDocNumber();
  const items = (mr.items as any[]).map(i => ({
    sparePartId: i.sparePartId,
    sku: i.sku,
    partName: i.partName,
    quantity: i.requestedQty,
    unitPrice: 0,
    receivedQty: 0,
  }));
  const order = await (prisma as any).purchaseOrder.create({
    data: {
      docNumber,
      orderDate: new Date().toISOString().split('T')[0],
      supplier,
      status: 'Draft',
      createdBy: req.user?.username,
      items: { create: items },
    },
    include: { items: true },
  });
  await (prisma as any).materialRequest.update({
    where: { id: mr.id },
    data: { status: 'Ordered', linkedPoId: order.id },
  });
  await logActivity({
    entityType: 'MaterialRequest', entityId: mr.id, entityName: mr.docNumber,
    action: 'converted_to_po', newValues: { poId: order.id, poDocNumber: docNumber },
    performedBy: req.user?.username,
  });
  res.status(201).json(order);
});

// POST /api/material-requests/generate — manually trigger auto-reorder check
app.post('/api/material-requests/generate', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const result = await generateMaterialRequests(req.user?.username);
  res.json(result);
});

// ── Purchase Orders (ใบสั่งซื้ออะไหล่) ───────────────────────────────────────

function poDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `PO${y}${m}${d}-${rand}`;
}

// GET /api/purchase-orders
app.get('/api/purchase-orders', authenticate, async (_req: AuthRequest, res: Response) => {
  const orders = await (prisma as any).purchaseOrder.findMany({
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  res.json(orders);
});

// GET /api/purchase-orders/:id
app.get('/api/purchase-orders/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const order = await (prisma as any).purchaseOrder.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!order) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(order);
});

// POST /api/purchase-orders
app.post('/api/purchase-orders', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...data } = req.body;
  if (!data.supplier || !data.orderDate) {
    res.status(400).json({ error: 'supplier and orderDate are required' });
    return;
  }
  const docNumber = data.docNumber || poDocNumber();
  const totalAmount = (items || []).reduce((s: number, i: any) => s + (Number(i.quantity) * Number(i.unitPrice)), 0);
  const order = await (prisma as any).purchaseOrder.create({
    data: {
      ...data,
      docNumber,
      status: data.status || 'Draft',
      totalAmount,
      createdBy: req.user?.username,
      items: items?.length ? {
        create: items.map((i: any) => ({
          sparePartId: i.sparePartId || null,
          sku: i.sku || '',
          partName: i.partName || '',
          quantity: Number(i.quantity),
          unitPrice: Number(i.unitPrice),
          receivedQty: 0,
          remark: i.remark || '',
        })),
      } : undefined,
    },
    include: { items: true },
  });
  await logActivity({
    entityType: 'PurchaseOrder', entityId: order.id, entityName: order.docNumber,
    action: 'created', newValues: { docNumber, supplier: order.supplier, itemCount: (items || []).length },
    performedBy: req.user?.username,
  });
  res.status(201).json(order);
});

// PUT /api/purchase-orders/:id
app.put('/api/purchase-orders/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...data } = req.body;
  const existing = await (prisma as any).purchaseOrder.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  if (items !== undefined) {
    await (prisma as any).purchaseOrderItem.deleteMany({ where: { purchaseOrderId: req.params.id } });
  }
  const totalAmount = items !== undefined
    ? (items as any[]).reduce((s, i) => s + Number(i.quantity) * Number(i.unitPrice), 0)
    : existing.totalAmount;

  const updateData: any = { ...data, totalAmount };
  if (items !== undefined && items.length > 0) {
    updateData.items = {
      create: (items as any[]).map(i => ({
        sparePartId: i.sparePartId || null,
        sku: i.sku || '',
        partName: i.partName || '',
        quantity: Number(i.quantity),
        unitPrice: Number(i.unitPrice),
        receivedQty: Number(i.receivedQty ?? 0),
        remark: i.remark || '',
      })),
    };
  }
  const order = await (prisma as any).purchaseOrder.update({
    where: { id: req.params.id },
    data: updateData,
    include: { items: true },
  });
  await logActivity({
    entityType: 'PurchaseOrder', entityId: order.id, entityName: order.docNumber,
    action: 'updated', performedBy: req.user?.username,
  });
  res.json(order);
});

// PATCH /api/purchase-orders/:id/status
app.patch('/api/purchase-orders/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, receivedItems } = req.body; // receivedItems: { id: string; qty: number }[] optional
  const valid = ['Draft', 'Ordered', 'Partial', 'Received', 'Cancelled'];
  if (!valid.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return; }

  const existing = await (prisma as any).purchaseOrder.findUnique({
    where: { id: req.params.id }, include: { items: true },
  });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  // Validate transition
  if (!isValidTransition(PO_TRANSITIONS, existing.status, status)) {
    res.status(400).json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${existing.status}" เป็น "${status}" ได้` });
    return;
  }

  const patch: any = { status };
  if (status === 'Ordered') {
    patch.approvedBy = req.user?.username;
    patch.approvedAt = new Date().toISOString().split('T')[0];
  }
  if (status === 'Received' || status === 'Partial') {
    patch.receivedAt = new Date().toISOString().split('T')[0];
    // Build a map from itemId -> received qty (falls back to item.quantity if not provided)
    const receivedMap: Record<string, number> = {};
    if (Array.isArray(receivedItems)) {
      for (const ri of receivedItems) {
        receivedMap[ri.id] = Number(ri.qty) || 0;
      }
    }
    // update stock for each item
    let totalOrdered = 0, totalReceived = 0;
    for (const item of existing.items as any[]) {
      const qty = receivedMap[item.id] ?? (status === 'Received' ? item.quantity : 0);
      totalOrdered += item.quantity;
      totalReceived += qty;
      if (item.sparePartId && qty > 0) {
        const alreadyReceived = item.receivedQty || 0;
        const increment = qty - alreadyReceived;
        if (increment > 0) {
          await (prisma as any).sparePart.update({
            where: { id: item.sparePartId },
            data: { stock: { increment } },
          });
        }
      }
      await (prisma as any).purchaseOrderItem.update({
        where: { id: item.id },
        data: { receivedQty: qty },
      });
    }
    // Auto-detect partial: if received < ordered and user said "Received", correct to Partial
    if (status === 'Received' && totalReceived < totalOrdered && totalReceived > 0) {
      patch.status = 'Partial';
    }
  }
  const order = await (prisma as any).purchaseOrder.update({
    where: { id: req.params.id }, data: patch, include: { items: true },
  });
  await logActivity({
    entityType: 'PurchaseOrder', entityId: order.id, entityName: order.docNumber,
    action: 'status_changed', oldValues: { status: existing.status }, newValues: { status },
    performedBy: req.user?.username,
  });
  res.json(order);
});

// DELETE /api/purchase-orders/:id
app.delete('/api/purchase-orders/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const order = await (prisma as any).purchaseOrder.findUnique({ where: { id: req.params.id } });
  await (prisma as any).purchaseOrder.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'PurchaseOrder', entityId: req.params.id, entityName: order?.docNumber,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// ── Project Requests (ใบเปิดโปรเจค) ─────────────────────────────────────────

// GET /api/project-requests
app.get('/api/project-requests', authenticate, async (_req: AuthRequest, res: Response) => {
  const rows = await (prisma as any).projectRequest.findMany({
    include: { items: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(rows);
});

// GET /api/project-requests/:id
app.get('/api/project-requests/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const row = await (prisma as any).projectRequest.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!row) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(row);
});

// POST /api/project-requests
app.post('/api/project-requests', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    docNumber, title, description, projectType, status,
    startDate, expectedEndDate, budget,
    customerId, robotId, notes, items = [],
  } = req.body;
  if (!docNumber || !title || !startDate) {
    res.status(400).json({ error: 'docNumber, title, startDate are required' });
    return;
  }
  const totalCost = items.reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);
  const row = await (prisma as any).projectRequest.create({
    data: {
      docNumber, title, description, projectType: projectType || 'Both',
      status: status || 'Draft', startDate, expectedEndDate: expectedEndDate || null,
      budget: Number(budget) || 0, totalCost,
      customerId: customerId || null, robotId: robotId || null,
      notes, createdBy: req.user?.username,
      items: {
        create: items.map((it: any) => ({
          itemType: it.itemType || 'Part',
          description: it.description,
          vendor: it.vendor || null,
          quantity: Number(it.quantity) || 1,
          unit: it.unit || 'ชิ้น',
          unitPrice: Number(it.unitPrice) || 0,
          totalPrice: Number(it.totalPrice) || 0,
          link: it.link || null,
          remark: it.remark || null,
        })),
      },
    },
    include: { items: true },
  });
  await logActivity({
    entityType: 'ProjectRequest', entityId: row.id, entityName: row.docNumber,
    action: 'created', newValues: { title: row.title, status: row.status },
    performedBy: req.user?.username,
  });
  res.status(201).json(row);
});

// PATCH /api/project-requests/:id/status
app.patch('/api/project-requests/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { status, approvedBy, approvedAt, actualEndDate } = req.body;
  const validStatuses = Object.keys(PROJECT_REQUEST_TRANSITIONS);
  if (!validStatuses.includes(status)) {
    res.status(400).json({ error: 'Invalid status' });
    return;
  }

  const existing = await (prisma as any).projectRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  if (!isValidTransition(PROJECT_REQUEST_TRANSITIONS, existing.status, status)) {
    res.status(400).json({ error: `ไม่สามารถเปลี่ยนสถานะจาก "${existing.status}" เป็น "${status}" ได้` });
    return;
  }

  const updateData: Record<string, string | null> = { status };
  if (status === 'Approved') {
    updateData.approvedBy = approvedBy ?? req.user?.username ?? null;
    updateData.approvedAt = approvedAt || new Date().toISOString().split('T')[0];
  }
  if (status === 'Completed') {
    updateData.actualEndDate = actualEndDate || new Date().toISOString().split('T')[0];
  }

  const row = await (prisma as any).projectRequest.update({
    where: { id: req.params.id },
    data: updateData,
    include: { items: true },
  });

  await logActivity({
    entityType: 'ProjectRequest', entityId: row.id, entityName: row.docNumber,
    action: 'status_changed', oldValues: { status: existing.status }, newValues: { status: row.status },
    performedBy: req.user?.username,
  });

  res.json(row);
});

// PUT /api/project-requests/:id
app.put('/api/project-requests/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const {
    title, description, projectType, status,
    startDate, expectedEndDate, actualEndDate, budget,
    customerId, robotId, notes, approvedBy, approvedAt, items = [],
  } = req.body;
  const existing = await (prisma as any).projectRequest.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  const totalCost = items.reduce((sum: number, it: any) => sum + (Number(it.totalPrice) || 0), 0);

  // Replace items: delete old then create new
  await (prisma as any).projectRequestItem.deleteMany({ where: { projectRequestId: req.params.id } });

  const row = await (prisma as any).projectRequest.update({
    where: { id: req.params.id },
    data: {
      title, description, projectType,
      status, startDate, expectedEndDate: expectedEndDate || null,
      actualEndDate: actualEndDate || null,
      budget: Number(budget) || 0, totalCost,
      customerId: customerId || null, robotId: robotId || null,
      notes, approvedBy: approvedBy || null, approvedAt: approvedAt || null,
      items: {
        create: items.map((it: any) => ({
          itemType: it.itemType || 'Part',
          description: it.description,
          vendor: it.vendor || null,
          quantity: Number(it.quantity) || 1,
          unit: it.unit || 'ชิ้น',
          unitPrice: Number(it.unitPrice) || 0,
          totalPrice: Number(it.totalPrice) || 0,
          link: it.link || null,
          remark: it.remark || null,
        })),
      },
    },
    include: { items: true },
  });
  await logActivity({
    entityType: 'ProjectRequest', entityId: row.id, entityName: row.docNumber,
    action: 'updated', oldValues: { status: existing.status }, newValues: { status: row.status },
    performedBy: req.user?.username,
  });
  res.json(row);
});

// DELETE /api/project-requests/:id  (admin only)
app.delete('/api/project-requests/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response) => {
  const row = await (prisma as any).projectRequest.findUnique({ where: { id: req.params.id } });
  await (prisma as any).projectRequest.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'ProjectRequest', entityId: req.params.id, entityName: row?.docNumber,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ success: true });
});

// ── Pudu Cloud Excel Import ───────────────────────────────────────────────────

// ── Agent Import from Excel ───────────────────────────────────────────────────

// Fuzzy match: catch cases like "Tigersoft" ↔ "TigerSoft (1998) Co. Ltd." or "MurataMT200" ↔ "Murata Electronics"
function fuzzyNameMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\u0e00-\u9fff]/g, '');
  const an = norm(a);
  const bn = norm(b);
  // substring check (min 4 chars in the shorter string)
  if (an.length >= 4 && bn.includes(an)) return true;
  if (bn.length >= 4 && an.includes(bn)) return true;
  // shared significant word (4+ chars)
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9\u0e00-\u9fff]+/).filter(w => w.length >= 4);
  const aw = new Set(words(a));
  return words(b).some(w => aw.has(w));
}

// POST /api/agents/import/preview — parse Agent List xlsx, return dry-run
app.post('/api/agents/import/preview', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (rawRows.length < 2) { res.status(400).json({ error: 'ไฟล์ไม่มีข้อมูล' }); return; }

    const headers: string[] = rawRows[0].map((h: any) => String(h ?? '').trim());
    const iCode = headers.findIndex(h => h.toLowerCase().includes('client number'));
    const iName = headers.findIndex(h => h.toLowerCase().includes('agent company'));
    const iAccount = headers.findIndex(h => h.toLowerCase().includes('proxy account'));
    const iAddress = headers.findIndex(h => h.toLowerCase().includes('detailed address'));
    const iStatus = headers.findIndex(h => h.toLowerCase().includes('status'));
    const iStores = headers.findIndex(h => h.toLowerCase().includes('expanding'));
    const iDevices = headers.findIndex(h => h.toLowerCase().includes('activated') || h.toLowerCase().includes('bound'));
    if (iName < 0) { res.status(400).json({ error: 'ไม่พบคอลัมน์ Agent Company Name ในไฟล์' }); return; }

    const dataRows = rawRows.slice(1).filter((r: any[]) => r.some(c => c !== undefined && c !== ''));

    const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true, agentCode: true, type: true } }) as any[];
    const customerByName = new Map(allCustomers.map((c: any) => [c.name.toLowerCase(), c]));
    const customerByCode = new Map<string, any>();
    for (const c of allCustomers) { if (c.agentCode) customerByCode.set(c.agentCode.toLowerCase(), c); }

    const agents: any[] = [];
    for (const row of dataRows) {
      const name = iName >= 0 ? String(row[iName] ?? '').trim() : '';
      if (!name) continue;
      const agentCode = iCode >= 0 ? String(row[iCode] ?? '').trim() : '';
      const account = iAccount >= 0 ? String(row[iAccount] ?? '').trim() : '';
      const address = iAddress >= 0 ? String(row[iAddress] ?? '').trim() : '';
      const status = iStatus >= 0 ? String(row[iStatus] ?? '').trim() : '';
      const stores = iStores >= 0 ? String(row[iStores] ?? '').trim() : '';
      const devices = iDevices >= 0 ? String(row[iDevices] ?? '').trim() : '';

      const existing = customerByName.get(name.toLowerCase()) || (agentCode ? customerByCode.get(agentCode.toLowerCase()) : null);
      const fuzzyExisting = !existing ? allCustomers.find((c: any) => c.type !== 'agent' && fuzzyNameMatch(name, c.name)) : null;

      if (existing) {
        const changes: string[] = [];
        if (existing.type !== 'agent') changes.push('type → agent');
        if (agentCode && existing.agentCode !== agentCode) changes.push(`code: ${existing.agentCode ?? '-'} → ${agentCode}`);
        agents.push({ agentCode, name, account, address, status, stores, devices, action: changes.length > 0 ? 'update' : 'skip', reason: changes.length > 0 ? changes.join(', ') : 'มีอยู่แล้ว' });
      } else if (fuzzyExisting) {
        agents.push({ agentCode, name, account, address, status, stores, devices, action: 'merge', reason: `รวมเข้ากับ "${fuzzyExisting.name}"`, matchedName: fuzzyExisting.name });
      } else {
        agents.push({ agentCode, name, account, address, status, stores, devices, action: 'create', reason: 'เพิ่มตัวแทนใหม่' });
      }
    }

    const summary = {
      created: agents.filter(r => r.action === 'create').length,
      updated: agents.filter(r => r.action === 'update').length,
      merged: agents.filter(r => r.action === 'merge').length,
      skipped: agents.filter(r => r.action === 'skip').length,
    };
    res.json({ totalRows: dataRows.length, summary, agents });
  } catch (err: any) {
    console.error('[agents/import/preview] Error:', err);
    res.status(500).json({ error: err?.message || 'Preview failed' });
  }
});

// POST /api/agents/import/confirm — actually create/update agents
app.post('/api/agents/import/confirm', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (rawRows.length < 2) { res.status(400).json({ error: 'ไฟล์ไม่มีข้อมูล' }); return; }

    const headers: string[] = rawRows[0].map((h: any) => String(h ?? '').trim());
    const iCode = headers.findIndex(h => h.toLowerCase().includes('client number'));
    const iName = headers.findIndex(h => h.toLowerCase().includes('agent company'));
    const iAccount = headers.findIndex(h => h.toLowerCase().includes('proxy account'));
    const iAddress = headers.findIndex(h => h.toLowerCase().includes('detailed address'));
    if (iName < 0) { res.status(400).json({ error: 'ไม่พบคอลัมน์ Agent Company Name' }); return; }

    const dataRows = rawRows.slice(1).filter((r: any[]) => r.some(c => c !== undefined && c !== ''));
    const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true, agentCode: true, type: true } }) as any[];
    const customerByName = new Map(allCustomers.map((c: any) => [c.name.toLowerCase(), c]));
    const customerByCode = new Map<string, any>();
    for (const c of allCustomers) { if (c.agentCode) customerByCode.set(c.agentCode.toLowerCase(), c); }

    const stats = { created: 0, updated: 0, merged: 0, skipped: 0, errors: [] as string[] };

    for (const row of dataRows) {
      const name = iName >= 0 ? String(row[iName] ?? '').trim() : '';
      if (!name) continue;
      const code = iCode >= 0 ? String(row[iCode] ?? '').trim() : '';
      const account = iAccount >= 0 ? String(row[iAccount] ?? '').trim() : '';
      const address = iAddress >= 0 ? String(row[iAddress] ?? '').trim() : '';

      const existing = customerByName.get(name.toLowerCase()) || (code ? customerByCode.get(code.toLowerCase()) : null);
      const fuzzyExisting = !existing ? allCustomers.find((c: any) => (c as any).type !== 'agent' && fuzzyNameMatch(name, c.name)) : null;
      const target = existing || fuzzyExisting;

      try {
        if (target) {
          if (target.agentCode === code && (target as any).type === 'agent') {
            stats.skipped++;
          } else {
            await prisma.customer.update({ where: { id: target.id }, data: { type: 'agent', agentCode: code || undefined, ...(address ? { address } : {}) } });
            if (fuzzyExisting) stats.merged = (stats.merged || 0) + 1;
            else stats.updated++;
          }
        } else {
          const created = await prisma.customer.create({ data: { name, contactPerson: account || '', email: '', phone: '', address: address || '', type: 'agent', agentCode: code || null } });
          customerByName.set(name.toLowerCase(), created as any);
          stats.created++;
        }
      } catch (e: any) {
        stats.errors.push(`${name}: ${e.message}`);
      }
    }

    await prisma.activityLog.create({
      data: { entityType: 'AgentImport', entityId: 'xlsx', action: 'import-agents', performedBy: req.user?.username ?? 'unknown', newValues: JSON.stringify(stats) },
    });

    res.json({ totalRows: dataRows.length, ...stats });
  } catch (err: any) {
    console.error('[agents/import/confirm] Error:', err);
    res.status(500).json({ error: err?.message || 'Import failed' });
  }
});

// ── SN prefix → model name lookup (derived from Pudu Cloud data) ─────────────
const SN_PREFIX_MODEL_MAP: Record<string, string> = {
  '8SV': 'BellaBot',   'SV1': 'BellaBot',
  '811': 'PUDU CC1',
  '826': 'PUDU T300',
  '808': 'FlashBot',   'FBB': 'FlashBot',   '680': 'FlashBot',
  '817': 'PuduBot2',   '6e0': 'PuduBot2',
  '83A': 'PUDU T600 Underride',
  '866': 'PUDU MT1',   '899': 'PUDU MT1 Vac',
  '8HB': 'HolaBot',
  '8PN': 'KettyBot',   'PNT': 'KettyBot',
  '8S2': 'PUDU SH1',
};

/** Guess model name from first 3 characters of serial number */
function guessModelFromSN(sn: string): string {
  if (!sn || sn.length < 3) return '';
  const prefix = sn.slice(0, 3);
  return SN_PREFIX_MODEL_MAP[prefix] ?? SN_PREFIX_MODEL_MAP[prefix.toLowerCase()] ?? '';
}

// ── Shared helper: parse xlsx buffer and extract typed rows ──────────────────
async function parsePuduXlsx(buffer: Buffer) {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buffer, { type: 'buffer' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  if (rows.length < 2) throw new Error('File has no data rows');
  const headers: string[] = rows[0].map((h: any) => String(h ?? '').trim());
  const dataRows = rows.slice(1).filter((r: any[]) => r.some(c => c !== undefined && c !== ''));
  const isRobotFile = headers.includes('SN(PID)') || headers.includes('MAC address');
  const isStoreFile = headers.includes('Store Name') && headers.includes('Affiliated Agent Name');
  if (!isRobotFile && !isStoreFile) {
    throw new Error('Unrecognised file format. Expected Robot list or Store list from Pudu Cloud.');
  }
  return { headers, dataRows, isRobotFile, isStoreFile };
}

// ── Shared helper: compute per-row robot actions (reads DB, no writes) ───────
async function computeRobotActions(headers: string[], dataRows: any[]) {
  const col = (name: string) => headers.indexOf(name);
  const iSN = col('SN(PID)'); const iMAC = col('MAC address');
  const iModel = col('Product Name'); const iStore = col('Affiliated Store');
  const iClient = col('Affiliated Client'); // agent/company who owns the robot
  const iStatus = col('Status'); const iInstall = col('Store installation time');
  const iWarranty = col('Remaining Warranty Days');
  const OZONE_NAMES_RC = ['ozone', 'ozone network'];
  const isOzoneClient = (n: string) => OZONE_NAMES_RC.some(o => n.toLowerCase().includes(o));

  // Pre-fetch all models and customers into Maps (2 queries total)
  const allModels   = await prisma.robotModel.findMany({ select: { id: true, name: true, puduProductCode: true } });
  const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true } });
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const modelByName = new Map(allModels.map(m => [m.name.toLowerCase(), m]));
  const modelByCode = new Map(allModels.filter(m => m.puduProductCode).map(m => [m.puduProductCode!.toLowerCase(), m]));
  // Extra map: normalized (no spaces) for fuzzy match e.g. "PUDU T300" → "pudut300" matches "PuduT300"
  const modelByNorm = new Map(allModels.map(m => [norm(m.name), m]));
  const customerByName = new Map(allCustomers.map(c => [c.name.toLowerCase(), c]));

  // Pre-fetch all existing robots by SN (1 query)
  const snList = dataRows.map(r => String(r[iSN] ?? '').trim()).filter(Boolean);
  const existingRobots = await prisma.robot.findMany({ where: { serialNumber: { in: snList } }, select: { serialNumber: true, puduMac: true, modelId: true, customerId: true, status: true, warrantyExpiresAt: true } });
  const robotBySN = new Map(existingRobots.map(r => [r.serialNumber, r]));

  type RobotAction = { sn: string; mac: string | null; modelName: string; storeName: string; ownerName: string; status: string; warrantyExpiresAt: string | null; action: 'create' | 'update' | 'skip' | 'error'; newModel?: boolean; guessedModel?: boolean; reason?: string; changes?: string[] };
  const rows: RobotAction[] = [];

  for (const row of dataRows) {
    const sn = String(row[iSN] ?? '').trim();
    if (!sn) continue;
    const mac       = String(row[iMAC]    ?? '').trim() || null;
    const rawModelName = String(row[iModel]  ?? '').trim();
    const modelName = rawModelName || guessModelFromSN(sn);
    const guessedModel = !rawModelName && !!modelName;
    const storeName  = String(row[iStore]  ?? '').trim();
    const clientName = iClient >= 0 ? String(row[iClient] ?? '').trim() : '';
    // Link robot to agent when non-OZONE; fall back to store name otherwise
    const ownerName = (clientName && !isOzoneClient(clientName)) ? clientName : storeName;
    const rawStatus = String(row[iStatus] ?? '').trim();
    const installDate  = row[iInstall]  ? String(row[iInstall]).trim().slice(0, 10) : null;
    const warrantyDays = iWarranty >= 0 && row[iWarranty] !== undefined ? Number(row[iWarranty]) : null;
    const inStockStatuses = ['not activated', 'unbound', 'offline', 'deactivated'];
    const status = inStockStatuses.includes(rawStatus.toLowerCase()) ? 'In Stock' : 'Assigned';
    const model    = modelByName.get(modelName.toLowerCase()) ?? modelByCode.get(modelName.toLowerCase()) ?? modelByNorm.get(norm(modelName)) ?? null;
    const customer = customerByName.get(ownerName.toLowerCase()) ?? null;

    let warrantyExpiresAt: string | null = null;
    if (installDate && warrantyDays !== null && warrantyDays > 0) {
      const d = new Date(installDate); d.setDate(d.getDate() + warrantyDays);
      warrantyExpiresAt = d.toISOString().slice(0, 10);
    }

    const existing = robotBySN.get(sn);
    if (existing) {
      const changes: string[] = [];
      if (mac && existing.puduMac !== mac) changes.push(`MAC: ${existing.puduMac ?? '-'} → ${mac}`);
      if (model && existing.modelId !== model.id) changes.push(`Model → ${modelName}`);
      if (customer && existing.customerId !== customer.id) changes.push(`Owner → ${ownerName}`);
      if (existing.status !== status) changes.push(`Status: ${existing.status} → ${status}`);
      if (warrantyExpiresAt && existing.warrantyExpiresAt !== warrantyExpiresAt) changes.push(`Warranty → ${warrantyExpiresAt}`);
      rows.push({ sn, mac, modelName, storeName, ownerName, status, warrantyExpiresAt, action: changes.length > 0 ? 'update' : 'skip', guessedModel, changes });
    } else {
      // If model unknown, still create robot — model will be auto-created during import
      rows.push({ sn, mac, modelName, storeName, ownerName, status, warrantyExpiresAt, action: 'create', newModel: !model, guessedModel });
    }
  }
  return rows;
}

// ── Shared helper: compute per-row store actions (reads DB, no writes) ────────
async function computeStoreActions(headers: string[], dataRows: any[]) {
  const col = (name: string) => headers.indexOf(name);
  const iName = col('Store Name'); const iContact = col('Contact Information');
  const iAddress = col('Detailed Address'); const iAgent = col('Affiliated Agent Name');

  const nameList = dataRows.map(r => String(r[iName] ?? '').trim()).filter(Boolean);
  const existingList = await prisma.customer.findMany({ where: { name: { in: nameList } }, select: { id: true, name: true, address: true, phone: true } });
  const existingByName = new Map(existingList.map(c => [c.name, c]));

  type StoreAction = { name: string; address: string; phone: string; agent: string; action: 'create' | 'update' | 'skip'; changes?: string[] };
  const rows: StoreAction[] = [];

  for (const row of dataRows) {
    const name    = String(row[iName]    ?? '').trim(); if (!name) continue;
    const address = String(row[iAddress] ?? '').trim();
    const phone   = String(row[iContact] ?? '').trim();
    const agent   = String(row[iAgent]   ?? '').trim();
    const existing = existingByName.get(name);
    if (existing) {
      const changes: string[] = [];
      if (address && existing.address !== address) changes.push(`Address → ${address}`);
      if (phone   && existing.phone   !== phone)   changes.push(`Phone → ${phone}`);
      rows.push({ name, address, phone, agent, action: changes.length > 0 ? 'update' : 'skip', changes });
    } else {
      rows.push({ name, address, phone, agent, action: 'create' });
    }
  }
  return rows;
}

// POST /api/pudu/preview — parse xlsx, return dry-run preview (no DB writes)
app.post('/api/pudu/preview', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const { headers, dataRows, isRobotFile } = await parsePuduXlsx(req.file.buffer);
    if (isRobotFile) {
      const rows = await computeRobotActions(headers, dataRows);
      const summary = {
        created: rows.filter(r => r.action === 'create').length,
        updated: rows.filter(r => r.action === 'update').length,
        skipped: rows.filter(r => r.action === 'skip').length,
        errors: rows.filter(r => r.action === 'error').length,
      };
      const warnings: string[] = [];
      const guessedCount = rows.filter(r => r.guessedModel).length;
      const noModelCount = rows.filter(r => !r.modelName).length;
      if (guessedCount > 0) warnings.push(`${guessedCount} เครื่องไม่มีชื่อรุ่นในไฟล์ — ใช้ SN prefix เดารุ่นอัตโนมัติ`);
      if (noModelCount > 0) warnings.push(`${noModelCount} เครื่องไม่สามารถระบุรุ่นได้ (SN prefix ไม่ตรงกับรุ่นที่รู้จัก)`);
      res.json({ fileType: 'robot', totalRows: dataRows.length, summary, warnings, rows: rows.slice(0, 50) });
      return;
    }

    const rows = await computeStoreActions(headers, dataRows);
    const summary = {
      created: rows.filter(r => r.action === 'create').length,
      updated: rows.filter(r => r.action === 'update').length,
      skipped: rows.filter(r => r.action === 'skip').length,
      errors: 0,
    };
    const warnings: string[] = [];
    const noPhoneCount = rows.filter(r => !r.phone).length;
    if (noPhoneCount > 0) warnings.push(`${noPhoneCount} ร้านค้าไม่มีเบอร์โทรศัพท์ในไฟล์`);
    res.json({ fileType: 'store', totalRows: dataRows.length, summary, warnings, rows: rows.slice(0, 50) });
  } catch (err: any) {
    console.error('[pudu/preview] Error:', err);
    res.status(500).json({ error: err?.message || 'Preview failed' });
  }
});

// POST /api/pudu/import — import store or installed machine Excel from local upload
app.post('/api/pudu/import', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const { headers, dataRows, isRobotFile } = await parsePuduXlsx(req.file.buffer);
    const stats = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

    if (isRobotFile) {
      const actions = await computeRobotActions(headers, dataRows);
      const col = (name: string) => headers.indexOf(name);
      const iSN = col('SN(PID)');
      const iInstall = col('Store installation time');

      const allModels = await prisma.robotModel.findMany({ select: { id: true, name: true, puduProductCode: true } });
      const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true } });
      const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, '');
      const modelByName = new Map(allModels.map(m => [m.name.toLowerCase(), m]));
      const modelByCode = new Map(allModels.filter(m => m.puduProductCode).map(m => [m.puduProductCode!.toLowerCase(), m]));
      const modelByNormalized = new Map(allModels.map(m => [normalize(m.name), m]));
      const customerByName = new Map(allCustomers.map(c => [c.name.toLowerCase(), c]));

      for (const action of actions) {
        if (action.action === 'error') { stats.errors.push(`SN ${action.sn}: ${action.reason}`); continue; }
        if (action.action === 'skip') { stats.skipped++; continue; }

        let model = modelByName.get(action.modelName.toLowerCase())
          ?? modelByCode.get(action.modelName.toLowerCase())
          ?? modelByNormalized.get(normalize(action.modelName))
          ?? null;
        const customer = customerByName.get(action.ownerName.toLowerCase())
          ?? customerByName.get(action.storeName.toLowerCase())
          ?? null;

        try {
          if (!model && action.modelName) {
            model = await prisma.robotModel.create({
              data: { name: action.modelName, type: 'Service Robot', payloadCapacity: '-', batteryLife: '-' },
            });
            modelByName.set(action.modelName.toLowerCase(), model);
            modelByNormalized.set(normalize(action.modelName), model);
          }

          if (!model) {
            stats.errors.push(`SN ${action.sn}: ไม่สามารถระบุรุ่นหุ่นยนต์ได้`);
            continue;
          }

          if (action.action === 'create') {
            const row = dataRows.find((r: any[]) => String(r[iSN] ?? '').trim() === action.sn);
            const installDate = row && row[iInstall] ? String(row[iInstall]).trim().slice(0, 10) : null;
            let robotDate = installDate ?? new Date().toISOString().slice(0, 10);
            if (customer) {
              const maPlan = await (prisma as any).maintenancePlan.findFirst({
                where: { customerId: customer.id },
                select: { startDate: true },
              });
              if (maPlan?.startDate) robotDate = maPlan.startDate;
            }
            await prisma.robot.create({
              data: {
                serialNumber: action.sn,
                puduMac: action.mac,
                status: action.status,
                purchaseDate: robotDate,
                warrantyExpiresAt: action.warrantyExpiresAt,
                modelId: model.id,
                customerId: customer?.id ?? null,
              },
            });
            stats.created++;
          } else {
            await prisma.robot.update({
              where: { serialNumber: action.sn },
              data: {
                ...(action.mac ? { puduMac: action.mac } : {}),
                modelId: model.id,
                ...(customer ? { customerId: customer.id } : {}),
                status: action.status,
                ...(action.warrantyExpiresAt ? { warrantyExpiresAt: action.warrantyExpiresAt } : {}),
              },
            });
            stats.updated++;
          }
        } catch (e: any) {
          stats.errors.push(`SN ${action.sn}: ${e.message}`);
        }
      }
    } else {
      const actions = await computeStoreActions(headers, dataRows);
      for (const action of actions) {
        if (action.action === 'skip') { stats.skipped++; continue; }
        try {
          if (action.action === 'create') {
            await prisma.customer.create({
              data: {
                name: action.name,
                contactPerson: action.agent,
                email: '',
                phone: action.phone,
                address: action.address,
              },
            });
            stats.created++;
          } else {
            const existing = await prisma.customer.findFirst({ where: { name: { equals: action.name } } });
            if (existing) {
              await prisma.customer.update({
                where: { id: existing.id },
                data: {
                  ...(action.address ? { address: action.address } : {}),
                  ...(action.phone ? { phone: action.phone } : {}),
                },
              });
              stats.updated++;
            }
          }
        } catch (e: any) {
          stats.errors.push(`Store "${action.name}": ${e.message}`);
        }
      }
    }

    await prisma.activityLog.create({
      data: {
        entityType: 'PuduImport',
        entityId: 'xlsx',
        action: isRobotFile ? 'import-robots' : 'import-stores',
        performedBy: req.user?.username ?? 'unknown',
        newValues: JSON.stringify(stats),
      },
    });

    res.json({ fileType: isRobotFile ? 'robot' : 'store', totalRows: dataRows.length, ...stats });
  } catch (err: any) {
    console.error('[pudu/import] Error:', err);
    res.status(500).json({ error: err?.message || 'Internal server error during import' });
  }
});

// ── Unbound Machine Excel — Preview + Import (update status to "In Stock") ───

// POST /api/robots/import-status/preview — parse "Unbound Machine List" xlsx, return dry-run
app.post('/api/robots/import-status/preview', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (rawRows.length < 2) { res.status(400).json({ error: 'ไฟล์ไม่มีข้อมูล' }); return; }

    const headers: string[] = rawRows[0].map((h: any) => String(h ?? '').trim());
    const iSN = headers.indexOf('SN(PID)');
    const iMAC = headers.indexOf('MAC address');
    const iModel = headers.findIndex(h => h.toLowerCase().includes('product model') || h.toLowerCase().includes('product name'));
    const iStatus = headers.indexOf('Status');
    const iClient = headers.findIndex(h => h.toLowerCase().includes('affiliated client') || h.toLowerCase().includes('affiliated agent'));
    if (iSN < 0) { res.status(400).json({ error: 'ไม่พบคอลัมน์ SN(PID) ในไฟล์' }); return; }

    const dataRows = rawRows.slice(1).filter((r: any[]) => r.some(c => c !== undefined && c !== ''));

    // Fetch all existing robots by SN
    const allRobots = await prisma.robot.findMany({ select: { id: true, serialNumber: true, status: true, customerId: true } });
    const robotBySN = new Map(allRobots.map(r => [r.serialNumber.toLowerCase(), r]));

    // Fetch customers for agent matching
    const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true } });
    const customerByName = new Map(allCustomers.map(c => [c.name.toLowerCase(), c]));

    const OZONE_NAMES = ['ozone', 'ozone network'];
    const isOzone = (name: string) => OZONE_NAMES.some(o => name.toLowerCase().includes(o));

    const rows: any[] = [];
    for (const row of dataRows) {
      const sn = String(row[iSN] ?? '').trim();
      if (!sn) continue;
      const mac = iMAC >= 0 ? String(row[iMAC] ?? '').trim() : '';
      const rawModelName = iModel >= 0 ? String(row[iModel] ?? '').trim() : '';
      const modelName = rawModelName || guessModelFromSN(sn);
      const guessedModel = !rawModelName && !!modelName;
      const fileStatus = iStatus >= 0 ? String(row[iStatus] ?? '').trim() : '';
      const clientName = iClient >= 0 ? String(row[iClient] ?? '').trim() : '';
      const agentName = (!clientName || isOzone(clientName)) ? null : clientName;
      const existing = robotBySN.get(sn.toLowerCase());

      if (existing) {
        if (existing.status === 'In Stock') {
          rows.push({ sn, mac, modelName, guessedModel, fileStatus, agentName, action: 'skip', reason: 'อยู่ในคลังแล้ว', currentStatus: existing.status });
        } else {
          rows.push({ sn, mac, modelName, guessedModel, fileStatus, agentName, action: 'update', reason: `${existing.status} → In Stock`, currentStatus: existing.status });
        }
      } else {
        const note = agentName ? `เพิ่มใหม่ (คลังตัวแทน: ${agentName})` : 'เพิ่มใหม่เข้าระบบ';
        rows.push({ sn, mac, modelName, guessedModel, fileStatus, agentName, action: 'create', reason: note, currentStatus: null });
      }
    }

    const warnings: string[] = [];
    const guessedCount = rows.filter(r => r.guessedModel).length;
    const noModelCount = rows.filter(r => !r.modelName).length;
    if (guessedCount > 0) warnings.push(`${guessedCount} เครื่องไม่มีชื่อรุ่นในไฟล์ — ใช้ SN prefix เดารุ่นอัตโนมัติ`);
    if (noModelCount > 0) warnings.push(`${noModelCount} เครื่องไม่สามารถระบุรุ่นได้ (SN prefix ไม่ตรงกับรุ่นที่รู้จัก)`);

    const summary = {
      created: rows.filter(r => r.action === 'create').length,
      updated: rows.filter(r => r.action === 'update').length,
      skipped: rows.filter(r => r.action === 'skip').length,
    };

    res.json({ totalRows: dataRows.length, summary, warnings, rows });
  } catch (err: any) {
    console.error('[import-status/preview] Error:', err);
    res.status(500).json({ error: err?.message || 'Preview failed' });
  }
});

// POST /api/robots/import-status/confirm — actually perform the status updates
app.post('/api/robots/import-status/confirm', authenticate, requireAdmin, xlsxUpload.single('file'), async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!req.file) { res.status(400).json({ error: 'No file uploaded' }); return; }
    const XLSX = await import('xlsx');
    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const rawRows: any[] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    if (rawRows.length < 2) { res.status(400).json({ error: 'ไฟล์ไม่มีข้อมูล' }); return; }

    const headers: string[] = rawRows[0].map((h: any) => String(h ?? '').trim());
    const iSN = headers.indexOf('SN(PID)');
    const iMAC = headers.indexOf('MAC address');
    const iModel = headers.findIndex(h => h.toLowerCase().includes('product model') || h.toLowerCase().includes('product name'));
    const iClient = headers.findIndex(h => h.toLowerCase().includes('affiliated client') || h.toLowerCase().includes('affiliated agent'));
    if (iSN < 0) { res.status(400).json({ error: 'ไม่พบคอลัมน์ SN(PID)' }); return; }

    const dataRows = rawRows.slice(1).filter((r: any[]) => r.some(c => c !== undefined && c !== ''));
    const allRobots = await prisma.robot.findMany({ select: { id: true, serialNumber: true, status: true } });
    const robotBySN = new Map(allRobots.map(r => [r.serialNumber.toLowerCase(), r]));

    // Pre-fetch models for auto-create
    const allModels = await prisma.robotModel.findMany({ select: { id: true, name: true } });
    const modelByName = new Map(allModels.map(m => [m.name.toLowerCase(), m]));

    // Pre-fetch customers for agent matching / auto-create
    const allCustomers = await prisma.customer.findMany({ select: { id: true, name: true } });
    const customerByName = new Map(allCustomers.map(c => [c.name.toLowerCase(), c]));

    const OZONE_NAMES = ['ozone', 'ozone network'];
    const isOzone = (name: string) => OZONE_NAMES.some(o => name.toLowerCase().includes(o));

    const stats = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

    for (const row of dataRows) {
      const sn = String(row[iSN] ?? '').trim();
      if (!sn) continue;
      const mac = iMAC >= 0 ? String(row[iMAC] ?? '').trim() : '';
      const rawModelName = iModel >= 0 ? String(row[iModel] ?? '').trim() : '';
      const modelName = rawModelName || guessModelFromSN(sn);
      const clientName = iClient >= 0 ? String(row[iClient] ?? '').trim() : '';
      const agentName = (!clientName || isOzone(clientName)) ? null : clientName;
      const existing = robotBySN.get(sn.toLowerCase());

      // Resolve agent as customer
      let agentCustomerId: string | null = null;
      if (agentName) {
        let cust = customerByName.get(agentName.toLowerCase()) ?? null;
        if (!cust) {
          cust = await prisma.customer.create({ data: { name: agentName, contactPerson: '', email: '', phone: '', address: '' } });
          customerByName.set(agentName.toLowerCase(), cust);
        }
        agentCustomerId = cust.id;
      }

      try {
        if (existing) {
          if (existing.status === 'In Stock') {
            stats.skipped++;
          } else {
            await prisma.robot.update({ where: { id: existing.id }, data: { status: 'In Stock', customerId: agentCustomerId } });
            await logActivity({ entityType: 'Robot', entityId: existing.id, entityName: sn, action: 'status_changed', oldValues: { status: existing.status }, newValues: { status: 'In Stock', agent: agentName, source: 'Unbound Excel Import' }, performedBy: req.user?.username });
            stats.updated++;
          }
        } else {
          // Find or auto-create model
          let model = modelByName.get(modelName.toLowerCase()) ?? null;
          if (!model && modelName && modelName !== '/') {
            model = await prisma.robotModel.create({ data: { name: modelName, type: 'Service Robot', payloadCapacity: '-', batteryLife: '-' } });
            modelByName.set(modelName.toLowerCase(), model);
          }
          // Use first model as fallback if none matched
          if (!model) {
            const first = allModels[0] ?? await prisma.robotModel.findFirst();
            if (!first) { stats.errors.push(`SN ${sn}: ไม่พบรุ่นหุ่นยนต์ในระบบ`); continue; }
            model = first;
          }
          await prisma.robot.create({ data: { serialNumber: sn, puduMac: mac || null, status: 'In Stock', purchaseDate: new Date().toISOString().slice(0, 10), modelId: model.id, customerId: agentCustomerId } });
          await logActivity({ entityType: 'Robot', entityId: sn, entityName: sn, action: 'created', newValues: { status: 'In Stock', agent: agentName, source: 'Unbound Excel Import' }, performedBy: req.user?.username });
          stats.created++;
        }
      } catch (e: any) {
        stats.errors.push(`SN ${sn}: ${e.message}`);
      }
    }

    await prisma.activityLog.create({
      data: { entityType: 'UnboundImport', entityId: 'xlsx', action: 'import-status', performedBy: req.user?.username ?? 'unknown', newValues: JSON.stringify(stats) },
    });

    res.json({ totalRows: dataRows.length, ...stats });
  } catch (err: any) {
    console.error('[import-status/confirm] Error:', err);
    res.status(500).json({ error: err?.message || 'Import failed' });
  }
});

// ── Accounts Module (การเงิน) ─────────────────────────────────────────────────

function invDocNumber(type: 'Sales' | 'Purchase') {
  const prefix = type === 'Sales' ? 'INV' : 'BILL';
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `${prefix}${y}${m}${d}-${rand}`;
}
function payDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `PAY${y}${m}${d}-${rand}`;
}
function jeDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `JE${y}${m}${d}-${rand}`;
}

// ── Chart of Accounts ──

// GET /api/accounts
app.get('/api/accounts', authenticate, async (_req: AuthRequest, res: Response) => {
  const accounts = await (prisma as any).account.findMany({ orderBy: { code: 'asc' }, include: { parent: true } });
  res.json(accounts);
});

// POST /api/accounts
app.post('/api/accounts', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { code, name, type, parentId } = req.body;
  if (!code || !name || !type) { res.status(400).json({ error: 'code, name, type required' }); return; }
  const valid = ['Asset', 'Liability', 'Income', 'Expense', 'Equity'];
  if (!valid.includes(type)) { res.status(400).json({ error: 'Invalid account type' }); return; }
  const account = await (prisma as any).account.create({ data: { code, name, type, parentId: parentId || null } });
  await logActivity({ entityType: 'Account', entityId: account.id, entityName: `${code} - ${name}`, action: 'created', performedBy: req.user?.username });
  res.status(201).json(account);
});

// PUT /api/accounts/:id
app.put('/api/accounts/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { code, name, type, parentId, isActive } = req.body;
  const existing = await (prisma as any).account.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  const account = await (prisma as any).account.update({
    where: { id: req.params.id },
    data: { code, name, type, parentId: parentId || null, isActive: isActive ?? true },
  });
  await logActivity({ entityType: 'Account', entityId: account.id, entityName: `${account.code} - ${account.name}`, action: 'updated', performedBy: req.user?.username });
  res.json(account);
});

// DELETE /api/accounts/:id
app.delete('/api/accounts/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await (prisma as any).account.findUnique({ where: { id: req.params.id }, include: { journalLines: true, children: true } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (existing.journalLines.length > 0) { res.status(400).json({ error: 'Cannot delete account with journal entries' }); return; }
  if (existing.children.length > 0) { res.status(400).json({ error: 'Cannot delete account with sub-accounts' }); return; }
  await (prisma as any).account.delete({ where: { id: req.params.id } });
  await logActivity({ entityType: 'Account', entityId: req.params.id, entityName: `${existing.code} - ${existing.name}`, action: 'deleted', performedBy: req.user?.username });
  res.json({ success: true });
});

// POST /api/accounts/seed — seed default Thai chart of accounts
app.post('/api/accounts/seed', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const count = await (prisma as any).account.count();
  if (count > 0) { res.status(400).json({ error: 'Chart of accounts already has entries. Clear first to re-seed.' }); return; }
  const defaults = [
    { code: '1000', name: 'สินทรัพย์', type: 'Asset' },
    { code: '1100', name: 'เงินสด / ธนาคาร', type: 'Asset', parentCode: '1000' },
    { code: '1200', name: 'ลูกหนี้การค้า', type: 'Asset', parentCode: '1000' },
    { code: '1300', name: 'สินค้าคงเหลือ (อะไหล่)', type: 'Asset', parentCode: '1000' },
    { code: '1400', name: 'สินทรัพย์ถาวร (หุ่นยนต์)', type: 'Asset', parentCode: '1000' },
    { code: '2000', name: 'หนี้สิน', type: 'Liability' },
    { code: '2100', name: 'เจ้าหนี้การค้า', type: 'Liability', parentCode: '2000' },
    { code: '2200', name: 'ภาษีมูลค่าเพิ่มขาย', type: 'Liability', parentCode: '2000' },
    { code: '3000', name: 'ส่วนของเจ้าของ', type: 'Equity' },
    { code: '4000', name: 'รายได้', type: 'Income' },
    { code: '4100', name: 'รายได้จากการขาย / บริการซ่อม', type: 'Income', parentCode: '4000' },
    { code: '4200', name: 'รายได้อื่น', type: 'Income', parentCode: '4000' },
    { code: '5000', name: 'ค่าใช้จ่าย', type: 'Expense' },
    { code: '5100', name: 'ต้นทุนอะไหล่', type: 'Expense', parentCode: '5000' },
    { code: '5200', name: 'ค่าแรงช่าง', type: 'Expense', parentCode: '5000' },
    { code: '5300', name: 'ค่าขนส่ง', type: 'Expense', parentCode: '5000' },
    { code: '5400', name: 'ค่าใช้จ่ายทั่วไป', type: 'Expense', parentCode: '5000' },
  ];
  // Create parents first, then children
  const idMap: Record<string, string> = {};
  for (const d of defaults.filter(d => !(d as any).parentCode)) {
    const acct = await (prisma as any).account.create({ data: { code: d.code, name: d.name, type: d.type } });
    idMap[d.code] = acct.id;
  }
  for (const d of defaults.filter(d => (d as any).parentCode)) {
    const acct = await (prisma as any).account.create({ data: { code: d.code, name: d.name, type: d.type, parentId: idMap[(d as any).parentCode] || null } });
    idMap[d.code] = acct.id;
  }
  await logActivity({ entityType: 'Account', entityId: 'seed', entityName: 'Chart of Accounts', action: 'created', newValues: { count: defaults.length }, performedBy: req.user?.username });
  res.status(201).json({ success: true, count: defaults.length });
});

// ── Invoices ──

// GET /api/invoices
app.get('/api/invoices', authenticate, async (_req: AuthRequest, res: Response) => {
  const invoices = await (prisma as any).invoice.findMany({ orderBy: { createdAt: 'desc' }, include: { items: true, payments: true } });
  res.json(invoices);
});

// GET /api/invoices/:id
app.get('/api/invoices/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const inv = await (prisma as any).invoice.findUnique({ where: { id: req.params.id }, include: { items: true, payments: true } });
  if (!inv) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(inv);
});

// POST /api/invoices
app.post('/api/invoices', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...data } = req.body;
  if (!data.invoiceType || !data.invoiceDate || !data.dueDate) {
    res.status(400).json({ error: 'invoiceType, invoiceDate, dueDate required' }); return;
  }
  const docNumber = data.docNumber || invDocNumber(data.invoiceType);
  const taxRate = Number(data.taxRate ?? 7);
  const subtotal = (items || []).reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitPrice), 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  const totalAmount = subtotal + taxAmount;

  const inv = await (prisma as any).invoice.create({
    data: {
      ...data, docNumber, taxRate, subtotal, taxAmount, totalAmount,
      paidAmount: 0, createdBy: req.user?.username,
      items: items?.length ? {
        create: (items as any[]).map(i => ({
          description: i.description || '', quantity: Number(i.quantity), unit: i.unit || 'ชิ้น',
          unitPrice: Number(i.unitPrice), amount: Number(i.quantity) * Number(i.unitPrice), remark: i.remark || '',
        })),
      } : undefined,
    },
    include: { items: true, payments: true },
  });
  await logActivity({ entityType: 'Invoice', entityId: inv.id, entityName: inv.docNumber, action: 'created', newValues: { invoiceType: inv.invoiceType, total: totalAmount }, performedBy: req.user?.username });
  res.status(201).json(inv);
});

// PUT /api/invoices/:id
app.put('/api/invoices/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...data } = req.body;
  const existing = await (prisma as any).invoice.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  if (items !== undefined) {
    await (prisma as any).invoiceItem.deleteMany({ where: { invoiceId: req.params.id } });
  }
  const taxRate = Number(data.taxRate ?? existing.taxRate);
  const subtotal = items !== undefined
    ? (items as any[]).reduce((s: number, i: any) => s + Number(i.quantity) * Number(i.unitPrice), 0)
    : existing.subtotal;
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  const totalAmount = subtotal + taxAmount;

  const updateData: any = { ...data, taxRate, subtotal, taxAmount, totalAmount };
  if (items !== undefined && items.length > 0) {
    updateData.items = {
      create: (items as any[]).map((i: any) => ({
        description: i.description || '', quantity: Number(i.quantity), unit: i.unit || 'ชิ้น',
        unitPrice: Number(i.unitPrice), amount: Number(i.quantity) * Number(i.unitPrice), remark: i.remark || '',
      })),
    };
  }
  const inv = await (prisma as any).invoice.update({ where: { id: req.params.id }, data: updateData, include: { items: true, payments: true } });
  await logActivity({ entityType: 'Invoice', entityId: inv.id, entityName: inv.docNumber, action: 'updated', performedBy: req.user?.username });
  res.json(inv);
});

// PATCH /api/invoices/:id/status
app.patch('/api/invoices/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.body;
  const valid = ['Draft', 'Issued', 'Paid', 'Partial', 'Cancelled', 'Overdue'];
  if (!valid.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return; }
  const existing = await (prisma as any).invoice.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  const inv = await (prisma as any).invoice.update({ where: { id: req.params.id }, data: { status } });
  await logActivity({ entityType: 'Invoice', entityId: inv.id, entityName: inv.docNumber, action: 'status_changed', oldValues: { status: existing.status }, newValues: { status }, performedBy: req.user?.username });
  res.json(inv);
});

// DELETE /api/invoices/:id
app.delete('/api/invoices/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const inv = await (prisma as any).invoice.findUnique({ where: { id: req.params.id } });
  if (!inv) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).invoice.delete({ where: { id: req.params.id } });
  await logActivity({ entityType: 'Invoice', entityId: req.params.id, entityName: inv.docNumber, action: 'deleted', performedBy: req.user?.username });
  res.json({ success: true });
});

// POST /api/invoices/from-delivery-note/:id — auto-create Sales Invoice from DN
app.post('/api/invoices/from-delivery-note/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const dn = await (prisma as any).deliveryNote.findUnique({ where: { id: req.params.id }, include: { items: true, customer: true } });
  if (!dn) { res.status(404).json({ error: 'Delivery note not found' }); return; }
  // Check if already invoiced
  const existing = await (prisma as any).invoice.findFirst({ where: { sourceType: 'DeliveryNote', sourceId: dn.id } });
  if (existing) { res.status(400).json({ error: `Already invoiced: ${existing.docNumber}` }); return; }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const taxRate = Number(req.body.taxRate ?? 7);

  const items = (dn.items as any[]).map((item: any) => ({
    description: item.description,
    quantity: Number(item.quantity),
    unit: 'ชิ้น',
    unitPrice: item.sparePartId ? 0 : 0, // Price needs to be set manually or from spare part
    amount: 0,
    remark: item.remark || '',
  }));

  const subtotal = items.reduce((s: number, i: any) => s + i.amount, 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  const totalAmount = subtotal + taxAmount;

  const inv = await (prisma as any).invoice.create({
    data: {
      docNumber: invDocNumber('Sales'),
      invoiceType: 'Sales',
      status: 'Draft',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      customerId: dn.customerId,
      customerName: dn.customer?.name || '',
      subtotal, taxRate, taxAmount, totalAmount,
      sourceType: 'DeliveryNote',
      sourceId: dn.id,
      createdBy: req.user?.username,
      items: { create: items },
    },
    include: { items: true, payments: true },
  });
  await logActivity({ entityType: 'Invoice', entityId: inv.id, entityName: inv.docNumber, action: 'created', newValues: { source: `DN: ${dn.docNumber}` }, performedBy: req.user?.username });
  res.status(201).json(inv);
});

// POST /api/invoices/from-purchase-order/:id — auto-create Purchase Invoice from PO
app.post('/api/invoices/from-purchase-order/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const po = await (prisma as any).purchaseOrder.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!po) { res.status(404).json({ error: 'Purchase order not found' }); return; }
  const existing = await (prisma as any).invoice.findFirst({ where: { sourceType: 'PurchaseOrder', sourceId: po.id } });
  if (existing) { res.status(400).json({ error: `Already invoiced: ${existing.docNumber}` }); return; }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const taxRate = Number(req.body.taxRate ?? 7);

  const items = (po.items as any[]).map((item: any) => ({
    description: item.partName,
    quantity: Number(item.receivedQty || item.quantity),
    unit: 'ชิ้น',
    unitPrice: Number(item.unitPrice),
    amount: Number(item.receivedQty || item.quantity) * Number(item.unitPrice),
    remark: item.remark || '',
  }));

  const subtotal = items.reduce((s: number, i: any) => s + i.amount, 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  const totalAmount = subtotal + taxAmount;

  const inv = await (prisma as any).invoice.create({
    data: {
      docNumber: invDocNumber('Purchase'),
      invoiceType: 'Purchase',
      status: 'Draft',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      supplier: po.supplier,
      subtotal, taxRate, taxAmount, totalAmount,
      sourceType: 'PurchaseOrder',
      sourceId: po.id,
      createdBy: req.user?.username,
      items: { create: items },
    },
    include: { items: true, payments: true },
  });
  await logActivity({ entityType: 'Invoice', entityId: inv.id, entityName: inv.docNumber, action: 'created', newValues: { source: `PO: ${po.docNumber}` }, performedBy: req.user?.username });
  res.status(201).json(inv);
});

// POST /api/invoices/from-maintenance-ticket/:id
app.post('/api/invoices/from-maintenance-ticket/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const ticket = await prisma.maintenanceTicket.findUnique({
    where: { id: req.params.id },
    include: { usedParts: { include: { sparePart: true } }, robot: { include: { model: true } }, customer: true },
  });
  if (!ticket) { res.status(404).json({ error: 'Ticket not found' }); return; }
  const existing = await (prisma as any).invoice.findFirst({ where: { sourceType: 'MaintenanceTicket', sourceId: ticket.id } });
  if (existing) { res.status(400).json({ error: `Already invoiced: ${existing.docNumber}` }); return; }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const taxRate = Number(req.body.taxRate ?? 7);
  const laborCost = Number(req.body.laborCost ?? 0);

  const items: any[] = (ticket.usedParts || []).map((up: any) => ({
    description: `อะไหล่: ${up.sparePart?.name || 'Unknown'}`,
    quantity: up.quantity,
    unit: 'ชิ้น',
    unitPrice: up.sparePart?.unitPrice || 0,
    amount: up.quantity * (up.sparePart?.unitPrice || 0),
  }));
  if (laborCost > 0) {
    items.push({ description: 'ค่าแรงซ่อม', quantity: 1, unit: 'งาน', unitPrice: laborCost, amount: laborCost });
  }

  const subtotal = items.reduce((s, i) => s + i.amount, 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  const totalAmount = subtotal + taxAmount;

  const inv = await (prisma as any).invoice.create({
    data: {
      docNumber: invDocNumber('Sales'),
      invoiceType: 'Sales',
      status: 'Draft',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      customerId: ticket.customerId,
      customerName: (ticket as any).customer?.name || '',
      subtotal, taxRate, taxAmount, totalAmount,
      sourceType: 'MaintenanceTicket',
      sourceId: ticket.id,
      createdBy: req.user?.username,
      items: { create: items },
    },
    include: { items: true, payments: true },
  });
  await logActivity({ entityType: 'Invoice', entityId: inv.id, entityName: inv.docNumber, action: 'created', newValues: { source: `Ticket: ${ticket.id.slice(0, 8)}` }, performedBy: req.user?.username });
  res.status(201).json(inv);
});

// POST /api/invoices/from-project-request/:id
app.post('/api/invoices/from-project-request/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const pr = await (prisma as any).projectRequest.findUnique({ where: { id: req.params.id }, include: { items: true } });
  if (!pr) { res.status(404).json({ error: 'Project request not found' }); return; }
  const existing = await (prisma as any).invoice.findFirst({ where: { sourceType: 'ProjectRequest', sourceId: pr.id } });
  if (existing) { res.status(400).json({ error: `Already invoiced: ${existing.docNumber}` }); return; }

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const taxRate = Number(req.body.taxRate ?? 7);

  const items = (pr.items as any[]).map((item: any) => ({
    description: `${item.itemType}: ${item.description}`,
    quantity: Number(item.quantity),
    unit: item.unit || 'ชิ้น',
    unitPrice: Number(item.unitPrice),
    amount: Number(item.totalPrice || item.quantity * item.unitPrice),
    remark: item.remark || '',
  }));

  const subtotal = items.reduce((s: number, i: any) => s + i.amount, 0);
  const taxAmount = Math.round(subtotal * taxRate) / 100;
  const totalAmount = subtotal + taxAmount;

  const inv = await (prisma as any).invoice.create({
    data: {
      docNumber: invDocNumber('Sales'),
      invoiceType: 'Sales',
      status: 'Draft',
      invoiceDate: new Date().toISOString().split('T')[0],
      dueDate: dueDate.toISOString().split('T')[0],
      customerId: pr.customerId || null,
      subtotal, taxRate, taxAmount, totalAmount,
      sourceType: 'ProjectRequest',
      sourceId: pr.id,
      createdBy: req.user?.username,
      items: { create: items },
    },
    include: { items: true, payments: true },
  });
  await logActivity({ entityType: 'Invoice', entityId: inv.id, entityName: inv.docNumber, action: 'created', newValues: { source: `PR: ${pr.docNumber}` }, performedBy: req.user?.username });
  res.status(201).json(inv);
});

// ── Payments ──

// GET /api/payments
app.get('/api/payments', authenticate, async (_req: AuthRequest, res: Response) => {
  const payments = await (prisma as any).payment.findMany({ orderBy: { createdAt: 'desc' }, include: { invoice: true } });
  res.json(payments);
});

// POST /api/payments
app.post('/api/payments', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const data = req.body;
  if (!data.paymentType || !data.paymentDate || !data.amount) {
    res.status(400).json({ error: 'paymentType, paymentDate, amount required' }); return;
  }
  const docNumber = data.docNumber || payDocNumber();
  const payment = await (prisma as any).payment.create({
    data: { ...data, docNumber, amount: Number(data.amount), createdBy: req.user?.username },
    include: { invoice: true },
  });

  // Auto-update invoice paid amount & status if linked
  if (payment.invoiceId) {
    const invoice = await (prisma as any).invoice.findUnique({ where: { id: payment.invoiceId }, include: { payments: true } });
    if (invoice) {
      const totalPaid = (invoice.payments as any[]).reduce((s: number, p: any) => s + Number(p.amount), 0);
      const newStatus = totalPaid >= invoice.totalAmount ? 'Paid' : 'Partial';
      await (prisma as any).invoice.update({ where: { id: invoice.id }, data: { paidAmount: totalPaid, status: newStatus } });
    }
  }

  await logActivity({ entityType: 'Payment', entityId: payment.id, entityName: payment.docNumber, action: 'created', newValues: { type: payment.paymentType, amount: payment.amount }, performedBy: req.user?.username });
  res.status(201).json(payment);
});

// DELETE /api/payments/:id
app.delete('/api/payments/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const payment = await (prisma as any).payment.findUnique({ where: { id: req.params.id } });
  if (!payment) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).payment.delete({ where: { id: req.params.id } });

  // Re-calculate invoice totals
  if (payment.invoiceId) {
    const invoice = await (prisma as any).invoice.findUnique({ where: { id: payment.invoiceId }, include: { payments: true } });
    if (invoice) {
      const totalPaid = (invoice.payments as any[]).reduce((s: number, p: any) => s + Number(p.amount), 0);
      const newStatus = totalPaid <= 0 ? 'Issued' : totalPaid >= invoice.totalAmount ? 'Paid' : 'Partial';
      await (prisma as any).invoice.update({ where: { id: invoice.id }, data: { paidAmount: totalPaid, status: newStatus } });
    }
  }

  await logActivity({ entityType: 'Payment', entityId: req.params.id, entityName: payment.docNumber, action: 'deleted', performedBy: req.user?.username });
  res.json({ success: true });
});

// ── Journal Entries ──

// GET /api/journal-entries
app.get('/api/journal-entries', authenticate, async (_req: AuthRequest, res: Response) => {
  const entries = await (prisma as any).journalEntry.findMany({ orderBy: { createdAt: 'desc' }, include: { lines: { include: { account: true } } } });
  res.json(entries);
});

// POST /api/journal-entries
app.post('/api/journal-entries', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { lines, ...data } = req.body;
  if (!data.entryDate || !lines || lines.length < 2) {
    res.status(400).json({ error: 'entryDate and at least 2 lines required' }); return;
  }
  // Validate debit = credit
  const totalDebit = lines.reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  const totalCredit = lines.reduce((s: number, l: any) => s + Number(l.credit || 0), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    res.status(400).json({ error: `Debit (${totalDebit}) must equal Credit (${totalCredit})` }); return;
  }
  const docNumber = data.docNumber || jeDocNumber();
  const entry = await (prisma as any).journalEntry.create({
    data: {
      ...data, docNumber, createdBy: req.user?.username,
      lines: {
        create: (lines as any[]).map(l => ({
          accountId: l.accountId, debit: Number(l.debit || 0), credit: Number(l.credit || 0), description: l.description || '',
        })),
      },
    },
    include: { lines: { include: { account: true } } },
  });
  await logActivity({ entityType: 'JournalEntry', entityId: entry.id, entityName: entry.docNumber, action: 'created', newValues: { totalDebit }, performedBy: req.user?.username });
  res.status(201).json(entry);
});

// DELETE /api/journal-entries/:id
app.delete('/api/journal-entries/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const entry = await (prisma as any).journalEntry.findUnique({ where: { id: req.params.id } });
  if (!entry) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).journalEntry.delete({ where: { id: req.params.id } });
  await logActivity({ entityType: 'JournalEntry', entityId: req.params.id, entityName: entry.docNumber, action: 'deleted', performedBy: req.user?.username });
  res.json({ success: true });
});

// ── Budgets ──

// GET /api/budgets
app.get('/api/budgets', authenticate, async (_req: AuthRequest, res: Response) => {
  const budgets = await (prisma as any).budget.findMany({ orderBy: { createdAt: 'desc' }, include: { account: true } });
  res.json(budgets);
});

// POST /api/budgets
app.post('/api/budgets', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const { name, accountId, fiscalYear, budgetAmount, notes } = req.body;
  if (!name || !accountId || !fiscalYear || budgetAmount == null) {
    res.status(400).json({ error: 'name, accountId, fiscalYear, budgetAmount required' }); return;
  }
  const budget = await (prisma as any).budget.create({ data: { name, accountId, fiscalYear, budgetAmount: Number(budgetAmount), notes: notes || '' } });
  await logActivity({ entityType: 'Budget', entityId: budget.id, entityName: budget.name, action: 'created', performedBy: req.user?.username });
  res.status(201).json(budget);
});

// PUT /api/budgets/:id
app.put('/api/budgets/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await (prisma as any).budget.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  const { name, accountId, fiscalYear, budgetAmount, spentAmount, notes } = req.body;
  const budget = await (prisma as any).budget.update({
    where: { id: req.params.id },
    data: { name, accountId, fiscalYear, budgetAmount: Number(budgetAmount), spentAmount: spentAmount != null ? Number(spentAmount) : undefined, notes },
    include: { account: true },
  });
  await logActivity({ entityType: 'Budget', entityId: budget.id, entityName: budget.name, action: 'updated', performedBy: req.user?.username });
  res.json(budget);
});

// DELETE /api/budgets/:id
app.delete('/api/budgets/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await (prisma as any).budget.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).budget.delete({ where: { id: req.params.id } });
  await logActivity({ entityType: 'Budget', entityId: req.params.id, entityName: existing.name, action: 'deleted', performedBy: req.user?.username });
  res.json({ success: true });
});

// ── Accounts Summary / Reports ──

// GET /api/accounts/summary — AR/AP/Revenue/Expense summary
app.get('/api/accounts/summary', authenticate, async (_req: AuthRequest, res: Response) => {
  const invoices = await (prisma as any).invoice.findMany({ where: { status: { not: 'Cancelled' } } });
  const salesInvoices = invoices.filter((i: any) => i.invoiceType === 'Sales');
  const purchaseInvoices = invoices.filter((i: any) => i.invoiceType === 'Purchase');

  const totalAR = salesInvoices.reduce((s: number, i: any) => s + (Number(i.totalAmount) - Number(i.paidAmount)), 0);
  const totalAP = purchaseInvoices.reduce((s: number, i: any) => s + (Number(i.totalAmount) - Number(i.paidAmount)), 0);
  const totalRevenue = salesInvoices.reduce((s: number, i: any) => s + Number(i.totalAmount), 0);
  const totalExpense = purchaseInvoices.reduce((s: number, i: any) => s + Number(i.totalAmount), 0);
  const totalReceived = salesInvoices.reduce((s: number, i: any) => s + Number(i.paidAmount), 0);
  const totalPaid = purchaseInvoices.reduce((s: number, i: any) => s + Number(i.paidAmount), 0);

  const overdueInvoices = invoices.filter((i: any) => {
    if (i.status === 'Paid' || i.status === 'Cancelled') return false;
    return i.dueDate < new Date().toISOString().split('T')[0];
  }).length;

  res.json({ totalAR, totalAP, totalRevenue, totalExpense, totalReceived, totalPaid, overdueInvoices, invoiceCount: invoices.length });
});

// ── Start server ──────────────────────────────────────────────────────────────
// ── ใบเบิกค่าออกต่างจังหวัด (Travel Expense Claims) ─────────────────────────

function travelExpenseDocNumber() {
  const now = new Date();
  const y = now.getFullYear().toString().slice(-2);
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const rand = String(Math.floor(Math.random() * 1000)).padStart(3, '0');
  return `TE${y}${m}${d}-${rand}`;
}

app.get('/api/travel-expenses', authenticate, async (_req: AuthRequest, res: Response) => {
  const claims = await (prisma as any).travelExpenseClaim.findMany({
    orderBy: { createdAt: 'desc' },
    include: { items: true },
  });
  res.json(claims);
});

app.get('/api/travel-expenses/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const claim = await (prisma as any).travelExpenseClaim.findUnique({
    where: { id: req.params.id },
    include: { items: true },
  });
  if (!claim) { res.status(404).json({ error: 'Not found' }); return; }
  res.json(claim);
});

app.post('/api/travel-expenses', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...data } = req.body;
  if (!data.staffName || !data.purpose || !data.claimDate || !data.province || !data.travelDateFrom || !data.travelDateTo) {
    res.status(400).json({ error: 'staffName, purpose, claimDate, province, travelDateFrom and travelDateTo are required' });
    return;
  }
  const advanceItems: any[] = (items || []).filter((i: any) => i.itemType === 'advance');
  const reimbursedItems: any[] = (items || []).filter((i: any) => i.itemType === 'reimbursed');
  const totalAdvance = advanceItems.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const totalReimbursed = reimbursedItems.reduce((s: number, i: any) => s + Number(i.amount), 0);
  const claim = await (prisma as any).travelExpenseClaim.create({
    data: {
      ...data,
      docNumber: data.docNumber || travelExpenseDocNumber(),
      status: data.status || 'Draft',
      totalAdvance,
      totalReimbursed,
      createdBy: req.user?.username,
      items: (items || []).length > 0 ? {
        create: (items as any[]).map((i: any) => ({
          itemType: i.itemType,
          description: i.description || '',
          amount: Number(i.amount),
          receiptNo: i.receiptNo || null,
          remark: i.remark || null,
        })),
      } : undefined,
    },
    include: { items: true },
  });
  await logActivity({
    entityType: 'TravelExpenseClaim', entityId: claim.id, entityName: claim.docNumber,
    action: 'created', newValues: { docNumber: claim.docNumber, staffName: claim.staffName, province: claim.province },
    performedBy: req.user?.username,
  });
  res.status(201).json(claim);
});

app.put('/api/travel-expenses/:id', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { items, ...data } = req.body;
  const existing = await (prisma as any).travelExpenseClaim.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }

  if (items !== undefined) {
    await (prisma as any).travelExpenseItem.deleteMany({ where: { claimId: req.params.id } });
  }
  const advanceItems: any[] = items !== undefined ? (items as any[]).filter((i: any) => i.itemType === 'advance') : [];
  const reimbursedItems: any[] = items !== undefined ? (items as any[]).filter((i: any) => i.itemType === 'reimbursed') : [];
  const totalAdvance = items !== undefined ? advanceItems.reduce((s: number, i: any) => s + Number(i.amount), 0) : existing.totalAdvance;
  const totalReimbursed = items !== undefined ? reimbursedItems.reduce((s: number, i: any) => s + Number(i.amount), 0) : existing.totalReimbursed;

  const updateData: any = { ...data, totalAdvance, totalReimbursed };
  if (items !== undefined && (items as any[]).length > 0) {
    updateData.items = {
      create: (items as any[]).map((i: any) => ({
        itemType: i.itemType,
        description: i.description || '',
        amount: Number(i.amount),
        receiptNo: i.receiptNo || null,
        remark: i.remark || null,
      })),
    };
  }
  const claim = await (prisma as any).travelExpenseClaim.update({
    where: { id: req.params.id },
    data: updateData,
    include: { items: true },
  });
  await logActivity({
    entityType: 'TravelExpenseClaim', entityId: claim.id, entityName: claim.docNumber,
    action: 'updated', performedBy: req.user?.username,
  });
  res.json(claim);
});

app.patch('/api/travel-expenses/:id/status', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  const { status } = req.body;
  const valid = ['Draft', 'Submitted', 'Approved', 'Paid', 'Cancelled'];
  if (!valid.includes(status)) { res.status(400).json({ error: 'Invalid status' }); return; }
  const existing = await (prisma as any).travelExpenseClaim.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  const updateData: any = { status };
  if (status === 'Approved') {
    updateData.approvedBy = req.user?.username;
    updateData.approvedAt = new Date().toISOString().split('T')[0];
  }
  const claim = await (prisma as any).travelExpenseClaim.update({
    where: { id: req.params.id },
    data: updateData,
    include: { items: true },
  });
  await logActivity({
    entityType: 'TravelExpenseClaim', entityId: claim.id, entityName: claim.docNumber,
    action: `status_changed_to_${status}`, performedBy: req.user?.username,
  });
  res.json(claim);
});

app.delete('/api/travel-expenses/:id', authenticate, requireAdmin, async (req: AuthRequest, res: Response): Promise<void> => {
  const existing = await (prisma as any).travelExpenseClaim.findUnique({ where: { id: req.params.id } });
  if (!existing) { res.status(404).json({ error: 'Not found' }); return; }
  await (prisma as any).travelExpenseClaim.delete({ where: { id: req.params.id } });
  await logActivity({
    entityType: 'TravelExpenseClaim', entityId: req.params.id, entityName: existing.docNumber,
    action: 'deleted', performedBy: req.user?.username,
  });
  res.json({ ok: true });
});

// ── Global error handler ─────────────────────────────────────────────────────
// Catches any unhandled error from routes / middleware (multer, prisma, JSON parse).
// Returns a safe message without leaking stack traces.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  console.error('[ErrorHandler]', req.method, req.path, err);
  if (res.headersSent) return;
  const status =
    err?.status ||
    err?.statusCode ||
    (err?.code === 'LIMIT_FILE_SIZE' ? 413 :
     err?.code === 'P2025' ? 404 :   // Prisma: record not found
     err?.code === 'P2002' ? 409 :   // Prisma: unique constraint
     500);
  const message =
    typeof err?.message === 'string' && err.message.length < 300
      ? err.message
      : 'Internal server error';
  res.status(status).json({ error: message });
});

async function startServer(): Promise<void> {
  await prisma.$connect();
  await ensureFixedWarehouses();
  await ensureSparePartCatalogColumnsSafe();
  await ensureSparePartItemTable();
  await syncAllSparePartTrackedStock();
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server', err);
  process.exit(1);
});
