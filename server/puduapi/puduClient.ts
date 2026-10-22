import 'dotenv/config';
import crypto from 'crypto';
import https from 'https';

const apiAppKey = process.env.PUDUAPIKEY!;
const apiAppSecret = process.env.PUDUAPIsecret!;
const baseHostname = 'css-open-platform.pudutech.com';
const basePath = '/pudu-entry';

interface PuduRequestOptions {
  path: string;
  method: 'GET' | 'POST';
  body?: Record<string, any>;
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

function sortBody(body: Record<string, any>): string {
  const keys = Object.keys(body).sort();
  const parts: string[] = [];
  keys.forEach(key => {
    const value = body[key];
    if (Array.isArray(value)) {
      if (value.length > 0) parts.push(`${key}=${value.map(v => encodeURIComponent(v)).join(',')}`);
      else parts.push(key);
    } else if (value === null || value === undefined || value === '') {
      parts.push(key);
    } else {
      parts.push(`${key}=${encodeURIComponent(String(value))}`);
    }
  });
  return parts.join('&');
}

function makePuduRequest<T = any>(opts: PuduRequestOptions): Promise<T> {
  return new Promise((resolve, reject) => {
    const dateTime = new Date().toUTCString();
    const bodyToSign = opts.body || {};
    const sortedBodyStr = sortBody(bodyToSign);
    const bodyJsonStr = opts.method === 'POST' ? JSON.stringify(bodyToSign) : '';

    const contentMD5 = opts.method === 'POST' && bodyJsonStr
      ? Buffer.from(crypto.createHash('md5').update(bodyJsonStr, 'utf8').digest('hex')).toString('base64')
      : '';

    const fullPath = `${basePath}${opts.path}`;
    const queryPath = opts.method === 'GET' && sortedBodyStr
      ? `${fullPath}?${sortedBodyStr}`
      : fullPath;

    const signingPath = opts.method === 'GET' && sortedBodyStr
      ? `${fullPath}?${decodeURIComponent(sortedBodyStr)}`
      : fullPath;

    const signingStr = [
      `x-date: ${dateTime}`,
      opts.method,
      'application/json',
      'application/json',
      contentMD5,
      signingPath,
    ].join('\n');

    const signing = crypto.createHmac('sha1', apiAppSecret).update(signingStr, 'utf8').digest('base64');
    const authorization = `hmac id="${apiAppKey}", algorithm="hmac-sha1", headers="x-date", signature="${signing}"`;

    const headers: Record<string, string | number> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Content-MD5': contentMD5,
      'x-date': dateTime,
      Authorization: authorization,
    };
    if (opts.method === 'POST') headers['Content-Length'] = Buffer.byteLength(bodyJsonStr);

    const reqOptions = {
      hostname: baseHostname,
      port: 443,
      path: queryPath,
      method: opts.method,
      headers,
    };

    let responseBody = '';
    const req = https.request(reqOptions, res => {
      res.on('data', chunk => (responseBody += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status < 200 || status >= 300) {
          reject(new Error(`Pudu API ${opts.path} returned HTTP ${status}: ${responseBody.slice(0, 500)}`));
          return;
        }
        try {
          resolve(JSON.parse(responseBody) as T);
        } catch {
          reject(new Error(`Failed to parse response: ${responseBody}`));
        }
      });
    });
    req.on('error', reject);
    // ponytail: 20s ceiling so a hung Pudu connection can't pin an express handler forever
    req.setTimeout(20_000, () => req.destroy(new Error(`Pudu API ${opts.path} timed out after 20s`)));
    if (opts.method === 'POST' && bodyJsonStr) req.write(bodyJsonStr);
    req.end();
  });
}

/** Health check */
export async function healthCheck() {
  return makePuduRequest({
    path: '/data-open-platform-service/v1/api/healthCheck',
    method: 'GET',
    body: {},
  });
}

/** Get paginated list of stores (shops) - API always returns 10 per page regardless of page_size */
export async function getStoreList(pageNo = 1, pageSize = 10): Promise<{ data: { count: number; list: PuduStore[] }; message: string }> {
  return makePuduRequest({
    path: '/data-open-platform-service/v1/api/shop',
    method: 'GET',
    body: { page_no: pageNo, page_size: pageSize },
  });
}

/**
 * Get ALL stores accessible via our API key by paginating through all pages.
 * Pudu API returns 10 stores per page (page_size is ignored).
 */
export async function getAllStores(): Promise<PuduStore[]> {
  const stores: PuduStore[] = [];
  const seen = new Set<string>();
  let pageNo = 1;
  while (true) {
    const res = await getStoreList(pageNo, 10);
    const list: PuduStore[] = res?.data?.list || [];
    if (list.length === 0) break;
    let addedAny = false;
    for (const s of list) {
      if (!seen.has(s.shop_id)) {
        seen.add(s.shop_id);
        stores.push(s);
        addedAny = true;
      }
    }
    // Stop if no new stores were added (API repeating same page) or reached total
    const total: number = res?.data?.count || 0;
    if (!addedAny || stores.length >= total) break;
    pageNo++;
  }
  return stores;
}

/** Get robots in a specific store - API returns { data: { count, list }, message, trace_id } */
export async function getStoreRobots(shopId: number | string, limit = 100, offset = 0): Promise<{ data: { count: number; list: PuduRobot[] }; message: string }> {
  return makePuduRequest({
    path: '/data-open-platform-service/v1/api/robot',
    method: 'GET',
    body: { shop_id: shopId, limit, offset },
  });
}

/**
 * Get ALL robots across all stores by paginating with offset (max 100/page).
 */
export async function getAllRobots(): Promise<PuduRobot[]> {
  const robots: PuduRobot[] = [];
  let offset = 0;
  const limit = 100;
  while (true) {
    const res = await makePuduRequest<{ data: { count: number; list: PuduRobot[] }; message: string }>({
      path: '/data-open-platform-service/v1/api/robot',
      method: 'GET',
      body: { limit, offset },
    });
    const list: PuduRobot[] = res?.data?.list || [];
    const total: number = res?.data?.count || 0;
    robots.push(...list);
    if (robots.length >= total || list.length < limit) break;
    offset += limit;
  }
  // Filter out unassigned robots (shop_id = '0')
  return robots.filter(r => r.shop_id && r.shop_id !== '0');
}

/**
 * Get a map image/data for a store's navigation map.
 * Requires the exact map_name as configured in the Pudu robot setup.
 * Returns image data URL or null if map not found.
 */
export async function getStoreMap(shopId: string, mapName: string, deviceWidth = 1280, deviceHeight = 720) {
  return makePuduRequest({
    path: '/data-open-platform-service/v1/api/map',
    method: 'GET',
    body: { shop_id: shopId, map_name: mapName, device_width: deviceWidth, device_height: deviceHeight },
  });
}

/**
 * Get all stores with their robot counts aggregated.
 * Merges two sources:
 *  1. Stores from /api/shop (10 accessible, have company info)
 *  2. Stores inferred from /api/robot data (45 unique shops, have shop_id + shop_name)
 * Result: all ~45 stores that own at least one robot OR are in the shop list.
 */
export async function getShopsSummary(): Promise<PuduStoreWithRobots[]> {
  const [stores, allRobots] = await Promise.all([
    getAllStores(),
    getAllRobots(),
  ]);

  // Build a map of known stores (with company info) from the shop API
  const storeMap = new Map<string, PuduStore>();
  for (const store of stores) {
    storeMap.set(store.shop_id, store);
  }

  // Group robots by shop_id, and also collect any stores not in the shop API
  const robotsByShop = new Map<string, PuduRobot[]>();
  for (const robot of allRobots) {
    if (!robotsByShop.has(robot.shop_id)) robotsByShop.set(robot.shop_id, []);
    robotsByShop.get(robot.shop_id)!.push(robot);

    // If this store isn't in the shop API list, add a minimal store entry from robot data
    if (!storeMap.has(robot.shop_id)) {
      storeMap.set(robot.shop_id, {
        shop_id: robot.shop_id,
        shop_name: robot.shop_name,
        company_id: '',
        company_name: '',
      });
    }
  }

  return Array.from(storeMap.values()).map(store => ({
    ...store,
    robot_count: robotsByShop.get(store.shop_id)?.length || 0,
    robots: robotsByShop.get(store.shop_id) || [],
  }));
}
