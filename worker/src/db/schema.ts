import { sqliteTable, text, integer, real, index, uniqueIndex, primaryKey } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';

// Shared column helpers — mirrors Prisma's `String @id @default(uuid())` (uuid generated in app code)
// and `DateTime @default(now())` (stored as ISO-8601 text, matching Prisma's SQLite representation).
const id = () => text('id').primaryKey();
const timestampCol = (columnName: string) => text(columnName).notNull().default(sql`(CURRENT_TIMESTAMP)`);

// ── User ──────────────────────────────────────────────────────────────────────
export const users = sqliteTable('User', {
  id: id(),
  username: text('username').notNull().unique(),
  password: text('password').notNull(),
  role: text('role').notNull().default('ADMIN'),
  googleEmail: text('googleEmail').unique(),
  failedAttempts: integer('failedAttempts').notNull().default(0),
  lockedUntil: text('lockedUntil'),
  passwordChangedAt: text('passwordChangedAt'),
});

export const passwordChangeRequests = sqliteTable('PasswordChangeRequest', {
  id: id(),
  userId: text('userId').notNull().references(() => users.id, { onDelete: 'cascade' }),
  codeHash: text('codeHash').notNull(),
  newPassword: text('newPassword').notNull(),
  expiresAt: text('expiresAt').notNull(),
  usedAt: text('usedAt'),
  createdAt: timestampCol('createdAt'),
}, (t) => ({
  userIdx: index('PasswordChangeRequest_userId_idx').on(t.userId),
}));

// ── RobotModel ────────────────────────────────────────────────────────────────
export const robotModels = sqliteTable('RobotModel', {
  id: id(),
  sku: text('sku'),
  name: text('name').notNull(),
  type: text('type').notNull(),
  payloadCapacity: text('payloadCapacity').notNull(),
  batteryLife: text('batteryLife').notNull(),
  imageUrl: text('imageUrl'),
  puduProductCode: text('puduProductCode').unique(),
  /** MA checklist template: 'delivery' | 'industrial' | 'cleaning'. Null = guessed from the name. */
  maCategory: text('maCategory'),
});

export const robotModelsRelations = relations(robotModels, ({ many }) => ({
  robots: many(robots),
}));

// ── Customer ──────────────────────────────────────────────────────────────────
export const customers = sqliteTable('Customer', {
  id: id(),
  name: text('name').notNull(),
  contactPerson: text('contactPerson').notNull(),
  email: text('email').notNull(),
  phone: text('phone').notNull(),
  address: text('address').notNull(),
  logoUrl: text('logoUrl'),
  type: text('type').notNull().default('customer'),
  agentCode: text('agentCode'),
  puduShopId: text('puduShopId').unique(),
  puduCompanyId: text('puduCompanyId'),
  portalToken: text('portalToken').unique(),
});

// ── Warehouse (self-referencing hierarchy) ───────────────────────────────────
export const warehouses = sqliteTable('Warehouse', {
  id: id(),
  name: text('name').notNull(),
  notes: text('notes'),
  parentId: text('parentId'),
});

export const warehousesRelations = relations(warehouses, ({ one, many }) => ({
  parent: one(warehouses, { fields: [warehouses.parentId], references: [warehouses.id] }),
  children: many(warehouses),
  robots: many(robots),
  spareParts: many(spareParts),
}));

// ── Robot ─────────────────────────────────────────────────────────────────────
export const robots = sqliteTable('Robot', {
  id: id(),
  serialNumber: text('serialNumber').notNull().unique(),
  status: text('status').notNull(),
  purchaseDate: text('purchaseDate').notNull(),
  puduMac: text('puduMac'),
  notes: text('notes'),
  warrantyExpiresAt: text('warrantyExpiresAt'),
  archivedAt: text('archivedAt'),
  modelId: text('modelId').notNull().references(() => robotModels.id),
  customerId: text('customerId').references(() => customers.id),
  locationId: text('locationId').references(() => warehouses.id),
}, (t) => ({
  customerIdx: index('Robot_customerId_idx').on(t.customerId),
  modelIdx: index('Robot_modelId_idx').on(t.modelId),
  locationIdx: index('Robot_locationId_idx').on(t.locationId),
  statusIdx: index('Robot_status_idx').on(t.status),
}));

export const robotsRelations = relations(robots, ({ one, many }) => ({
  model: one(robotModels, { fields: [robots.modelId], references: [robotModels.id] }),
  customer: one(customers, { fields: [robots.customerId], references: [customers.id] }),
  location: one(warehouses, { fields: [robots.locationId], references: [warehouses.id] }),
  tickets: many(maintenanceTickets),
}));

// ── MaintenanceTicket ─────────────────────────────────────────────────────────
export const maintenanceTickets = sqliteTable('MaintenanceTicket', {
  id: id(),
  trackingToken: text('trackingToken').unique(),
  issueDescription: text('issueDescription').notNull(),
  status: text('status').notNull(),
  reportDate: text('reportDate').notNull(),
  resolution: text('resolution'),
  replacedParts: text('replacedParts'),
  issueImageUrl: text('issueImageUrl'),
  assignedTo: text('assignedTo'),
  priorityLevel: text('priorityLevel').notNull().default('Normal'),
  slaHours: integer('slaHours'),
  slaDueAt: text('slaDueAt'),
  slaBreachedAt: text('slaBreachedAt'),
  escalationLevel: integer('escalationLevel').notNull().default(0),
  robotId: text('robotId').notNull().references(() => robots.id),
  scheduleId: text('scheduleId'),
  customerId: text('customerId').references(() => customers.id),
}, (t) => ({
  robotIdx: index('MaintenanceTicket_robotId_idx').on(t.robotId),
  customerIdx: index('MaintenanceTicket_customerId_idx').on(t.customerId),
  scheduleIdx: index('MaintenanceTicket_scheduleId_idx').on(t.scheduleId),
  statusIdx: index('MaintenanceTicket_status_idx').on(t.status),
  assignedIdx: index('MaintenanceTicket_assignedTo_idx').on(t.assignedTo),
  reportDateIdx: index('MaintenanceTicket_reportDate_idx').on(t.reportDate),
}));

export const maintenanceTicketsRelations = relations(maintenanceTickets, ({ one, many }) => ({
  robot: one(robots, { fields: [maintenanceTickets.robotId], references: [robots.id] }),
  customer: one(customers, { fields: [maintenanceTickets.customerId], references: [customers.id] }),
  schedule: one(maintenanceSchedules, { fields: [maintenanceTickets.scheduleId], references: [maintenanceSchedules.id] }),
  usedParts: many(usedParts),
}));

// ── MaintenanceSchedule ───────────────────────────────────────────────────────
export const maintenanceSchedules = sqliteTable('MaintenanceSchedule', {
  id: id(),
  title: text('title').notNull(),
  robotId: text('robotId').notNull().references(() => robots.id),
  customerId: text('customerId').references(() => customers.id),
  frequencyDays: integer('frequencyDays').notNull(),
  leadDays: integer('leadDays').notNull().default(7),
  nextDueDate: text('nextDueDate').notNull(),
  lastGeneratedAt: text('lastGeneratedAt'),
  lastCompletedAt: text('lastCompletedAt'),
  assignedTo: text('assignedTo'),
  priorityLevel: text('priorityLevel').notNull().default('Normal'),
  notes: text('notes'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: timestampCol('createdAt'),
  updatedAt: text('updatedAt').notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

// ── MaintenancePlan / MaintenanceVisit (MA contracts) ────────────────────────
export const maintenancePlans = sqliteTable('MaintenancePlan', {
  id: id(),
  customerId: text('customerId').notNull().references(() => customers.id),
  startDate: text('startDate').notNull(),
  endDate: text('endDate'),
  intervalMonths: integer('intervalMonths').notNull().default(3),
  notes: text('notes'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: timestampCol('createdAt'),
  updatedAt: text('updatedAt').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  customerIdx: index('MaintenancePlan_customerId_idx').on(t.customerId),
}));

export const maintenanceVisits = sqliteTable('MaintenanceVisit', {
  id: id(),
  planId: text('planId').notNull().references(() => maintenancePlans.id, { onDelete: 'cascade' }),
  visitNumber: integer('visitNumber').notNull(),
  scheduledDate: text('scheduledDate').notNull(),
  status: text('status').notNull().default('Scheduled'),
  completedAt: text('completedAt'),
  technician: text('technician'),
  summary: text('summary'),
  reportJson: text('reportJson'),
  createdAt: timestampCol('createdAt'),
  updatedAt: text('updatedAt').notNull().default(sql`(CURRENT_TIMESTAMP)`),
}, (t) => ({
  planIdx: index('MaintenanceVisit_planId_idx').on(t.planId),
  dateIdx: index('MaintenanceVisit_scheduledDate_idx').on(t.scheduledDate),
  statusIdx: index('MaintenanceVisit_status_idx').on(t.status),
}));

// Robots covered by a plan. No rows = the plan covers all of the customer's robots.
export const maintenancePlanRobots = sqliteTable('MaintenancePlanRobot', {
  planId: text('planId').notNull().references(() => maintenancePlans.id, { onDelete: 'cascade' }),
  robotId: text('robotId').notNull().references(() => robots.id, { onDelete: 'cascade' }),
}, (t) => ({
  pk: primaryKey({ columns: [t.planId, t.robotId] }),
  robotIdx: index('MaintenancePlanRobot_robotId_idx').on(t.robotId),
}));

// ── SiteSurvey ────────────────────────────────────────────────────────────────
// One survey visit at a customer site, either the AMR (delivery robot) or the cleaning-robot
// questionnaire. `answers` holds every field of that questionnaire as JSON — the two forms
// share little beyond the header fields, so a flexible blob avoids a wide, half-empty table.
export const siteSurveys = sqliteTable('SiteSurvey', {
  id: id(),
  formType: text('formType').notNull(), // 'amr' | 'cleaning'
  siteName: text('siteName').notNull(),
  surveyDate: text('surveyDate'),
  engineerName: text('engineerName'),
  zone: text('zone'),
  customerId: text('customerId').references(() => customers.id),
  siteId: text('siteId').references(() => sites.id),
  answers: text('answers').notNull().default('{}'),
  createdBy: text('createdBy'),
  createdAt: timestampCol('createdAt'),
  updatedAt: text('updatedAt').notNull().default(sql`(CURRENT_TIMESTAMP)`),
});

export const maintenancePlansRelations = relations(maintenancePlans, ({ one, many }) => ({
  customer: one(customers, { fields: [maintenancePlans.customerId], references: [customers.id] }),
  visits: many(maintenanceVisits),
}));

export const maintenanceVisitsRelations = relations(maintenanceVisits, ({ one }) => ({
  plan: one(maintenancePlans, { fields: [maintenanceVisits.planId], references: [maintenancePlans.id] }),
}));

// ── UsedPart ──────────────────────────────────────────────────────────────────
export const usedParts = sqliteTable('UsedPart', {
  id: id(),
  ticketId: text('ticketId').notNull().references(() => maintenanceTickets.id, { onDelete: 'cascade' }),
  sparePartId: text('sparePartId').notNull().references(() => spareParts.id),
  quantity: integer('quantity').notNull(),
  note: text('note'),
}, (t) => ({
  ticketIdx: index('UsedPart_ticketId_idx').on(t.ticketId),
  sparePartIdx: index('UsedPart_sparePartId_idx').on(t.sparePartId),
}));

export const usedPartsRelations = relations(usedParts, ({ one }) => ({
  sparePart: one(spareParts, { fields: [usedParts.sparePartId], references: [spareParts.id] }),
  ticket: one(maintenanceTickets, { fields: [usedParts.ticketId], references: [maintenanceTickets.id] }),
}));

// ── ActivityLog ───────────────────────────────────────────────────────────────
export const activityLogs = sqliteTable('ActivityLog', {
  id: id(),
  entityType: text('entityType').notNull(),
  entityId: text('entityId').notNull(),
  entityName: text('entityName'),
  action: text('action').notNull(),
  oldValues: text('oldValues'),
  newValues: text('newValues'),
  performedBy: text('performedBy'),
  performedAt: timestampCol('performedAt'),
}, (t) => ({
  entityIdx: index('ActivityLog_entityType_entityId_idx').on(t.entityType, t.entityId),
  performedAtIdx: index('ActivityLog_performedAt_idx').on(t.performedAt),
}));

// ── Attachment ────────────────────────────────────────────────────────────────
export const attachments = sqliteTable('Attachment', {
  id: id(),
  elementType: text('elementType').notNull(),
  elementId: text('elementId').notNull(),
  attachmentType: text('attachmentType').notNull().default('other'),
  filename: text('filename').notNull(),
  originalName: text('originalName').notNull(),
  fileSize: integer('fileSize'),
  mimeType: text('mimeType'),
  uploadedBy: text('uploadedBy'),
  uploadedAt: timestampCol('uploadedAt'),
}, (t) => ({
  elementIdx: index('Attachment_elementType_elementId_idx').on(t.elementType, t.elementId),
}));

// ── RobotLoan / RobotLoanItem ─────────────────────────────────────────────────
export const robotLoans = sqliteTable('RobotLoan', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  purpose: text('purpose').notNull(),
  loanDate: text('loanDate').notNull(),
  expectedReturn: text('expectedReturn').notNull(),
  actualReturn: text('actualReturn'),
  status: text('status').notNull().default('Pending'),
  borrowerName: text('borrowerName').notNull(),
  borrowerPhone: text('borrowerPhone'),
  borrowerDept: text('borrowerDept'),
  customerId: text('customerId').references(() => customers.id),
  approvedBy: text('approvedBy'),
  approvedAt: text('approvedAt'),
  notes: text('notes'),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
});

export const robotLoanItems = sqliteTable('RobotLoanItem', {
  id: id(),
  loanId: text('loanId').notNull().references(() => robotLoans.id, { onDelete: 'cascade' }),
  robotId: text('robotId').notNull(),
  serialNumber: text('serialNumber').notNull(),
  modelName: text('modelName').notNull(),
  returnedAt: text('returnedAt'),
  condition: text('condition'),
}, (t) => ({
  robotIdx: index('RobotLoanItem_robotId_idx').on(t.robotId),
}));

export const robotLoansRelations = relations(robotLoans, ({ one, many }) => ({
  customer: one(customers, { fields: [robotLoans.customerId], references: [customers.id] }),
  items: many(robotLoanItems),
}));

// ── DeliveryNote / DeliveryNoteItem ───────────────────────────────────────────
export const deliveryNotes = sqliteTable('DeliveryNote', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  deliveryDate: text('deliveryDate').notNull(),
  customerId: text('customerId').notNull().references(() => customers.id),
  status: text('status').notNull().default('Pending'),
  recipientName: text('recipientName'),
  recipientDate: text('recipientDate'),
  senderName: text('senderName'),
  notes: text('notes'),
  installedAt: text('installedAt'),
  acceptedAt: text('acceptedAt'),
  trackingNumber: text('trackingNumber'),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
}, (t) => ({
  customerIdx: index('DeliveryNote_customerId_idx').on(t.customerId),
  statusIdx: index('DeliveryNote_status_idx').on(t.status),
  dateIdx: index('DeliveryNote_deliveryDate_idx').on(t.deliveryDate),
}));

export const deliveryNoteItems = sqliteTable('DeliveryNoteItem', {
  id: id(),
  deliveryNoteId: text('deliveryNoteId').notNull().references(() => deliveryNotes.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: integer('quantity').notNull(),
  remark: text('remark'),
  serialNumbers: text('serialNumbers').notNull(),
  sparePartId: text('sparePartId'),
});

export const deliveryNotesRelations = relations(deliveryNotes, ({ one, many }) => ({
  customer: one(customers, { fields: [deliveryNotes.customerId], references: [customers.id] }),
  items: many(deliveryNoteItems),
}));

// ── SparePart ─────────────────────────────────────────────────────────────────
export const spareParts = sqliteTable('SparePart', {
  id: id(),
  sku: text('sku').notNull().unique(),
  name: text('name').notNull(),
  description: text('description'),
  category: text('category'),
  productModel: text('productModel'),
  partType: text('partType'),
  location: text('location'),
  warehouseId: text('warehouseId').references(() => warehouses.id),
  stock: integer('stock').notNull().default(0),
  minStock: integer('minStock').notNull().default(0),
  unitPrice: real('unitPrice').notNull().default(0),
  supplier: text('supplier'),
  status: text('status'),
  sourceFile: text('sourceFile'),
  sourceSheet: text('sourceSheet'),
});

export const sparePartItems = sqliteTable('SparePartItem', {
  id: id(),
  sparePartId: text('sparePartId').notNull().references(() => spareParts.id, { onDelete: 'cascade' }),
  serialNumber: text('serialNumber').notNull(),
  receivedDate: text('receivedDate').notNull(),
  notes: text('notes'),
  warehouseId: text('warehouseId').references(() => warehouses.id),
  createdAt: timestampCol('createdAt'),
}, (t) => ({
  sparePartIdx: index('SparePartItem_sparePartId_idx').on(t.sparePartId),
  receivedDateIdx: index('SparePartItem_receivedDate_idx').on(t.receivedDate),
  sparePartSerialUnique: uniqueIndex('SparePartItem_sparePartId_serialNumber_unique').on(t.sparePartId, t.serialNumber),
}));

// ── TrashItem (recycle bin) ───────────────────────────────────────────────────
export const trashItems = sqliteTable('TrashItem', {
  id: id(),
  entityType: text('entityType').notNull(),
  entityId: text('entityId').notNull(),
  entityName: text('entityName'),
  entityData: text('entityData').notNull(),
  deletedBy: text('deletedBy'),
  deletedAt: timestampCol('deletedAt'),
}, (t) => ({
  entityTypeIdx: index('TrashItem_entityType_idx').on(t.entityType),
  deletedAtIdx: index('TrashItem_deletedAt_idx').on(t.deletedAt),
}));

// ── PurchaseOrder / PurchaseOrderItem ─────────────────────────────────────────
export const purchaseOrders = sqliteTable('PurchaseOrder', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  orderDate: text('orderDate').notNull(),
  supplier: text('supplier').notNull(),
  supplierContact: text('supplierContact'),
  supplierPhone: text('supplierPhone'),
  supplierChannel: text('supplierChannel'),
  status: text('status').notNull().default('Draft'),
  notes: text('notes'),
  totalAmount: real('totalAmount').notNull().default(0),
  expectedDeliveryDate: text('expectedDeliveryDate'),
  paymentTerms: text('paymentTerms'),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
  approvedBy: text('approvedBy'),
  approvedAt: text('approvedAt'),
  receivedAt: text('receivedAt'),
});

export const purchaseOrderItems = sqliteTable('PurchaseOrderItem', {
  id: id(),
  purchaseOrderId: text('purchaseOrderId').notNull().references(() => purchaseOrders.id, { onDelete: 'cascade' }),
  sparePartId: text('sparePartId'),
  sku: text('sku').notNull(),
  partName: text('partName').notNull(),
  quantity: integer('quantity').notNull(),
  unitPrice: real('unitPrice').notNull(),
  receivedQty: integer('receivedQty').notNull().default(0),
  remark: text('remark'),
}, (t) => ({
  purchaseOrderIdx: index('PurchaseOrderItem_purchaseOrderId_idx').on(t.purchaseOrderId),
}));

// ── Notification ──────────────────────────────────────────────────────────────
export const notifications = sqliteTable('Notification', {
  id: id(),
  type: text('type').notNull(),
  title: text('title').notNull(),
  body: text('body'),
  read: integer('read', { mode: 'boolean' }).notNull().default(false),
  entityType: text('entityType'),
  entityId: text('entityId'),
  createdAt: timestampCol('createdAt'),
}, (t) => ({
  readIdx: index('Notification_read_createdAt_idx').on(t.read, t.createdAt),
  createdAtIdx: index('Notification_createdAt_idx').on(t.createdAt),
  typeCreatedAtIdx: index('Notification_type_createdAt_idx').on(t.type, t.createdAt),
  entityIdx: index('Notification_entityType_entityId_idx').on(t.entityType, t.entityId),
}));

// ── ProjectRequest / ProjectRequestItem ───────────────────────────────────────
export const projectRequests = sqliteTable('ProjectRequest', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  title: text('title').notNull(),
  description: text('description'),
  projectType: text('projectType').notNull().default('Both'),
  status: text('status').notNull().default('Draft'),
  startDate: text('startDate').notNull(),
  expectedEndDate: text('expectedEndDate'),
  actualEndDate: text('actualEndDate'),
  budget: real('budget').notNull().default(0),
  totalCost: real('totalCost').notNull().default(0),
  customerId: text('customerId'),
  robotId: text('robotId'),
  notes: text('notes'),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
  approvedBy: text('approvedBy'),
  approvedAt: text('approvedAt'),
});

export const projectRequestItems = sqliteTable('ProjectRequestItem', {
  id: id(),
  projectRequestId: text('projectRequestId').notNull().references(() => projectRequests.id, { onDelete: 'cascade' }),
  itemType: text('itemType').notNull(),
  description: text('description').notNull(),
  vendor: text('vendor'),
  quantity: real('quantity').notNull().default(1),
  unit: text('unit').notNull().default('ชิ้น'),
  unitPrice: real('unitPrice').notNull().default(0),
  totalPrice: real('totalPrice').notNull().default(0),
  link: text('link'),
  remark: text('remark'),
});

// ── Accounts module ───────────────────────────────────────────────────────────
export const accounts = sqliteTable('Account', {
  id: id(),
  code: text('code').notNull().unique(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  parentId: text('parentId'),
  isActive: integer('isActive', { mode: 'boolean' }).notNull().default(true),
  createdAt: timestampCol('createdAt'),
});

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  parent: one(accounts, { fields: [accounts.parentId], references: [accounts.id] }),
  children: many(accounts),
  journalLines: many(journalEntryLines),
  budgets: many(budgets),
}));

export const invoices = sqliteTable('Invoice', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  invoiceType: text('invoiceType').notNull(),
  status: text('status').notNull().default('Draft'),
  invoiceDate: text('invoiceDate').notNull(),
  dueDate: text('dueDate').notNull(),
  customerId: text('customerId'),
  customerName: text('customerName'),
  supplier: text('supplier'),
  subtotal: real('subtotal').notNull().default(0),
  taxRate: real('taxRate').notNull().default(7),
  taxAmount: real('taxAmount').notNull().default(0),
  totalAmount: real('totalAmount').notNull().default(0),
  paidAmount: real('paidAmount').notNull().default(0),
  notes: text('notes'),
  sourceType: text('sourceType'),
  sourceId: text('sourceId'),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
});

export const invoiceItems = sqliteTable('InvoiceItem', {
  id: id(),
  invoiceId: text('invoiceId').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull().default('ชิ้น'),
  unitPrice: real('unitPrice').notNull(),
  amount: real('amount').notNull(),
  remark: text('remark'),
});

export const payments = sqliteTable('Payment', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  paymentType: text('paymentType').notNull(),
  paymentDate: text('paymentDate').notNull(),
  amount: real('amount').notNull(),
  method: text('method').notNull().default('Transfer'),
  reference: text('reference'),
  invoiceId: text('invoiceId').references(() => invoices.id),
  notes: text('notes'),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
});

// ── Contact / Site ────────────────────────────────────────────────────────────
export const contacts = sqliteTable('Contact', {
  id: id(),
  customerId: text('customerId').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  role: text('role'),
  email: text('email'),
  phone: text('phone'),
  lineId: text('lineId'),
  isPrimary: integer('isPrimary', { mode: 'boolean' }).notNull().default(false),
  createdAt: timestampCol('createdAt'),
});

export const sites = sqliteTable('Site', {
  id: id(),
  customerId: text('customerId').notNull().references(() => customers.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  address: text('address'),
  province: text('province'),
  lat: real('lat'),
  lng: real('lng'),
  notes: text('notes'),
  createdAt: timestampCol('createdAt'),
});

export const customersRelations = relations(customers, ({ many }) => ({
  robots: many(robots),
  tickets: many(maintenanceTickets),
  maintenanceSchedules: many(maintenanceSchedules),
  maintenancePlans: many(maintenancePlans),
  deliveryNotes: many(deliveryNotes),
  robotLoans: many(robotLoans),
  contacts: many(contacts),
  sites: many(sites),
}));

// ── MaterialRequest / MaterialRequestItem ─────────────────────────────────────
export const materialRequests = sqliteTable('MaterialRequest', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  status: text('status').notNull().default('Pending'),
  requestDate: text('requestDate').notNull(),
  notes: text('notes'),
  createdBy: text('createdBy'),
  approvedBy: text('approvedBy'),
  approvedAt: text('approvedAt'),
  linkedPoId: text('linkedPoId'),
  createdAt: timestampCol('createdAt'),
});

export const materialRequestItems = sqliteTable('MaterialRequestItem', {
  id: id(),
  materialRequestId: text('materialRequestId').notNull().references(() => materialRequests.id, { onDelete: 'cascade' }),
  sparePartId: text('sparePartId').notNull(),
  partName: text('partName').notNull(),
  sku: text('sku').notNull(),
  currentStock: integer('currentStock').notNull(),
  minStock: integer('minStock').notNull(),
  requestedQty: integer('requestedQty').notNull(),
  remark: text('remark'),
});

// ── JournalEntry / JournalEntryLine ───────────────────────────────────────────
export const journalEntries = sqliteTable('JournalEntry', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  entryDate: text('entryDate').notNull(),
  description: text('description'),
  sourceType: text('sourceType'),
  sourceId: text('sourceId'),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
});

export const journalEntryLines = sqliteTable('JournalEntryLine', {
  id: id(),
  journalEntryId: text('journalEntryId').notNull().references(() => journalEntries.id, { onDelete: 'cascade' }),
  accountId: text('accountId').notNull().references(() => accounts.id),
  debit: real('debit').notNull().default(0),
  credit: real('credit').notNull().default(0),
  description: text('description'),
});

// ── Budget ────────────────────────────────────────────────────────────────────
export const budgets = sqliteTable('Budget', {
  id: id(),
  name: text('name').notNull(),
  accountId: text('accountId').notNull().references(() => accounts.id),
  fiscalYear: text('fiscalYear').notNull(),
  budgetAmount: real('budgetAmount').notNull(),
  spentAmount: real('spentAmount').notNull().default(0),
  notes: text('notes'),
  createdAt: timestampCol('createdAt'),
});

// ── TravelExpenseClaim / TravelExpenseItem ────────────────────────────────────
export const travelExpenseClaims = sqliteTable('TravelExpenseClaim', {
  id: id(),
  docNumber: text('docNumber').notNull().unique(),
  claimDate: text('claimDate').notNull(),
  province: text('province').notNull(),
  destination: text('destination'),
  purpose: text('purpose').notNull(),
  staffName: text('staffName').notNull(),
  staffDept: text('staffDept'),
  travelDateFrom: text('travelDateFrom').notNull(),
  travelDateTo: text('travelDateTo').notNull(),
  status: text('status').notNull().default('Draft'),
  totalAdvance: real('totalAdvance').notNull().default(0),
  totalReimbursed: real('totalReimbursed').notNull().default(0),
  notes: text('notes'),
  // The job this trip was for — lets travel cost be totalled per customer / MA contract.
  customerId: text('customerId').references(() => customers.id),
  maVisitId: text('maVisitId').references(() => maintenanceVisits.id),
  ticketId: text('ticketId').references(() => maintenanceTickets.id),
  createdAt: timestampCol('createdAt'),
  createdBy: text('createdBy'),
  approvedBy: text('approvedBy'),
  approvedAt: text('approvedAt'),
});

export const travelExpenseItems = sqliteTable('TravelExpenseItem', {
  id: id(),
  claimId: text('claimId').notNull().references(() => travelExpenseClaims.id, { onDelete: 'cascade' }),
  itemType: text('itemType').notNull(),
  description: text('description').notNull(),
  amount: real('amount').notNull(),
  receiptNo: text('receiptNo'),
  remark: text('remark'),
});

// ── Parent → line-item relations (for relational `with: { items }` queries) ────
// Drizzle's relational query builder needs BOTH the parent `many` and the child `one`
// back-relation to infer which FK links them.
export const purchaseOrdersRelations = relations(purchaseOrders, ({ many }) => ({ items: many(purchaseOrderItems) }));
export const purchaseOrderItemsRelations = relations(purchaseOrderItems, ({ one }) => ({ purchaseOrder: one(purchaseOrders, { fields: [purchaseOrderItems.purchaseOrderId], references: [purchaseOrders.id] }) }));

export const materialRequestsRelations = relations(materialRequests, ({ many }) => ({ items: many(materialRequestItems) }));
export const materialRequestItemsRelations = relations(materialRequestItems, ({ one }) => ({ materialRequest: one(materialRequests, { fields: [materialRequestItems.materialRequestId], references: [materialRequests.id] }) }));

export const projectRequestsRelations = relations(projectRequests, ({ many }) => ({ items: many(projectRequestItems) }));
export const projectRequestItemsRelations = relations(projectRequestItems, ({ one }) => ({ projectRequest: one(projectRequests, { fields: [projectRequestItems.projectRequestId], references: [projectRequests.id] }) }));

export const deliveryNoteItemsRelations = relations(deliveryNoteItems, ({ one }) => ({ deliveryNote: one(deliveryNotes, { fields: [deliveryNoteItems.deliveryNoteId], references: [deliveryNotes.id] }) }));

export const robotLoanItemsRelations = relations(robotLoanItems, ({ one }) => ({ loan: one(robotLoans, { fields: [robotLoanItems.loanId], references: [robotLoans.id] }) }));

export const invoicesRelations = relations(invoices, ({ many }) => ({ items: many(invoiceItems), payments: many(payments) }));
export const invoiceItemsRelations = relations(invoiceItems, ({ one }) => ({ invoice: one(invoices, { fields: [invoiceItems.invoiceId], references: [invoices.id] }) }));
export const paymentsRelations = relations(payments, ({ one }) => ({ invoice: one(invoices, { fields: [payments.invoiceId], references: [invoices.id] }) }));

export const journalEntriesRelations = relations(journalEntries, ({ many }) => ({ lines: many(journalEntryLines) }));
export const journalEntryLinesRelations = relations(journalEntryLines, ({ one }) => ({
  journalEntry: one(journalEntries, { fields: [journalEntryLines.journalEntryId], references: [journalEntries.id] }),
  account: one(accounts, { fields: [journalEntryLines.accountId], references: [accounts.id] }),
}));
export const budgetsRelations = relations(budgets, ({ one }) => ({ account: one(accounts, { fields: [budgets.accountId], references: [accounts.id] }) }));

export const travelExpenseClaimsRelations = relations(travelExpenseClaims, ({ many }) => ({ items: many(travelExpenseItems) }));
export const travelExpenseItemsRelations = relations(travelExpenseItems, ({ one }) => ({ claim: one(travelExpenseClaims, { fields: [travelExpenseItems.claimId], references: [travelExpenseClaims.id] }) }));

// ── CacheVersion (bumped by triggers — see drizzle/0009_cache_version.sql) ───
export const cacheVersions = sqliteTable('CacheVersion', {
  key: text('key').primaryKey(),
  version: integer('version').notNull().default(0),
});
