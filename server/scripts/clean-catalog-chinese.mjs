// Brings the Express/Prisma database in line with the Chinese-free spare-part catalog
// (server/data/pudu-spare-catalog.json). Every UPDATE only rewrites a column that still contains
// Chinese, so names or descriptions edited since the import are left alone, and stock/prices are
// never touched. Safe to run more than once.
//
//   cd server && node scripts/clean-catalog-chinese.mjs          (uses DATABASE_URL)
//   cd server && node scripts/clean-catalog-chinese.mjs --dry-run
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Matches CJK ideographs and full-width forms without needing them written out literally.
const hasChinese = (col) => `${col} GLOB ('*[' || char(19968) || '-' || char(40959) || char(65281) || '-' || char(65374) || ']*')`;
const TEXT_COLUMNS = ['name', 'description', 'sourceFile', 'sourceSheet'];

export function buildStatements(catalog, exportRows) {
  const statements = [];
  const catalogSkus = new Set();

  for (const item of catalog) {
    catalogSkus.add(item.sku);
    const code = item.sku.match(/\d{5}-\d{6}/)?.[0];
    // A SKU that carries a note (e.g. "21510-000177 (Yellow-Green)") was stored with the Chinese note.
    const hadNote = !!code && item.sku !== code;

    const sets = [];
    const params = [];
    for (const column of TEXT_COLUMNS) {
      if (item[column] === null || item[column] === undefined) continue;
      sets.push(`"${column}" = CASE WHEN ${hasChinese(`"${column}"`)} THEN ? ELSE "${column}" END`);
      params.push(item[column]);
    }
    if (sets.length) {
      const where = hadNote
        ? `("sku" = ? OR ("sku" LIKE ? AND ${hasChinese('"sku"')}))`
        : '"sku" = ?';
      const whereParams = hadNote ? [item.sku, `%${code}%`] : [item.sku];
      statements.push({ sql: `UPDATE "SparePart" SET ${sets.join(', ')} WHERE ${where}`, params: [...params, ...whereParams] });
    }
    if (hadNote) {
      statements.push({
        sql: `UPDATE "SparePart" SET "sku" = ? WHERE "sku" LIKE ? AND ${hasChinese('"sku"')} AND NOT EXISTS (SELECT 1 FROM "SparePart" WHERE "sku" = ?)`,
        params: [item.sku, `%${code}%`, item.sku],
      });
    }
  }

  // Parts that exist in the database but not in the catalog (older imports): names/descriptions only.
  const seen = new Set();
  for (const row of exportRows) {
    if (catalogSkus.has(row.sku) || seen.has(row.sku)) continue;
    seen.add(row.sku);
    const sets = [];
    const params = [];
    for (const column of ['name', 'description']) {
      if (row[column] === null || row[column] === undefined) continue;
      sets.push(`"${column}" = CASE WHEN ${hasChinese(`"${column}"`)} THEN ? ELSE "${column}" END`);
      params.push(row[column]);
    }
    if (sets.length) statements.push({ sql: `UPDATE "SparePart" SET ${sets.join(', ')} WHERE "sku" = ?`, params: [...params, row.sku] });
  }
  return statements;
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const catalog = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../data/pudu-spare-catalog.json'), 'utf8'));
  const exportRows = JSON.parse(fs.readFileSync(path.resolve(__dirname, './_pudu-parts-export.json'), 'utf8'));
  const statements = buildStatements(catalog, exportRows);
  if (dryRun) {
    console.log(`Dry run: ${statements.length} guarded UPDATE statements would run.`);
    return;
  }

  const { PrismaLibSql } = await import('@prisma/adapter-libsql');
  const { PrismaClient } = await import('@prisma/client');
  const prisma = new PrismaClient({ adapter: new PrismaLibSql({ url: process.env.DATABASE_URL ?? 'file:./dev.db' }) });
  try {
    await prisma.$connect();
    const before = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "SparePart" WHERE ${hasChinese('"name"')} OR ${hasChinese('"description"')}`);
    for (const { sql, params } of statements) await prisma.$executeRawUnsafe(sql, ...params);
    const after = await prisma.$queryRawUnsafe(`SELECT COUNT(*) AS n FROM "SparePart" WHERE ${hasChinese('"name"')} OR ${hasChinese('"description"')}`);
    console.log(`Spare parts with Chinese in name/description: ${Number(before[0].n)} -> ${Number(after[0].n)}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
