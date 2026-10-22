import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const DIST_INDEX = resolve(process.cwd(), 'dist/index.html');
const PAGES_ASSET_ORIGIN = 'https://your-project.pages.dev';

const html = await readFile(DIST_INDEX, 'utf8');
const patched = html
  .replace(/src="\/assets\//g, `src="${PAGES_ASSET_ORIGIN}/assets/`)
  .replace(/href="\/assets\//g, `href="${PAGES_ASSET_ORIGIN}/assets/`);

if (patched !== html) {
  await writeFile(DIST_INDEX, patched, 'utf8');
}
