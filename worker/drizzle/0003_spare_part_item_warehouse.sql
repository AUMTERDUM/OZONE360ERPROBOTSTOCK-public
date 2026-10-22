ALTER TABLE `SparePartItem` ADD COLUMN `warehouseId` text REFERENCES `Warehouse`(`id`);
--> statement-breakpoint
UPDATE `SparePartItem`
SET `warehouseId` = (SELECT `warehouseId` FROM `SparePart` WHERE `SparePart`.`id` = `SparePartItem`.`sparePartId`)
WHERE `warehouseId` IS NULL;
