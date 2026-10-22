/**
 * fix-robots-excel.mjs
 * Syncs robot/customer data from "Installed Machine List" Excel to the local SQLite DB.
 *
 * Run: node server/scripts/fix-robots-excel.mjs [path-to-xlsx]
 */

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const sqlite3 = require('sqlite3').verbose();

// ── Config ────────────────────────────────────────────────────────────────────
const xlsxPath = process.argv[2] || './installed-machines.xlsx';
const dbPath = resolve(__dirname, '../dev.db');

// Synchronous SQLite helpers using verbose sqlite3
const db = new sqlite3.Database(dbPath);

function sql(query) {
  return new Promise((res, rej) => db.run(query, function(err) { err ? rej(err) : res(this.changes); }));
}

function sqlRows(query) {
  return new Promise((res, rej) => db.all(query, [], (err, rows) => err ? rej(err) : res(rows)));
}

async function main() {

// ── Read Excel ────────────────────────────────────────────────────────────────
const wb = XLSX.readFile(xlsxPath);
const excelRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });

// Normalize SN (trim whitespace)
const excelRobots = excelRows.map(r => ({
  sn: (r['SN(PID)'] || '').toString().trim().replace(/\s+/g, ''),
  mac: (r['MAC address'] || '').toString().trim(),
  store: (r['Affiliated Store'] || '').toString().trim(),
  model: (r['Product Name'] || '').toString().trim(),
  status: (r['Status'] || '').toString().trim(),
}));

console.log(`\nExcel robots: ${excelRobots.length}`);

// ── Read DB ───────────────────────────────────────────────────────────────────
const dbRobotRows = await sqlRows("SELECT serialNumber, customerId, status FROM Robot");
const dbRobots = dbRobotRows.reduce((m, r) => {
  m[r.serialNumber] = { customerId: r.customerId, status: r.status };
  return m;
}, {});

const dbCustomerRows = await sqlRows("SELECT id, name FROM Customer");
const dbCustomers = dbCustomerRows.reduce((m, r) => {
  m[r.name] = { id: r.id };
  return m;
}, {});

const dbModelRows = await sqlRows("SELECT id, name, puduProductCode FROM RobotModel");
const dbModels = dbModelRows.reduce((m, r) => {
  m[r.puduProductCode || r.name] = r.id;
  return m;
}, {});

console.log(`DB robots: ${Object.keys(dbRobots).length}`);
console.log(`DB customers: ${Object.keys(dbCustomers).length}`);

// ── Model name mapping from Excel "Product Name" to DB model id ───────────────
const modelMap = {
  'BellaBot': dbModels['BellaBot'],
  'KettyBot': dbModels['KettyBot'],
  'FlashBot': dbModels['FlashBot'],
  'HolaBot': dbModels['HolaBot'],
  'PuduBot2': dbModels['PuduBot2'],
  'PUDU CC1': dbModels['CC1'],
  'PUDU T300': dbModels['PuduT300'],
  'PUDU MT1': dbModels['MT1'],
  'PUDU SH1': dbModels['PuduSH1'],
  'PUDU T600 Underride': dbModels['PuduT600Underride'],
};

// ── Analysis ──────────────────────────────────────────────────────────────────
const toAdd = [];
const toFixCustomer = [];
const missingCustomers = new Set();

for (const robot of excelRobots) {
  if (!robot.sn) continue;

  let customerId = null;
  if (dbCustomers[robot.store]) {
    customerId = dbCustomers[robot.store].id;
  } else {
    missingCustomers.add(robot.store);
  }

  if (!dbRobots[robot.sn]) {
    toAdd.push({ ...robot, customerId });
  } else if (!dbRobots[robot.sn].customerId && customerId) {
    toFixCustomer.push({ sn: robot.sn, customerId, store: robot.store });
  }
}

console.log(`\n=== MISSING CUSTOMERS (will create) ===`);
missingCustomers.forEach(s => console.log(' -', s));

console.log(`\n=== ROBOTS TO ADD (${toAdd.length}) ===`);
toAdd.forEach(r => console.log(` SN: ${r.sn} | Store: ${r.store} | Model: ${r.model}`));

console.log(`\n=== ROBOTS WITH MISSING CUSTOMER TO FIX (${toFixCustomer.length}) ===`);
toFixCustomer.forEach(r => console.log(` SN: ${r.sn} → ${r.store}`));

// ── Apply Fixes ───────────────────────────────────────────────────────────────
let applied = 0;

// 1. Create missing customers
for (const storeName of missingCustomers) {
  if (dbCustomers[storeName]) continue;
  const id = `cust-${storeName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 16)}-${Date.now()}`.slice(0, 36);
  const safeName = storeName.replace(/'/g, "''");
  const email = storeName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) + '@pudu.auto';
  await sql(`INSERT OR IGNORE INTO Customer (id, name, contactPerson, email, phone, address) VALUES ('${id}','${safeName}','-','${email}','-','-')`);
  console.log(`\n✅ Created customer: ${storeName} (${id})`);
  dbCustomers[storeName] = { id };
  applied++;
}

// Re-resolve customerId for robots waiting on new customers
for (const robot of toAdd) {
  if (!robot.customerId && dbCustomers[robot.store]) robot.customerId = dbCustomers[robot.store].id;
}
for (const robot of toFixCustomer) {
  if (!robot.customerId && dbCustomers[robot.store]) robot.customerId = dbCustomers[robot.store].id;
}

// 2. Fix orphan robots
for (const fix of toFixCustomer) {
  if (!fix.customerId) { console.log(`⚠️  No customer found for ${fix.sn} (${fix.store}) — skipping`); continue; }
  await sql(`UPDATE Robot SET customerId='${fix.customerId}', status='Assigned' WHERE serialNumber='${fix.sn}'`);
  console.log(`✅ Fixed robot ${fix.sn} → ${fix.store}`);
  applied++;
}

// 3. Add missing robots
for (const robot of toAdd) {
  if (!robot.customerId) { console.log(`⚠️  No customer for ${robot.sn} (${robot.store}) — skipping`); continue; }
  const modelId = modelMap[robot.model];
  if (!modelId) { console.log(`⚠️  Unknown model for ${robot.sn}: ${robot.model} — skipping`); continue; }

  const id = `robot-${robot.sn.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16)}-${Date.now()}`.slice(0, 36);
  const status = robot.status === 'Activated' ? 'Assigned' : 'In Stock';
  await sql(`INSERT OR IGNORE INTO Robot (id, serialNumber, puduMac, modelId, customerId, status, purchaseDate) VALUES ('${id}','${robot.sn}','${robot.mac}','${modelId}','${robot.customerId}','${status}','2026-04-06')`);
  console.log(`✅ Added robot ${robot.sn} → ${robot.store} (${robot.model}, ${status})`);
  applied++;
}

console.log(`\n✅ Done. Applied ${applied} changes.`);

// ── Final verification ────────────────────────────────────────────────────────
const [totalRobots] = await sqlRows("SELECT COUNT(*) as cnt FROM Robot");
const [totalCustomers] = await sqlRows("SELECT COUNT(*) as cnt FROM Customer");
console.log(`DB now has: ${totalRobots.cnt} robots, ${totalCustomers.cnt} customers`);

db.close();
}

main().catch(e => { console.error(e); process.exit(1); });