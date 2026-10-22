CREATE INDEX IF NOT EXISTS `RobotLoanItem_robotId_idx` ON `RobotLoanItem` (`robotId`);
--> statement-breakpoint
-- Low-stock draft-PO cron looks up items by purchaseOrderId.
CREATE INDEX IF NOT EXISTS `PurchaseOrderItem_purchaseOrderId_idx` ON `PurchaseOrderItem` (`purchaseOrderId`);
