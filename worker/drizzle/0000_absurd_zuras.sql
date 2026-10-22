CREATE TABLE `Account` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`parentId` text,
	`isActive` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Account_code_unique` ON `Account` (`code`);--> statement-breakpoint
CREATE TABLE `ActivityLog` (
	`id` text PRIMARY KEY NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`entityName` text,
	`action` text NOT NULL,
	`oldValues` text,
	`newValues` text,
	`performedBy` text,
	`performedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ActivityLog_entityType_entityId_idx` ON `ActivityLog` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `ActivityLog_performedAt_idx` ON `ActivityLog` (`performedAt`);--> statement-breakpoint
CREATE TABLE `Attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`elementType` text NOT NULL,
	`elementId` text NOT NULL,
	`attachmentType` text DEFAULT 'other' NOT NULL,
	`filename` text NOT NULL,
	`originalName` text NOT NULL,
	`fileSize` integer,
	`mimeType` text,
	`uploadedBy` text,
	`uploadedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Attachment_elementType_elementId_idx` ON `Attachment` (`elementType`,`elementId`);--> statement-breakpoint
CREATE TABLE `Budget` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`accountId` text NOT NULL,
	`fiscalYear` text NOT NULL,
	`budgetAmount` real NOT NULL,
	`spentAmount` real DEFAULT 0 NOT NULL,
	`notes` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `Contact` (
	`id` text PRIMARY KEY NOT NULL,
	`customerId` text NOT NULL,
	`name` text NOT NULL,
	`role` text,
	`email` text,
	`phone` text,
	`lineId` text,
	`isPrimary` integer DEFAULT false NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Customer` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`contactPerson` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`address` text NOT NULL,
	`logoUrl` text,
	`type` text DEFAULT 'customer' NOT NULL,
	`agentCode` text,
	`puduShopId` text,
	`puduCompanyId` text,
	`portalToken` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Customer_puduShopId_unique` ON `Customer` (`puduShopId`);--> statement-breakpoint
CREATE UNIQUE INDEX `Customer_portalToken_unique` ON `Customer` (`portalToken`);--> statement-breakpoint
CREATE TABLE `DeliveryNoteItem` (
	`id` text PRIMARY KEY NOT NULL,
	`deliveryNoteId` text NOT NULL,
	`description` text NOT NULL,
	`quantity` integer NOT NULL,
	`remark` text,
	`serialNumbers` text NOT NULL,
	`sparePartId` text,
	FOREIGN KEY (`deliveryNoteId`) REFERENCES `DeliveryNote`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `DeliveryNote` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`deliveryDate` text NOT NULL,
	`customerId` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`recipientName` text,
	`recipientDate` text,
	`senderName` text,
	`notes` text,
	`installedAt` text,
	`acceptedAt` text,
	`trackingNumber` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `DeliveryNote_docNumber_unique` ON `DeliveryNote` (`docNumber`);--> statement-breakpoint
CREATE INDEX `DeliveryNote_customerId_idx` ON `DeliveryNote` (`customerId`);--> statement-breakpoint
CREATE INDEX `DeliveryNote_status_idx` ON `DeliveryNote` (`status`);--> statement-breakpoint
CREATE INDEX `DeliveryNote_deliveryDate_idx` ON `DeliveryNote` (`deliveryDate`);--> statement-breakpoint
CREATE TABLE `InvoiceItem` (
	`id` text PRIMARY KEY NOT NULL,
	`invoiceId` text NOT NULL,
	`description` text NOT NULL,
	`quantity` real NOT NULL,
	`unit` text DEFAULT 'ชิ้น' NOT NULL,
	`unitPrice` real NOT NULL,
	`amount` real NOT NULL,
	`remark` text,
	FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `Invoice` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`invoiceType` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`invoiceDate` text NOT NULL,
	`dueDate` text NOT NULL,
	`customerId` text,
	`customerName` text,
	`supplier` text,
	`subtotal` real DEFAULT 0 NOT NULL,
	`taxRate` real DEFAULT 7 NOT NULL,
	`taxAmount` real DEFAULT 0 NOT NULL,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`paidAmount` real DEFAULT 0 NOT NULL,
	`notes` text,
	`sourceType` text,
	`sourceId` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Invoice_docNumber_unique` ON `Invoice` (`docNumber`);--> statement-breakpoint
CREATE TABLE `JournalEntry` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`entryDate` text NOT NULL,
	`description` text,
	`sourceType` text,
	`sourceId` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `JournalEntry_docNumber_unique` ON `JournalEntry` (`docNumber`);--> statement-breakpoint
CREATE TABLE `JournalEntryLine` (
	`id` text PRIMARY KEY NOT NULL,
	`journalEntryId` text NOT NULL,
	`accountId` text NOT NULL,
	`debit` real DEFAULT 0 NOT NULL,
	`credit` real DEFAULT 0 NOT NULL,
	`description` text,
	FOREIGN KEY (`journalEntryId`) REFERENCES `JournalEntry`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`accountId`) REFERENCES `Account`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `MaintenancePlan` (
	`id` text PRIMARY KEY NOT NULL,
	`customerId` text NOT NULL,
	`startDate` text NOT NULL,
	`endDate` text,
	`intervalMonths` integer DEFAULT 3 NOT NULL,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `MaintenanceSchedule` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`robotId` text NOT NULL,
	`customerId` text,
	`frequencyDays` integer NOT NULL,
	`leadDays` integer DEFAULT 7 NOT NULL,
	`nextDueDate` text NOT NULL,
	`lastGeneratedAt` text,
	`lastCompletedAt` text,
	`assignedTo` text,
	`priorityLevel` text DEFAULT 'Normal' NOT NULL,
	`notes` text,
	`active` integer DEFAULT true NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`robotId`) REFERENCES `Robot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `MaintenanceTicket` (
	`id` text PRIMARY KEY NOT NULL,
	`trackingToken` text,
	`issueDescription` text NOT NULL,
	`status` text NOT NULL,
	`reportDate` text NOT NULL,
	`resolution` text,
	`replacedParts` text,
	`issueImageUrl` text,
	`assignedTo` text,
	`priorityLevel` text DEFAULT 'Normal' NOT NULL,
	`slaHours` integer,
	`slaDueAt` text,
	`slaBreachedAt` text,
	`escalationLevel` integer DEFAULT 0 NOT NULL,
	`robotId` text NOT NULL,
	`scheduleId` text,
	`customerId` text,
	FOREIGN KEY (`robotId`) REFERENCES `Robot`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MaintenanceTicket_trackingToken_unique` ON `MaintenanceTicket` (`trackingToken`);--> statement-breakpoint
CREATE INDEX `MaintenanceTicket_robotId_idx` ON `MaintenanceTicket` (`robotId`);--> statement-breakpoint
CREATE INDEX `MaintenanceTicket_customerId_idx` ON `MaintenanceTicket` (`customerId`);--> statement-breakpoint
CREATE INDEX `MaintenanceTicket_scheduleId_idx` ON `MaintenanceTicket` (`scheduleId`);--> statement-breakpoint
CREATE INDEX `MaintenanceTicket_status_idx` ON `MaintenanceTicket` (`status`);--> statement-breakpoint
CREATE INDEX `MaintenanceTicket_assignedTo_idx` ON `MaintenanceTicket` (`assignedTo`);--> statement-breakpoint
CREATE INDEX `MaintenanceTicket_reportDate_idx` ON `MaintenanceTicket` (`reportDate`);--> statement-breakpoint
CREATE TABLE `MaintenanceVisit` (
	`id` text PRIMARY KEY NOT NULL,
	`planId` text NOT NULL,
	`visitNumber` integer NOT NULL,
	`scheduledDate` text NOT NULL,
	`status` text DEFAULT 'Scheduled' NOT NULL,
	`completedAt` text,
	`technician` text,
	`summary` text,
	`reportJson` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`planId`) REFERENCES `MaintenancePlan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MaintenanceVisit_planId_idx` ON `MaintenanceVisit` (`planId`);--> statement-breakpoint
CREATE INDEX `MaintenanceVisit_scheduledDate_idx` ON `MaintenanceVisit` (`scheduledDate`);--> statement-breakpoint
CREATE INDEX `MaintenanceVisit_status_idx` ON `MaintenanceVisit` (`status`);--> statement-breakpoint
CREATE TABLE `MaterialRequestItem` (
	`id` text PRIMARY KEY NOT NULL,
	`materialRequestId` text NOT NULL,
	`sparePartId` text NOT NULL,
	`partName` text NOT NULL,
	`sku` text NOT NULL,
	`currentStock` integer NOT NULL,
	`minStock` integer NOT NULL,
	`requestedQty` integer NOT NULL,
	`remark` text,
	FOREIGN KEY (`materialRequestId`) REFERENCES `MaterialRequest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `MaterialRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`status` text DEFAULT 'Pending' NOT NULL,
	`requestDate` text NOT NULL,
	`notes` text,
	`createdBy` text,
	`approvedBy` text,
	`approvedAt` text,
	`linkedPoId` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `MaterialRequest_docNumber_unique` ON `MaterialRequest` (`docNumber`);--> statement-breakpoint
CREATE TABLE `Notification` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`title` text NOT NULL,
	`body` text,
	`read` integer DEFAULT false NOT NULL,
	`entityType` text,
	`entityId` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `Notification_read_createdAt_idx` ON `Notification` (`read`,`createdAt`);--> statement-breakpoint
CREATE INDEX `Notification_entityType_entityId_idx` ON `Notification` (`entityType`,`entityId`);--> statement-breakpoint
CREATE TABLE `Payment` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`paymentType` text NOT NULL,
	`paymentDate` text NOT NULL,
	`amount` real NOT NULL,
	`method` text DEFAULT 'Transfer' NOT NULL,
	`reference` text,
	`invoiceId` text,
	`notes` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text,
	FOREIGN KEY (`invoiceId`) REFERENCES `Invoice`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Payment_docNumber_unique` ON `Payment` (`docNumber`);--> statement-breakpoint
CREATE TABLE `ProjectRequestItem` (
	`id` text PRIMARY KEY NOT NULL,
	`projectRequestId` text NOT NULL,
	`itemType` text NOT NULL,
	`description` text NOT NULL,
	`vendor` text,
	`quantity` real DEFAULT 1 NOT NULL,
	`unit` text DEFAULT 'ชิ้น' NOT NULL,
	`unitPrice` real DEFAULT 0 NOT NULL,
	`totalPrice` real DEFAULT 0 NOT NULL,
	`link` text,
	`remark` text,
	FOREIGN KEY (`projectRequestId`) REFERENCES `ProjectRequest`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `ProjectRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`projectType` text DEFAULT 'Both' NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`startDate` text NOT NULL,
	`expectedEndDate` text,
	`actualEndDate` text,
	`budget` real DEFAULT 0 NOT NULL,
	`totalCost` real DEFAULT 0 NOT NULL,
	`customerId` text,
	`robotId` text,
	`notes` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text,
	`approvedBy` text,
	`approvedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ProjectRequest_docNumber_unique` ON `ProjectRequest` (`docNumber`);--> statement-breakpoint
CREATE TABLE `PurchaseOrderItem` (
	`id` text PRIMARY KEY NOT NULL,
	`purchaseOrderId` text NOT NULL,
	`sparePartId` text,
	`sku` text NOT NULL,
	`partName` text NOT NULL,
	`quantity` integer NOT NULL,
	`unitPrice` real NOT NULL,
	`receivedQty` integer DEFAULT 0 NOT NULL,
	`remark` text,
	FOREIGN KEY (`purchaseOrderId`) REFERENCES `PurchaseOrder`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `PurchaseOrder` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`orderDate` text NOT NULL,
	`supplier` text NOT NULL,
	`supplierContact` text,
	`supplierPhone` text,
	`supplierChannel` text,
	`status` text DEFAULT 'Draft' NOT NULL,
	`notes` text,
	`totalAmount` real DEFAULT 0 NOT NULL,
	`expectedDeliveryDate` text,
	`paymentTerms` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text,
	`approvedBy` text,
	`approvedAt` text,
	`receivedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `PurchaseOrder_docNumber_unique` ON `PurchaseOrder` (`docNumber`);--> statement-breakpoint
CREATE TABLE `RobotLoanItem` (
	`id` text PRIMARY KEY NOT NULL,
	`loanId` text NOT NULL,
	`robotId` text NOT NULL,
	`serialNumber` text NOT NULL,
	`modelName` text NOT NULL,
	`returnedAt` text,
	`condition` text,
	FOREIGN KEY (`loanId`) REFERENCES `RobotLoan`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `RobotLoan` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`purpose` text NOT NULL,
	`loanDate` text NOT NULL,
	`expectedReturn` text NOT NULL,
	`actualReturn` text,
	`status` text DEFAULT 'Pending' NOT NULL,
	`borrowerName` text NOT NULL,
	`borrowerPhone` text,
	`borrowerDept` text,
	`customerId` text,
	`approvedBy` text,
	`approvedAt` text,
	`notes` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `RobotLoan_docNumber_unique` ON `RobotLoan` (`docNumber`);--> statement-breakpoint
CREATE TABLE `RobotModel` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`type` text NOT NULL,
	`payloadCapacity` text NOT NULL,
	`batteryLife` text NOT NULL,
	`imageUrl` text,
	`puduProductCode` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `RobotModel_puduProductCode_unique` ON `RobotModel` (`puduProductCode`);--> statement-breakpoint
CREATE TABLE `Robot` (
	`id` text PRIMARY KEY NOT NULL,
	`serialNumber` text NOT NULL,
	`status` text NOT NULL,
	`purchaseDate` text NOT NULL,
	`puduMac` text,
	`notes` text,
	`warrantyExpiresAt` text,
	`archivedAt` text,
	`modelId` text NOT NULL,
	`customerId` text,
	`locationId` text,
	FOREIGN KEY (`modelId`) REFERENCES `RobotModel`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`locationId`) REFERENCES `Warehouse`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Robot_serialNumber_unique` ON `Robot` (`serialNumber`);--> statement-breakpoint
CREATE INDEX `Robot_customerId_idx` ON `Robot` (`customerId`);--> statement-breakpoint
CREATE INDEX `Robot_modelId_idx` ON `Robot` (`modelId`);--> statement-breakpoint
CREATE INDEX `Robot_locationId_idx` ON `Robot` (`locationId`);--> statement-breakpoint
CREATE INDEX `Robot_status_idx` ON `Robot` (`status`);--> statement-breakpoint
CREATE TABLE `Site` (
	`id` text PRIMARY KEY NOT NULL,
	`customerId` text NOT NULL,
	`name` text NOT NULL,
	`address` text,
	`province` text,
	`lat` real,
	`lng` real,
	`notes` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`customerId`) REFERENCES `Customer`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `SparePart` (
	`id` text PRIMARY KEY NOT NULL,
	`sku` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`category` text,
	`location` text,
	`warehouseId` text,
	`stock` integer DEFAULT 0 NOT NULL,
	`minStock` integer DEFAULT 0 NOT NULL,
	`unitPrice` real DEFAULT 0 NOT NULL,
	`supplier` text,
	FOREIGN KEY (`warehouseId`) REFERENCES `Warehouse`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `SparePart_sku_unique` ON `SparePart` (`sku`);--> statement-breakpoint
CREATE TABLE `TrashItem` (
	`id` text PRIMARY KEY NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text NOT NULL,
	`entityName` text,
	`entityData` text NOT NULL,
	`deletedBy` text,
	`deletedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `TrashItem_entityType_idx` ON `TrashItem` (`entityType`);--> statement-breakpoint
CREATE INDEX `TrashItem_deletedAt_idx` ON `TrashItem` (`deletedAt`);--> statement-breakpoint
CREATE TABLE `TravelExpenseClaim` (
	`id` text PRIMARY KEY NOT NULL,
	`docNumber` text NOT NULL,
	`claimDate` text NOT NULL,
	`province` text NOT NULL,
	`destination` text,
	`purpose` text NOT NULL,
	`staffName` text NOT NULL,
	`staffDept` text,
	`travelDateFrom` text NOT NULL,
	`travelDateTo` text NOT NULL,
	`status` text DEFAULT 'Draft' NOT NULL,
	`totalAdvance` real DEFAULT 0 NOT NULL,
	`totalReimbursed` real DEFAULT 0 NOT NULL,
	`notes` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`createdBy` text,
	`approvedBy` text,
	`approvedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `TravelExpenseClaim_docNumber_unique` ON `TravelExpenseClaim` (`docNumber`);--> statement-breakpoint
CREATE TABLE `TravelExpenseItem` (
	`id` text PRIMARY KEY NOT NULL,
	`claimId` text NOT NULL,
	`itemType` text NOT NULL,
	`description` text NOT NULL,
	`amount` real NOT NULL,
	`receiptNo` text,
	`remark` text,
	FOREIGN KEY (`claimId`) REFERENCES `TravelExpenseClaim`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `UsedPart` (
	`id` text PRIMARY KEY NOT NULL,
	`ticketId` text NOT NULL,
	`sparePartId` text NOT NULL,
	`quantity` integer NOT NULL,
	`note` text,
	FOREIGN KEY (`ticketId`) REFERENCES `MaintenanceTicket`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sparePartId`) REFERENCES `SparePart`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `UsedPart_ticketId_idx` ON `UsedPart` (`ticketId`);--> statement-breakpoint
CREATE INDEX `UsedPart_sparePartId_idx` ON `UsedPart` (`sparePartId`);--> statement-breakpoint
CREATE TABLE `User` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`password` text NOT NULL,
	`role` text DEFAULT 'TECHNICIAN' NOT NULL,
	`googleEmail` text,
	`failedAttempts` integer DEFAULT 0 NOT NULL,
	`lockedUntil` text,
	`passwordChangedAt` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `User_username_unique` ON `User` (`username`);--> statement-breakpoint
CREATE UNIQUE INDEX `User_googleEmail_unique` ON `User` (`googleEmail`);--> statement-breakpoint
CREATE TABLE `Warehouse` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`parentId` text
);
