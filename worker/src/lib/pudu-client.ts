// Pudu Robotics open-platform API client — ported from server/puduapi/puduClient.ts.
// Original used Node's `https.request` + `crypto.createHmac`/`createHash('md5')`;
// Workers has no MD5 in Web Crypto, so `md5.ts` supplies a pure-JS implementation,
// and HMAC-SHA1 signing uses Web Crypto's `crypto.subtle`.
import { md5 } from './md5';

const baseHostname = 'css-open-platform.pudutech.com';
const basePath = '/pudu-entry';

interface PuduRequestOptions {
  path: string;
  method: 'GET' | 'POST';
  body?: Record<string, unknown>;
}

export interface PuduStore {
  shop_id: string;
  shop_name: string;
  company_id: string;
  company_name: string;
}

export interface PuduRobot {
  mac: string;
  sn: string;
  product_code: string;
  shop_id: string;
  shop_name: string;
}

export interface PuduStoreWithRobots extends PuduStore {
  robot_count: number;
  robots: PuduRobot[];
}

function sortBody(body: Record<string, unknown>): string {
  const keys = Object.keys(body).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const value = body[key];
    if (Array.isArray(value)) {
      if (value.length > 0) parts.push(`${key}=${value.map((v) => encodeURIComponent(v)).join(',')}`);
      else parts.push(key);
    } else if (value === null || value === undefined || value === '') {
      parts.push(key);
    } else {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.join('&');
}

async function hmacSha1Base64(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function makePuduRequest<T = unknown>(env: { PUDUAPIKEY: string; PUDUAPIsecret: string }, opts: PuduRequestOptions): Promise<T> {
  const dateTime = new Date().toUTCString();
  const bodyToSign = opts.body || {};
  const sortedBodyStr = sortBody(bodyToSign);
  const bodyJsonStr = opts.method === 'POST' ? JSON.stringify(bodyToSign) : '';

  // NOTE: original computes base64(hexDigestString) rather than base64(rawDigestBytes) —
  // preserved exactly here since it must match what Pudu's servers expect.
  const contentMD5 = opts.method === 'POST' && bodyJsonStr ? btoa(md5(bodyJsonStr)) : '';

  const fullPath = `${basePath}${opts.path}`;
  const queryPath = opts.method === 'GET' && sortedBodyStr ? `${fullPath}?${sortedBodyStr}` : fullPath;
  const signingPath = opts.method === 'GET' && sortedBodyStr ? `${fullPath}?${decodeURIComponent(sortedBodyStr)}` : fullPath;

  const signingStr = [
    `x-date: ${dateTime}`,
    opts.method,
    'application/json',
    'application/json',
    contentMD5,
    signingPath,
  ].join('\n');

  const signing = await hmacSha1Base64(env.PUDUAPIsecret, signingStr);
  const authorization = `hmac id="${env.PUDUAPIKEY}", algorithm="hmac-sha1", headers="x-date", signature="${signing}"`;

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'Content-MD5': contentMD5,
    'x-date': dateTime,
    Authorization: authorization,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const res = await fetch(`https://${baseHostname}${queryPath}`, {
      method: opts.method,
      headers,
      body: opts.method === 'POST' && bodyJsonStr ? bodyJsonStr : undefined,
      signal: controller.signal,
    });
    const responseBody = await res.text();
    if (!res.ok) {
      throw new Error(`Pudu API ${opts.path} returned HTTP ${res.status}: ${responseBody.slice(0, 500)}`);
    }
    try {
      return JSON.parse(responseBody) as T;
    } catch {
      throw new Error(`Failed to parse response: ${responseBody}`);
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Pudu API ${opts.path} timed out after 20s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

type PuduEnv = { PUDUAPIKEY: string; PUDUAPIsecret: string };

export async function healthCheck(env: PuduEnv) {
  return makePuduRequest(env, { path: '/data-open-platform-service/v1/api/healthCheck', method: 'GET', body: {} });
}

export async function getStoreList(env: PuduEnv, pageNo = 1, pageSize = 10): Promise<{ data: { count: number; list: PuduStore[] }; message: string }> {
  return makePuduRequest(env, {
    path: '/data-open-platform-service/v1/api/shop',
    method: 'GET',
    body: { page_no: pageNo, page_size: pageSize },
  });
}

// Pudu's API always returns 10 stores/page regardless of page_size.
export async function getAllStores(env: PuduEnv): Promise<PuduStore[]> {
  const stores: PuduStore[] = [];
  const seen = new Set<string>();
  let pageNo = 1;
  while (true) {
    const res = await getStoreList(env, pageNo, 10);
    const list: PuduStore[] = res?.data?.list || [];
    if (list.length === 0) break;
    let addedAny = false;
    for (const s of list) {
      if (!seen.has(s.shop_id)) { seen.add(s.shop_id); stores.push(s); addedAny = true; }
    }
    const total = res?.data?.count || 0;
    if (!addedAny || stores.length >= total) break;
    pageNo++;
  }
  return stores;
}

export async function getStoreRobots(env: PuduEnv, shopId: number | string, limit = 100, offset = 0): Promise<{ data: { count: number; list: PuduRobot[] }; message: string }> {
  return makePuduRequest(env, {
    path: '/data-open-platform-service/v1/api/robot',
    method: 'GET',
    body: { shop_id: shopId, limit, offset },
  });
}

// Paginates with offset (max 100/page) and filters out unassigned robots (shop_id = '0').
export async function getAllRobots(env: PuduEnv): Promise<PuduRobot[]> {
  const robots: PuduRobot[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await makePuduRequest<{ data: { count: number; list: PuduRobot[] }; message: string }>(env, {
      path: '/data-open-platform-service/v1/api/robot',
      method: 'GET',
      body: { limit, offset },
    });
    const list = res?.data?.list || [];
    const total = res?.data?.count || 0;
    robots.push(...list);
    if (robots.length >= total || list.length < limit) break;
    offset += limit;
  }
  return robots.filter((r) => r.shop_id && r.shop_id !== '0');
}

export async function getStoreMap(env: PuduEnv, shopId: string, mapName: string, deviceWidth = 1280, deviceHeight = 720) {
  return makePuduRequest(env, {
    path: '/data-open-platform-service/v1/api/map',
    method: 'GET',
    body: { shop_id: shopId, map_name: mapName, device_width: deviceWidth, device_height: deviceHeight },
  });
}

// Merges /api/shop (accessible stores w/ company info) with stores inferred from
// /api/robot data, so stores that own robots but aren't in the shop list still show up.
export async function getShopsSummary(env: PuduEnv): Promise<PuduStoreWithRobots[]> {
  const [stores, allRobots] = await Promise.all([getAllStores(env), getAllRobots(env)]);

  const storeMap = new Map<string, PuduStore>();
  for (const store of stores) storeMap.set(store.shop_id, store);

  const robotsByShop = new Map<string, PuduRobot[]>();
  for (const robot of allRobots) {
    if (!robotsByShop.has(robot.shop_id)) robotsByShop.set(robot.shop_id, []);
    robotsByShop.get(robot.shop_id)!.push(robot);
    if (!storeMap.has(robot.shop_id)) {
      storeMap.set(robot.shop_id, { shop_id: robot.shop_id, shop_name: robot.shop_name, company_id: '', company_name: '' });
    }
  }

  return Array.from(storeMap.values()).map((store) => ({
    ...store,
    robot_count: robotsByShop.get(store.shop_id)?.length || 0,
    robots: robotsByShop.get(store.shop_id) || [],
  }));
}
