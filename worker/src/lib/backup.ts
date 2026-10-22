import type { Db } from '../db/client';
import * as schema from '../db/schema';

// D1 has no filesystem, so a byte-for-byte SQLite file copy (the original's
// `VACUUM INTO` nightly backup) isn't possible from inside a Worker binding.
// Instead:
//  - Point-in-time recovery is covered by D1's built-in Time Travel (30-day
//    automatic PITR, always on, no code needed) — this is strictly better
//    than the original's 7-day retention.
//  - This module provides a *logical* JSON export of every table, stored in
//    R2, for portability/inspection/DR outside of Cloudflare's own tooling.
const RETENTION_DAYS = 30;
const BACKUP_PREFIX = 'backups/auto-';

// Explicit table list (mirrors every sqliteTable in db/schema.ts) — safer than
// runtime introspection since relations() exports aren't distinguishable by shape alone.
const TABLE_NAMES = [
  'users', 'passwordChangeRequests', 'robotModels', 'customers', 'warehouses', 'robots', 'maintenanceTickets',
  'maintenanceSchedules', 'maintenancePlans', 'maintenanceVisits', 'maintenancePlanRobots', 'usedParts',
  'activityLogs', 'attachments', 'robotLoans', 'robotLoanItems', 'deliveryNotes',
  'deliveryNoteItems', 'spareParts', 'sparePartItems', 'trashItems', 'purchaseOrders', 'purchaseOrderItems',
  'notifications', 'projectRequests', 'projectRequestItems', 'accounts', 'invoices',
  'invoiceItems', 'payments', 'contacts', 'sites', 'materialRequests', 'materialRequestItems',
  'journalEntries', 'journalEntryLines', 'budgets', 'travelExpenseClaims', 'travelExpenseItems',
] as const;

export async function exportAllTablesToJson(db: Db): Promise<Record<string, unknown[]>> {
  const dump: Record<string, unknown[]> = {};
  for (const name of TABLE_NAMES) {
    const table = (schema as Record<string, any>)[name];
    dump[name] = await db.select().from(table);
  }
  return dump;
}

export async function runAutoBackup(db: Db, bucket: R2Bucket): Promise<{ key: string; size: number } | null> {
  try {
    const dump = await exportAllTablesToJson(db);
    const json = JSON.stringify({ exportedAt: new Date().toISOString(), tables: dump });
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const key = `${BACKUP_PREFIX}${ts}.json`;
    await bucket.put(key, json, { httpMetadata: { contentType: 'application/json' } });

    // Prune backups older than RETENTION_DAYS.
    const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
    const listed = await bucket.list({ prefix: BACKUP_PREFIX });
    for (const obj of listed.objects) {
      if (obj.uploaded.getTime() < cutoff) await bucket.delete(obj.key);
    }
    return { key, size: json.length };
  } catch (err) {
    console.error('[AutoBackup] Error:', err);
    return null;
  }
}
