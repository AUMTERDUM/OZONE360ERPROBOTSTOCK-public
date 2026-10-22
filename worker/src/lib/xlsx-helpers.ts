import * as XLSX from 'xlsx';
import { inArray } from 'drizzle-orm';
import type { Db } from '../db/client';
import { robots, robotModels, customers } from '../db/schema';

// Matches server/index.ts's fuzzyNameMatch: strips everything except a-z, 0-9, and
// Thai/CJK ranges (U+0E00-U+9FFF) before comparing.
const NON_WORD_CHARS = new RegExp('[^a-z0-9\\u0e00-\\u9fff]', 'g');
const NON_WORD_SPLIT = new RegExp('[^a-z0-9\\u0e00-\\u9fff]+');

export function fuzzyNameMatch(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(NON_WORD_CHARS, '');
  const an = norm(a), bn = norm(b);
  if (an.length >= 4 && bn.includes(an)) return true;
  if (bn.length >= 4 && an.includes(bn)) return true;
  const words = (s: string) => s.toLowerCase().split(NON_WORD_SPLIT).filter((w) => w.length >= 4);
  const aw = new Set(words(a));
  return words(b).some((w) => aw.has(w));
}

// SN prefix → model name lookup (derived from Pudu Cloud data).
const SN_PREFIX_MODEL_MAP: Record<string, string> = {
  '8SV': 'BellaBot', 'SV1': 'BellaBot',
  '811': 'PUDU CC1',
  '826': 'PUDU T300',
  '808': 'FlashBot', 'FBB': 'FlashBot', '680': 'FlashBot',
  '817': 'PuduBot2', '6e0': 'PuduBot2',
  '83A': 'PUDU T600 Underride',
  '866': 'PUDU MT1', '899': 'PUDU MT1 Vac',
  '8HB': 'HolaBot',
  '8PN': 'KettyBot', 'PNT': 'KettyBot',
  '8S2': 'PUDU SH1',
};

export function guessModelFromSN(sn: string): string {
  if (!sn || sn.length < 3) return '';
  const prefix = sn.slice(0, 3);
  return SN_PREFIX_MODEL_MAP[prefix] ?? SN_PREFIX_MODEL_MAP[prefix.toLowerCase()] ?? '';
}

export function readFirstSheetRows(buffer: ArrayBuffer): unknown[][] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1 }) as unknown[][];
}

export function readFirstSheetObjects(buffer: ArrayBuffer): Record<string, unknown>[] {
  const wb = XLSX.read(buffer, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { defval: null }) as Record<string, unknown>[];
}

export async function parsePuduXlsx(buffer: ArrayBuffer): Promise<{ headers: string[]; dataRows: unknown[][]; isRobotFile: boolean; isStoreFile: boolean }> {
  const rows = readFirstSheetRows(buffer);
  if (rows.length < 2) throw new Error('File has no data rows');
  const headers: string[] = (rows[0] as unknown[]).map((h) => String(h ?? '').trim());
  const dataRows = rows.slice(1).filter((r) => (r as unknown[]).some((c) => c !== undefined && c !== ''));
  const isRobotFile = headers.includes('SN(PID)') || headers.includes('MAC address');
  const isStoreFile = headers.includes('Store Name') && headers.includes('Affiliated Agent Name');
  if (!isRobotFile && !isStoreFile) {
    throw new Error('Unrecognised file format. Expected Robot list or Store list from Pudu Cloud.');
  }
  return { headers, dataRows, isRobotFile, isStoreFile };
}

export interface RobotAction {
  sn: string; mac: string | null; modelName: string; storeName: string; ownerName: string;
  status: string; warrantyExpiresAt: string | null; action: 'create' | 'update' | 'skip' | 'error';
  newModel?: boolean; guessedModel?: boolean; reason?: string; changes?: string[];
}

// Reads DB, computes per-row actions — no writes.
export async function computeRobotActions(db: Db, headers: string[], dataRows: unknown[][]): Promise<RobotAction[]> {
  const col = (name: string) => headers.indexOf(name);
  const iSN = col('SN(PID)'), iMAC = col('MAC address');
  const iModel = col('Product Name'), iStore = col('Affiliated Store');
  const iClient = col('Affiliated Client');
  const iStatus = col('Status'), iInstall = col('Store installation time');
  const iWarranty = col('Remaining Warranty Days');
  const OZONE_NAMES_RC = ['ozone', 'ozone network'];
  const isOzoneClient = (n: string) => OZONE_NAMES_RC.some((o) => n.toLowerCase().includes(o));

  const allModels = await db.select({ id: robotModels.id, name: robotModels.name, puduProductCode: robotModels.puduProductCode }).from(robotModels);
  const allCustomers = await db.select({ id: customers.id, name: customers.name }).from(customers);
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const modelByName = new Map(allModels.map((m) => [m.name.toLowerCase(), m]));
  const modelByCode = new Map(allModels.filter((m) => m.puduProductCode).map((m) => [m.puduProductCode!.toLowerCase(), m]));
  const modelByNorm = new Map(allModels.map((m) => [norm(m.name), m]));
  const customerByName = new Map(allCustomers.map((c) => [c.name.toLowerCase(), c]));

  const row = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
  const snList = dataRows.map((r) => String(row(r, iSN) ?? '').trim()).filter(Boolean);
  const existingRobots = snList.length
    ? await db.select({
        serialNumber: robots.serialNumber, puduMac: robots.puduMac, modelId: robots.modelId,
        customerId: robots.customerId, status: robots.status, warrantyExpiresAt: robots.warrantyExpiresAt,
      }).from(robots).where(inArray(robots.serialNumber, snList))
    : [];
  const robotBySN = new Map(existingRobots.map((r) => [r.serialNumber, r]));

  const result: RobotAction[] = [];
  for (const r of dataRows) {
    const sn = String(row(r, iSN) ?? '').trim();
    if (!sn) continue;
    const mac = String(row(r, iMAC) ?? '').trim() || null;
    const rawModelName = String(row(r, iModel) ?? '').trim();
    const modelName = rawModelName || guessModelFromSN(sn);
    const guessedModel = !rawModelName && !!modelName;
    const storeName = String(row(r, iStore) ?? '').trim();
    const clientName = iClient >= 0 ? String(row(r, iClient) ?? '').trim() : '';
    const ownerName = (clientName && !isOzoneClient(clientName)) ? clientName : storeName;
    const rawStatus = String(row(r, iStatus) ?? '').trim();
    const installDate = row(r, iInstall) ? String(row(r, iInstall)).trim().slice(0, 10) : null;
    const warrantyDays = iWarranty >= 0 && row(r, iWarranty) !== undefined ? Number(row(r, iWarranty)) : null;
    const inStockStatuses = ['not activated', 'unbound', 'offline', 'deactivated'];
    const status = inStockStatuses.includes(rawStatus.toLowerCase()) ? 'In Stock' : 'Assigned';
    const model = modelByName.get(modelName.toLowerCase()) ?? modelByCode.get(modelName.toLowerCase()) ?? modelByNorm.get(norm(modelName)) ?? null;
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
      result.push({ sn, mac, modelName, storeName, ownerName, status, warrantyExpiresAt, action: changes.length > 0 ? 'update' : 'skip', guessedModel, changes });
    } else {
      result.push({ sn, mac, modelName, storeName, ownerName, status, warrantyExpiresAt, action: 'create', newModel: !model, guessedModel });
    }
  }
  return result;
}

export interface StoreAction {
  name: string; address: string; phone: string; agent: string;
  action: 'create' | 'update' | 'skip'; changes?: string[];
}

export async function computeStoreActions(db: Db, headers: string[], dataRows: unknown[][]): Promise<StoreAction[]> {
  const col = (name: string) => headers.indexOf(name);
  const iName = col('Store Name'), iContact = col('Contact Information');
  const iAddress = col('Detailed Address'), iAgent = col('Affiliated Agent Name');
  const row = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);

  const nameList = dataRows.map((r) => String(row(r, iName) ?? '').trim()).filter(Boolean);
  const existingList = nameList.length
    ? await db.select({ id: customers.id, name: customers.name, address: customers.address, phone: customers.phone })
        .from(customers).where(inArray(customers.name, nameList))
    : [];
  const existingByName = new Map(existingList.map((c) => [c.name, c]));

  const result: StoreAction[] = [];
  for (const r of dataRows) {
    const name = String(row(r, iName) ?? '').trim();
    if (!name) continue;
    const address = String(row(r, iAddress) ?? '').trim();
    const phone = String(row(r, iContact) ?? '').trim();
    const agent = String(row(r, iAgent) ?? '').trim();
    const existing = existingByName.get(name);
    if (existing) {
      const changes: string[] = [];
      if (address && existing.address !== address) changes.push(`Address → ${address}`);
      if (phone && existing.phone !== phone) changes.push(`Phone → ${phone}`);
      result.push({ name, address, phone, agent, action: changes.length > 0 ? 'update' : 'skip', changes });
    } else {
      result.push({ name, address, phone, agent, action: 'create' });
    }
  }
  return result;
}
