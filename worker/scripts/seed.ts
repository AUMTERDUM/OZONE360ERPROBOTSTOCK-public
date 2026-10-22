// Generates seed.sql (admin user + sample robot models) for local D1.
// Run: npx tsx scripts/seed.ts   then   npx wrangler d1 execute ozone360-erp-dev --local --file=./seed.sql
import { randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { writeFileSync } from 'node:fs';

async function main() {
  const adminId = randomUUID();
  const adminPassword = await bcrypt.hash('ChangeMe123', 10);

  const modelRows = [
    { id: randomUUID(), name: 'BellaBot', type: 'Delivery', payloadCapacity: '10kg', batteryLife: '10h' },
    { id: randomUUID(), name: 'PuduBot 2', type: 'Delivery', payloadCapacity: '30kg', batteryLife: '12h' },
  ];

  const esc = (s: string) => s.replace(/'/g, "''");

  const sql = [
    `INSERT INTO User (id, username, password, role, failedAttempts) VALUES ('${adminId}', 'admin', '${esc(adminPassword)}', 'ADMIN', 0);`,
    ...modelRows.map(m =>
      `INSERT INTO RobotModel (id, name, type, payloadCapacity, batteryLife) VALUES ('${m.id}', '${esc(m.name)}', '${esc(m.type)}', '${esc(m.payloadCapacity)}', '${esc(m.batteryLife)}');`
    ),
  ].join('\n');

  writeFileSync('./seed.sql', sql + '\n');
  console.log('Wrote seed.sql — admin / ChangeMe123');
}

main();
