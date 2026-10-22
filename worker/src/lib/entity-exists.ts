import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import {
  robots, customers, robotModels, maintenanceTickets, maintenanceSchedules,
  warehouses, spareParts, purchaseOrders, projectRequests, invoices, accounts,
  robotLoans, robotLoanItems, deliveryNotes, travelExpenseClaims, maintenanceVisits,
  siteSurveys,
} from '../db/schema';

// Maps an entityType string to its table — mirrors server/index.ts's entityExists().
const ENTITY_TABLES: Record<string, any> = {
  Robot: robots,
  Customer: customers,
  RobotModel: robotModels,
  MaintenanceTicket: maintenanceTickets,
  MaintenanceSchedule: maintenanceSchedules,
  Warehouse: warehouses,
  SparePart: spareParts,
  PurchaseOrder: purchaseOrders,
  ProjectRequest: projectRequests,
  Invoice: invoices,
  Account: accounts,
  RobotLoan: robotLoans,
  RobotLoanItem: robotLoanItems,
  DeliveryNote: deliveryNotes,
  'delivery-note': deliveryNotes,
  TravelExpenseClaim: travelExpenseClaims,
  MaintenanceVisit: maintenanceVisits,
  SiteSurvey: siteSurveys,
};

export async function entityExists(db: Db, entityType: string, entityId: string): Promise<boolean> {
  const table = ENTITY_TABLES[entityType];
  if (!table || !entityId) return false;
  const row = await db.select({ id: table.id }).from(table).where(eq(table.id, entityId)).limit(1);
  return row.length > 0;
}
