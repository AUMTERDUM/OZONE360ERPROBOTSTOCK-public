// Usage: node scripts/restore-from-backup.mjs ./backup.json [./restore.sql]
// The generated SQL is local-only; apply it with: wrangler d1 execute ozone360-erp-dev --local --file=./restore.sql
import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) throw new Error('Pass a backup JSON path');
const output = process.argv[3] || path.resolve('restore.sql');
const backup = JSON.parse(fs.readFileSync(input, 'utf8'));
if (!backup?.tables || typeof backup.tables !== 'object') throw new Error('Expected { exportedAt, tables } backup JSON');

const tableNames = {
  users: 'User', passwordChangeRequests: 'PasswordChangeRequest', robotModels: 'RobotModel', customers: 'Customer', warehouses: 'Warehouse', robots: 'Robot',
  maintenanceTickets: 'MaintenanceTicket', maintenanceSchedules: 'MaintenanceSchedule', maintenancePlans: 'MaintenancePlan', maintenanceVisits: 'MaintenanceVisit', maintenancePlanRobots: 'MaintenancePlanRobot',
  usedParts: 'UsedPart', activityLogs: 'ActivityLog', attachments: 'Attachment', robotLoans: 'RobotLoan', robotLoanItems: 'RobotLoanItem', deliveryNotes: 'DeliveryNote', deliveryNoteItems: 'DeliveryNoteItem',
  spareParts: 'SparePart', sparePartItems: 'SparePartItem', trashItems: 'TrashItem', purchaseOrders: 'PurchaseOrder', purchaseOrderItems: 'PurchaseOrderItem', notifications: 'Notification',
  projectRequests: 'ProjectRequest', projectRequestItems: 'ProjectRequestItem', accounts: 'Account', invoices: 'Invoice', invoiceItems: 'InvoiceItem', payments: 'Payment', contacts: 'Contact', sites: 'Site',
  materialRequests: 'MaterialRequest', materialRequestItems: 'MaterialRequestItem', journalEntries: 'JournalEntry', journalEntryLines: 'JournalEntryLine', budgets: 'Budget', travelExpenseClaims: 'TravelExpenseClaim', travelExpenseItems: 'TravelExpenseItem',
};
// Parent tables precede children so foreign keys can be enabled during restore.
const order = ['users', 'passwordChangeRequests', 'robotModels', 'customers', 'warehouses', 'robots', 'maintenanceTickets', 'maintenanceSchedules', 'maintenancePlans', 'maintenanceVisits', 'maintenancePlanRobots', 'usedParts', 'activityLogs', 'attachments', 'robotLoans', 'robotLoanItems', 'deliveryNotes', 'deliveryNoteItems', 'spareParts', 'sparePartItems', 'trashItems', 'purchaseOrders', 'purchaseOrderItems', 'notifications', 'projectRequests', 'projectRequestItems', 'accounts', 'invoices', 'invoiceItems', 'payments', 'contacts', 'sites', 'materialRequests', 'materialRequestItems', 'journalEntries', 'journalEntryLines', 'budgets', 'travelExpenseClaims', 'travelExpenseItems'];
const quote = (value) => value === null || value === undefined ? 'NULL' : typeof value === 'boolean' ? (value ? '1' : '0') : typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
const sql = ['PRAGMA foreign_keys = OFF;', ...order.flatMap(key => {
  // Older backups lack some tables — skip them rather than DELETE-ing live rows with nothing to put back.
  const rows = backup.tables[key];
  const table = tableNames[key];
  if (!table || !Array.isArray(rows)) return [];
  const statements = [`DELETE FROM "${table}";`];
  for (const row of rows) {
    const columns = Object.keys(row);
    if (!columns.length) continue;
    statements.push(`INSERT INTO "${table}" (${columns.map(c => `"${c}"`).join(', ')}) VALUES (${columns.map(c => quote(row[c])).join(', ')});`);
  }
  return statements;
}), 'PRAGMA foreign_keys = ON;'];
fs.writeFileSync(output, `${sql.join('\n')}\n`);
console.log(`Wrote ${output}`);
console.log(`Apply locally: wrangler d1 execute ozone360-erp-dev --local --file=${output}`);
