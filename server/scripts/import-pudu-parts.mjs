/**
 * Backward-compatible entrypoint for seeding the embedded PUDU spare-parts catalog.
 *
 * Usage:
 *   node server/scripts/import-pudu-parts.mjs
 *
 * This now reads the committed JSON catalog in `server/data/pudu-spare-catalog.json`
 * and upserts it into the SparePart table by SKU.
 */

import './seed-pudu-catalog.mjs';
