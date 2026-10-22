import { inArray } from 'drizzle-orm';
import type { Context } from 'hono';
import { getDb } from '../db/client';
import { cacheVersions } from '../db/schema';
import type { AppEnv } from '../types';

// Tables whose writes are counted by triggers in drizzle/0009_cache_version.sql.
export type CachedTable = 'RobotModel' | 'Robot' | 'Customer' | 'MaintenanceTicket' | 'SparePart' | 'SparePartItem' | 'Warehouse';

// Per-isolate memo of whole list responses. D1's free tier meters rows *scanned*,
// and the app re-fetches these lists on every page load — so a hit reads only the
// CacheVersion rows for the tables involved instead of every row in them.
const memo = new Map<string, { stamp: string; body: string }>();

// `key` must identify the response fully (route + any query variant); `tables`
// must list every table `load` reads, or edits to the missing one will be served stale.
export async function cachedJson(c: Context<AppEnv>, key: string, tables: CachedTable[], load: () => Promise<unknown>): Promise<Response> {
  const db = getDb(c.env.DB);
  // Read versions BEFORE loading: a write racing the load then just costs a miss next
  // time, whereas reading after could store pre-write data under the post-write stamp.
  let stamp: string | null = null;
  try {
    const rows = await db.select().from(cacheVersions).where(inArray(cacheVersions.key, tables));
    if (rows.length === tables.length) {
      stamp = rows.map((r) => `${r.key}:${r.version}`).sort().join('|');
    }
  } catch {
    // CacheVersion missing (migration not applied yet) — serve uncached.
  }

  const headers = { 'Content-Type': 'application/json; charset=UTF-8' };
  const hit = stamp ? memo.get(key) : undefined;
  if (hit && hit.stamp === stamp) return c.body(hit.body, 200, headers);

  const body = JSON.stringify(await load());
  if (stamp) memo.set(key, { stamp, body });
  return c.body(body, 200, headers);
}
