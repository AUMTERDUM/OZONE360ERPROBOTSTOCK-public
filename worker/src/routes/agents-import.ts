import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { customers } from '../db/schema';
import { logActivity } from '../lib/activity-log';
import { readFirstSheetRows, fuzzyNameMatch } from '../lib/xlsx-helpers';
import { authenticate, requireAdmin } from '../middleware/auth';
import type { AppEnv } from '../types';

function parseAgentHeaders(headers: string[]) {
  const find = (needle: string) => headers.findIndex((h) => h.toLowerCase().includes(needle));
  return {
    iCode: find('client number'),
    iName: find('agent company'),
    iAccount: find('proxy account'),
    iAddress: find('detailed address'),
    iStatus: find('status'),
    iStores: find('expanding'),
    iDevices: headers.findIndex((h) => h.toLowerCase().includes('activated') || h.toLowerCase().includes('bound')),
  };
}

export const agentsImportRoutes = new Hono<AppEnv>();

agentsImportRoutes.post('/preview', authenticate, requireAdmin, async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
    const rawRows = readFirstSheetRows(await file.arrayBuffer());
    if (rawRows.length < 2) return c.json({ error: 'ไฟล์ไม่มีข้อมูล' }, 400);

    const headers = (rawRows[0] as unknown[]).map((h) => String(h ?? '').trim());
    const { iCode, iName, iAccount, iAddress, iStatus, iStores, iDevices } = parseAgentHeaders(headers);
    if (iName < 0) return c.json({ error: 'ไม่พบคอลัมน์ Agent Company Name ในไฟล์' }, 400);

    const dataRows = rawRows.slice(1).filter((r) => (r as unknown[]).some((cell) => cell !== undefined && cell !== ''));

    const db = getDb(c.env.DB);
    const allCustomers = await db.select({ id: customers.id, name: customers.name, agentCode: customers.agentCode, type: customers.type }).from(customers);
    const customerByName = new Map(allCustomers.map((cust) => [cust.name.toLowerCase(), cust]));
    const customerByCode = new Map<string, typeof allCustomers[number]>();
    for (const cust of allCustomers) if (cust.agentCode) customerByCode.set(cust.agentCode.toLowerCase(), cust);

    const agents: Record<string, unknown>[] = [];
    for (const r of dataRows) {
      const row = r as unknown[];
      const name = iName >= 0 ? String(row[iName] ?? '').trim() : '';
      if (!name) continue;
      const agentCode = iCode >= 0 ? String(row[iCode] ?? '').trim() : '';
      const account = iAccount >= 0 ? String(row[iAccount] ?? '').trim() : '';
      const address = iAddress >= 0 ? String(row[iAddress] ?? '').trim() : '';
      const status = iStatus >= 0 ? String(row[iStatus] ?? '').trim() : '';
      const stores = iStores >= 0 ? String(row[iStores] ?? '').trim() : '';
      const devices = iDevices >= 0 ? String(row[iDevices] ?? '').trim() : '';

      const existing = customerByName.get(name.toLowerCase()) || (agentCode ? customerByCode.get(agentCode.toLowerCase()) : null);
      const fuzzyExisting = !existing ? allCustomers.find((cust) => cust.type !== 'agent' && fuzzyNameMatch(name, cust.name)) : null;

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
      created: agents.filter((r) => r.action === 'create').length,
      updated: agents.filter((r) => r.action === 'update').length,
      merged: agents.filter((r) => r.action === 'merge').length,
      skipped: agents.filter((r) => r.action === 'skip').length,
    };
    return c.json({ totalRows: dataRows.length, summary, agents });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Preview failed' }, 500);
  }
});

agentsImportRoutes.post('/confirm', authenticate, requireAdmin, async (c) => {
  const user = c.get('user');
  try {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: 'No file uploaded' }, 400);
    const rawRows = readFirstSheetRows(await file.arrayBuffer());
    if (rawRows.length < 2) return c.json({ error: 'ไฟล์ไม่มีข้อมูล' }, 400);

    const headers = (rawRows[0] as unknown[]).map((h) => String(h ?? '').trim());
    const { iCode, iName, iAccount, iAddress } = parseAgentHeaders(headers);
    if (iName < 0) return c.json({ error: 'ไม่พบคอลัมน์ Agent Company Name' }, 400);

    const dataRows = rawRows.slice(1).filter((r) => (r as unknown[]).some((cell) => cell !== undefined && cell !== ''));
    const db = getDb(c.env.DB);
    const allCustomers = await db.select({ id: customers.id, name: customers.name, agentCode: customers.agentCode, type: customers.type }).from(customers);
    const customerByName = new Map(allCustomers.map((cust) => [cust.name.toLowerCase(), cust]));
    const customerByCode = new Map<string, typeof allCustomers[number]>();
    for (const cust of allCustomers) if (cust.agentCode) customerByCode.set(cust.agentCode.toLowerCase(), cust);

    const stats = { created: 0, updated: 0, merged: 0, skipped: 0, errors: [] as string[] };

    for (const r of dataRows) {
      const row = r as unknown[];
      const name = iName >= 0 ? String(row[iName] ?? '').trim() : '';
      if (!name) continue;
      const code = iCode >= 0 ? String(row[iCode] ?? '').trim() : '';
      const account = iAccount >= 0 ? String(row[iAccount] ?? '').trim() : '';
      const address = iAddress >= 0 ? String(row[iAddress] ?? '').trim() : '';

      const existing = customerByName.get(name.toLowerCase()) || (code ? customerByCode.get(code.toLowerCase()) : null);
      const fuzzyExisting = !existing ? allCustomers.find((cust) => cust.type !== 'agent' && fuzzyNameMatch(name, cust.name)) : null;
      const target = existing || fuzzyExisting;

      try {
        if (target) {
          if (target.agentCode === code && target.type === 'agent') {
            stats.skipped++;
          } else {
            await db.update(customers).set({ type: 'agent', agentCode: code || undefined, ...(address ? { address } : {}) }).where(eq(customers.id, target.id));
            if (fuzzyExisting) stats.merged++;
            else stats.updated++;
          }
        } else {
          const newId = randomUUID();
          await db.insert(customers).values({ id: newId, name, contactPerson: account || '', email: '', phone: '', address: address || '', type: 'agent', agentCode: code || null });
          customerByName.set(name.toLowerCase(), { id: newId, name, agentCode: code || null, type: 'agent' });
          stats.created++;
        }
      } catch (e) {
        stats.errors.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    await logActivity(db, { entityType: 'AgentImport', entityId: 'xlsx', action: 'import-agents', performedBy: user.username, newValues: stats });
    return c.json({ totalRows: dataRows.length, ...stats });
  } catch (err) {
    return c.json({ error: err instanceof Error ? err.message : 'Import failed' }, 500);
  }
});
