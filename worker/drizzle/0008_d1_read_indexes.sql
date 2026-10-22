-- Cut D1 rows_read: these queries previously scanned the whole table.
-- GET /notifications orders by createdAt; dashboard-trends filters type + createdAt.
CREATE INDEX IF NOT EXISTS `Notification_createdAt_idx` ON `Notification` (`createdAt`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `Notification_type_createdAt_idx` ON `Notification` (`type`, `createdAt`);
--> statement-breakpoint
-- Pudu sync looks up an MA plan per new robot by customerId.
CREATE INDEX IF NOT EXISTS `MaintenancePlan_customerId_idx` ON `MaintenancePlan` (`customerId`);
