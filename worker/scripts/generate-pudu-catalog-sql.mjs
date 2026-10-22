import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');
const catalogPath = path.resolve(repoRoot, 'server', 'data', 'pudu-spare-catalog.json');
const outputPath = path.resolve(repoRoot, 'worker', 'seed-pudu-catalog.sql');

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function makeIdFromSku(sku) {
  return `sp-${sku.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`.slice(0, 120);
}

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
if (!Array.isArray(catalog)) {
  throw new Error('Catalog JSON must be an array');
}

const lines = [
  `INSERT INTO Warehouse (id, name, notes, parentId) VALUES ('fixed-ozone-bkk', 'OZONE-BKK', NULL, NULL)
ON CONFLICT(id) DO UPDATE SET name = excluded.name;`,
  `INSERT INTO Warehouse (id, name, notes, parentId) VALUES ('fixed-ozone-cnx', 'OZONE-CNX', NULL, NULL)
ON CONFLICT(id) DO UPDATE SET name = excluded.name;`,
];

for (const item of catalog) {
  const sku = String(item.sku ?? '').trim();
  const name = String(item.name ?? '').trim();
  if (!sku || !name) continue;

  const id = makeIdFromSku(sku);
  const description = item.description ? String(item.description) : null;
  const category = item.category ? String(item.category) : null;
  const productModel = item.productModel ? String(item.productModel) : null;
  const partType = item.partType ? String(item.partType) : null;
  const supplier = item.supplier ? String(item.supplier) : 'PUDU';
  const status = item.status ? String(item.status) : 'active';
  const sourceFile = item.sourceFile ? String(item.sourceFile) : null;
  const sourceSheet = item.sourceSheet ? String(item.sourceSheet) : null;

  lines.push(
    `INSERT INTO SparePart (id, sku, name, description, category, productModel, partType, location, warehouseId, stock, minStock, unitPrice, supplier, status, sourceFile, sourceSheet)
VALUES (${sqlString(id)}, ${sqlString(sku)}, ${sqlString(name)}, ${sqlString(description)}, ${sqlString(category)}, ${sqlString(productModel)}, ${sqlString(partType)}, NULL, NULL, 0, 0, 0, ${sqlString(supplier)}, ${sqlString(status)}, ${sqlString(sourceFile)}, ${sqlString(sourceSheet)})
ON CONFLICT(sku) DO UPDATE SET
  name = excluded.name,
  description = excluded.description,
  category = excluded.category,
  productModel = excluded.productModel,
  partType = excluded.partType,
  supplier = excluded.supplier,
  status = excluded.status,
  sourceFile = excluded.sourceFile,
  sourceSheet = excluded.sourceSheet;`
  );
}

fs.writeFileSync(outputPath, `${lines.join('\n')}\n`);
console.log(`Generated ${outputPath} with ${catalog.length} catalog rows`);
