import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient } from '@prisma/client';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbUrl = process.env.DATABASE_URL ?? 'file:./dev.db';
const catalogPath = path.resolve(__dirname, '../data/pudu-spare-catalog.json');

const adapter = new PrismaLibSql({ url: dbUrl });
const prisma = new PrismaClient({ adapter });

async function ensureCatalogColumns() {
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
    } catch (error) {
      const message = String(error?.message ?? '');
      if (!message.includes('duplicate column name')) throw error;
    }
  }
}

async function main() {
  if (!fs.existsSync(catalogPath)) {
    throw new Error(`Catalog file not found: ${catalogPath}`);
  }

  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  if (!Array.isArray(catalog)) {
    throw new Error('Catalog JSON must be an array');
  }

  await prisma.$connect();
  await ensureCatalogColumns();

  let created = 0;
  let updated = 0;

  for (const item of catalog) {
    const sku = String(item.sku ?? '').trim();
    const name = String(item.name ?? '').trim();
    if (!sku || !name) continue;

    const data = {
      sku,
      name,
      description: item.description ? String(item.description) : null,
      category: item.category ? String(item.category) : null,
      productModel: item.productModel ? String(item.productModel) : null,
      partType: item.partType ? String(item.partType) : null,
      unitPrice: Number(item.unitPrice ?? 0) || 0,
      supplier: item.supplier ? String(item.supplier) : 'PUDU',
      status: item.status ? String(item.status) : 'active',
      sourceFile: item.sourceFile ? String(item.sourceFile) : null,
      sourceSheet: item.sourceSheet ? String(item.sourceSheet) : null,
    };

    const existing = await prisma.sparePart.findUnique({ where: { sku } });
    if (existing) {
      await prisma.sparePart.update({
        where: { sku },
        data,
      });
      updated++;
    } else {
      await prisma.sparePart.create({
        data: {
          ...data,
          stock: 0,
          minStock: 0,
        },
      });
      created++;
    }
  }

  console.log(`Seeded PUDU catalog from ${path.basename(catalogPath)} | created=${created} updated=${updated}`);
}

main()
  .catch((error) => {
    console.error('[seed-pudu-catalog] failed', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
