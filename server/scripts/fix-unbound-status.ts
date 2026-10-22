import 'dotenv/config';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';
import XLSX from 'xlsx';

const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
const adapter = new PrismaLibSql({ url: dbUrl });
const prisma = new PrismaClient({ adapter } as any);

async function main() {
  const wb = XLSX.readFile(process.argv[2] || './unbound-machines.xlsx');
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows: any[] = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const sns = rows.slice(1).map((r: any) => String(r[2] || '').trim()).filter(Boolean);
  console.log('SNs in Excel:', sns.length);

  const robots = await prisma.robot.findMany({
    where: { serialNumber: { in: sns } },
    select: { id: true, serialNumber: true, status: true, customerId: true },
  });

  console.log('Found in DB:', robots.length);
  const byStatus: Record<string, number> = {};
  robots.forEach(r => { byStatus[r.status] = (byStatus[r.status] || 0) + 1; });
  console.log('By status:', JSON.stringify(byStatus, null, 2));

  const wrong = robots.filter(r => r.status !== 'In Stock');
  console.log(`\nNeed to fix: ${wrong.length} robots`);
  wrong.forEach(r => console.log(`  - ${r.serialNumber} [${r.status}] → In Stock`));

  if (wrong.length === 0) {
    console.log('Nothing to fix!');
    return;
  }

  // Fix them
  let fixed = 0;
  for (const r of wrong) {
    await prisma.robot.update({
      where: { id: r.id },
      data: { status: 'In Stock', customerId: null },
    });
    fixed++;
  }
  console.log(`\nFixed ${fixed} robots → "In Stock"`);
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
