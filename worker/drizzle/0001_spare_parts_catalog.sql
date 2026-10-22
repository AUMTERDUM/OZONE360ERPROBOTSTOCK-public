ALTER TABLE `SparePart` ADD COLUMN `productModel` text;
--> statement-breakpoint
ALTER TABLE `SparePart` ADD COLUMN `partType` text;
--> statement-breakpoint
ALTER TABLE `SparePart` ADD COLUMN `status` text;
--> statement-breakpoint
ALTER TABLE `SparePart` ADD COLUMN `sourceFile` text;
--> statement-breakpoint
ALTER TABLE `SparePart` ADD COLUMN `sourceSheet` text;
--> statement-breakpoint
CREATE TABLE `SparePartItem` (
	`id` text PRIMARY KEY NOT NULL,
	`sparePartId` text NOT NULL,
	`serialNumber` text NOT NULL,
	`receivedDate` text NOT NULL,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`sparePartId`) REFERENCES `SparePart`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `SparePartItem_sparePartId_idx` ON `SparePartItem` (`sparePartId`);
--> statement-breakpoint
CREATE INDEX `SparePartItem_receivedDate_idx` ON `SparePartItem` (`receivedDate`);
--> statement-breakpoint
CREATE UNIQUE INDEX `SparePartItem_sparePartId_serialNumber_unique` ON `SparePartItem` (`sparePartId`,`serialNumber`);
