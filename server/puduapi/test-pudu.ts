import 'dotenv/config';
import { getShopsSummary, getStoreList, getStoreRobots, healthCheck } from './puduClient.js';
import fs from 'fs';

async function main() {
  const results: Record<string, any> = {};

  results.health = await healthCheck().catch(e => ({ error: e.message }));
  results.storeList = await getStoreList(1, 10).catch(e => ({ error: e.message }));
  
  // Get robots from first store to see raw response format
  const storeListData: any = results.storeList;
  const firstShopId = storeListData?.data?.list?.[0]?.shop_id 
    || storeListData?.data?.[0]?.shop_id 
    || storeListData?.list?.[0]?.shop_id;
  
  if (firstShopId) {
    results.robotsInFirstStore = await getStoreRobots(firstShopId, 10).catch(e => ({ error: e.message }));
  }

  fs.writeFileSync('puduapi/raw-result.json', JSON.stringify(results, null, 2), 'utf8');
  console.log('Written to raw-result.json');
  console.log(JSON.stringify(results, null, 2));
}

main().catch(console.error);
