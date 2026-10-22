CREATE TABLE `MaintenancePlanRobot` (
	`planId` text NOT NULL,
	`robotId` text NOT NULL,
	PRIMARY KEY(`planId`, `robotId`),
	FOREIGN KEY (`planId`) REFERENCES `MaintenancePlan`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`robotId`) REFERENCES `Robot`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MaintenancePlanRobot_robotId_idx` ON `MaintenancePlanRobot` (`robotId`);
