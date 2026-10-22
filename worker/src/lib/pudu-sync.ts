import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { customers, robotModels, robots, maintenancePlans } from '../db/schema';
import { logActivity } from './activity-log';
import { getShopsSummary, type PuduStoreWithRobots } from './pudu-client';

export interface SyncResult {
  modelsCreated: number;
  modelsUpdated: number;
  customersCreated: number;
  customersUpdated: number;
  robotsCreated: number;
  robotsUpdated: number;
  errors: string[];
}

type PuduEnv = { PUDUAPIKEY: string; PUDUAPIsecret: string };

async function syncStore(db: Db, store: PuduStoreWithRobots, result: SyncResult): Promise<void> {
  const existing = await db.query.customers.findFirst({ where: eq(customers.puduShopId, store.shop_id) });
  if (existing) {
    await db.update(customers).set({ name: store.shop_name, puduCompanyId: store.company_id }).where(eq(customers.id, existing.id));
    result.customersUpdated++;
  } else {
    await db.insert(customers).values({
      id: randomUUID(), name: store.shop_name, contactPerson: store.company_name || '-',
      email: `${store.shop_id}@pudu.auto`, phone: '-', address: '-',
      puduShopId: store.shop_id, puduCompanyId: store.company_id,
    });
    result.customersCreated++;
  }

  const customer = await db.query.customers.findFirst({ where: eq(customers.puduShopId, store.shop_id) });
  if (!customer) return;

  for (const robot of store.robots) {
    try {
      let model = await db.query.robotModels.findFirst({ where: eq(robotModels.puduProductCode, robot.product_code) });
      if (!model) {
        const newModelId = randomUUID();
        await db.insert(robotModels).values({
          id: newModelId, name: robot.product_code, type: 'AMR', payloadCapacity: '-', batteryLife: '-',
          puduProductCode: robot.product_code,
        });
        model = await db.query.robotModels.findFirst({ where: eq(robotModels.id, newModelId) });
        result.modelsCreated++;
      }

      const existingRobot = await db.query.robots.findFirst({ where: eq(robots.serialNumber, robot.sn) });
      if (existingRobot) {
        await db.update(robots).set({
          puduMac: robot.mac, customerId: customer.id, modelId: model!.id,
          // Only an in-stock robot becomes Assigned. Anything else (In Maintenance from an open
          // ticket or loan, Missing, ...) is owned by its own workflow and must survive the 6-hourly sync.
          ...(existingRobot.status === 'In Stock' ? { status: 'Assigned' } : {}),
        }).where(eq(robots.id, existingRobot.id));
        result.robotsUpdated++;
      } else {
        let robotDate = new Date().toISOString().split('T')[0];
        const maPlan = await db.query.maintenancePlans.findFirst({ where: eq(maintenancePlans.customerId, customer.id) });
        if (maPlan?.startDate) robotDate = maPlan.startDate;
        await db.insert(robots).values({
          id: randomUUID(), serialNumber: robot.sn, puduMac: robot.mac, modelId: model!.id,
          customerId: customer.id, status: 'Assigned', purchaseDate: robotDate,
        });
        result.robotsCreated++;
      }
    } catch (e) {
      result.errors.push(`Robot ${robot.sn}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

export async function syncFromPudu(db: Db, env: PuduEnv, shopId?: string): Promise<SyncResult> {
  const result: SyncResult = {
    modelsCreated: 0, modelsUpdated: 0, customersCreated: 0, customersUpdated: 0,
    robotsCreated: 0, robotsUpdated: 0, errors: [],
  };

  const summary = await getShopsSummary(env);
  const stores = shopId ? summary.filter((s) => s.shop_id === shopId) : summary;

  for (const store of stores) {
    try {
      await syncStore(db, store, result);
    } catch (e) {
      result.errors.push(`Store ${store.shop_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  await logActivity(db, {
    entityType: 'Customer', entityId: shopId || 'all',
    entityName: shopId ? `Store ${shopId}` : 'All Stores',
    action: 'synced', newValues: result,
  });

  return result;
}
