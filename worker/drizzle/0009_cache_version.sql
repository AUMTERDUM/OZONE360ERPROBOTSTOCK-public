-- Version counters for the Worker's list-response cache (src/lib/read-cache.ts).
-- Triggers bump a table's counter on every write, so no route has to remember to
-- invalidate, and a cache hit costs one CacheVersion row read instead of a full scan.
CREATE TABLE IF NOT EXISTS `CacheVersion` (
	`key` text PRIMARY KEY NOT NULL,
	`version` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
INSERT OR IGNORE INTO `CacheVersion` (`key`, `version`) VALUES ('RobotModel', 0), ('Robot', 0), ('Customer', 0), ('MaintenanceTicket', 0), ('SparePart', 0), ('SparePartItem', 0), ('Warehouse', 0);
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `RobotModel_cache_insert` AFTER INSERT ON `RobotModel` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'RobotModel'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `RobotModel_cache_update` AFTER UPDATE ON `RobotModel` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'RobotModel'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `RobotModel_cache_delete` AFTER DELETE ON `RobotModel` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'RobotModel'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Robot_cache_insert` AFTER INSERT ON `Robot` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Robot'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Robot_cache_update` AFTER UPDATE ON `Robot` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Robot'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Robot_cache_delete` AFTER DELETE ON `Robot` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Robot'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Customer_cache_insert` AFTER INSERT ON `Customer` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Customer'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Customer_cache_update` AFTER UPDATE ON `Customer` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Customer'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Customer_cache_delete` AFTER DELETE ON `Customer` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Customer'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `MaintenanceTicket_cache_insert` AFTER INSERT ON `MaintenanceTicket` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'MaintenanceTicket'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `MaintenanceTicket_cache_update` AFTER UPDATE ON `MaintenanceTicket` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'MaintenanceTicket'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `MaintenanceTicket_cache_delete` AFTER DELETE ON `MaintenanceTicket` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'MaintenanceTicket'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `SparePart_cache_insert` AFTER INSERT ON `SparePart` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'SparePart'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `SparePart_cache_update` AFTER UPDATE ON `SparePart` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'SparePart'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `SparePart_cache_delete` AFTER DELETE ON `SparePart` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'SparePart'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `SparePartItem_cache_insert` AFTER INSERT ON `SparePartItem` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'SparePartItem'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `SparePartItem_cache_update` AFTER UPDATE ON `SparePartItem` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'SparePartItem'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `SparePartItem_cache_delete` AFTER DELETE ON `SparePartItem` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'SparePartItem'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Warehouse_cache_insert` AFTER INSERT ON `Warehouse` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Warehouse'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Warehouse_cache_update` AFTER UPDATE ON `Warehouse` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Warehouse'; END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS `Warehouse_cache_delete` AFTER DELETE ON `Warehouse` BEGIN UPDATE `CacheVersion` SET `version` = `version` + 1 WHERE `key` = 'Warehouse'; END;
