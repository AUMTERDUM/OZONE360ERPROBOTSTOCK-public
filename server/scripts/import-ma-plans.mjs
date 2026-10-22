// Import MA Plans from Pudu "Store List" Excel export.
// Usage: node scripts/import-ma-plans.mjs "C:/path/to/Store List.xlsx" [--dry]
//
// For each row:
//   - Find Customer by name (case-insensitive). Create if missing.
//   - Create a MaintenancePlan with startDate = Creation Time (date part),
//     intervalMonths = 3. Skip if a plan already exists for that customer.
//   - Visits are generated server-side via existing /api/ma-plans (regenerate).

import xlsx from 'xlsx';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaLibSql } from '@prisma/adapter-libsql';

const dbUrl = process.env.DATABASE_URL || 'file:./dev.db';
const adapter = new PrismaLibSql({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCMonth(dt.getUTCMonth() + months);
  return dt.toISOString().slice(0, 10);
}

async function regeneratePlanVisits(planId) {
  const plan = await prisma.maintenancePlan.findUnique({
    where: { id: planId },
    include: { visits: true },
  });
  if (!plan) return { created: 0 };
  const interval = plan.intervalMonths || 3;
  const today = new Date().toISOString().slice(0, 10);
  const endLimit = plan.endDate || addMonths(today, 36);

  const existingDates = new Set(plan.visits.map(v => v.scheduledDate));
  let date = plan.startDate;
  let visitNumber = 0;
  let created = 0;

  while (date <= endLimit) {
    visitNumber += 1;
    if (!existingDates.has(date)) {
      await prisma.maintenanceVisit.create({
        data: { planId, visitNumber, scheduledDate: date, status: 'Scheduled' },
      });
      created += 1;
    }
    date = addMonths(plan.startDate, visitNumber * interval);
  }
  return { created };
}

async function main() {
  const args = process.argv.slice(2);
  const dry = args.includes('--dry');
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: node scripts/import-ma-plans.mjs <xlsx> [--dry]');
    process.exit(1);
  }
  const abs = path.resolve(file);
  console.log('Reading:', abs, dry ? '(DRY RUN)' : '');

  const wb = xlsx.readFile(abs);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(ws, { defval: null });

  const allCustomers = await prisma.customer.findMany();
  const byName = new Map(allCustomers.map(c => [c.name.trim().toLowerCase(), c]));

  const existingPlans = await prisma.maintenancePlan.findMany();
  const planByCustomer = new Map(existingPlans.map(p => [p.customerId, p]));

  let createdCustomers = 0, createdPlans = 0, skipped = 0, totalVisits = 0;

  for (const row of rows) {
    const name = (row['Store Name'] || '').toString().trim();
    const creation = (row['Creation Time'] || '').toString().trim();
    const status = (row['Status'] || '').toString().trim();
    if (!name || !creation) { skipped++; continue; }

    // Parse date portion (handles "2026-04-06 18:20:53" or Date objects)
    let startDate;
    if (row['Creation Time'] instanceof Date) {
      startDate = row['Creation Time'].toISOString().slice(0, 10);
    } else {
      const m = creation.match(/^(\d{4}-\d{2}-\d{2})/);
      if (!m) { console.warn('  ! Bad date for', name, '->', creation); skipped++; continue; }
      startDate = m[1];
    }

    // Find or create customer
    let cust = byName.get(name.toLowerCase());
    if (!cust) {
      if (dry) {
        console.log(`  + would create customer: ${name}`);
      } else {
        cust = await prisma.customer.create({
          data: {
            name,
            contactPerson: '',
            email: '',
            phone: row['Contact Information'] || '',
            address: row['Detailed Address'] || '',
            type: 'customer',
          },
        });
        byName.set(name.toLowerCase(), cust);
      }
      createdCustomers++;
    }

    // Skip if plan exists
    if (cust && planByCustomer.has(cust.id)) {
      skipped++;
      continue;
    }

    if (dry) {
      console.log(`  + would create MA plan: ${name} start=${startDate} interval=3m status=${status}`);
      createdPlans++;
      continue;
    }

    if (!cust) continue;
    const plan = await prisma.maintenancePlan.create({
      data: {
        customerId: cust.id,
        startDate,
        endDate: null,
        intervalMonths: 3,
        notes: `Imported from Store List · ${status}`,
        active: status.toLowerCase() === 'open',
      },
    });
    const { created } = await regeneratePlanVisits(plan.id);
    createdPlans++;
    totalVisits += created;
    console.log(`  ✓ ${name}  start=${startDate}  visits=${created}`);
  }

  console.log('\n--- Summary ---');
  console.log('Customers created :', createdCustomers);
  console.log('MA Plans created  :', createdPlans);
  console.log('Visits generated  :', totalVisits);
  console.log('Skipped rows      :', skipped);
  console.log('Total rows in file:', rows.length);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
