-- Link a site survey to the customer (and optionally the customer site) it was done for,
-- so a customer's history runs survey → delivery → MA in one place.
ALTER TABLE `SiteSurvey` ADD COLUMN `customerId` text REFERENCES `Customer`(`id`);
ALTER TABLE `SiteSurvey` ADD COLUMN `siteId` text REFERENCES `Site`(`id`);
CREATE INDEX `SiteSurvey_customerId_idx` ON `SiteSurvey` (`customerId`);

-- Link a travel claim to the job it paid for (an MA visit or a repair ticket), so travel
-- cost can be totalled per customer / per MA contract.
ALTER TABLE `TravelExpenseClaim` ADD COLUMN `maVisitId` text REFERENCES `MaintenanceVisit`(`id`);
ALTER TABLE `TravelExpenseClaim` ADD COLUMN `ticketId` text REFERENCES `MaintenanceTicket`(`id`);
ALTER TABLE `TravelExpenseClaim` ADD COLUMN `customerId` text REFERENCES `Customer`(`id`);
CREATE INDEX `TravelExpenseClaim_maVisitId_idx` ON `TravelExpenseClaim` (`maVisitId`);
CREATE INDEX `TravelExpenseClaim_ticketId_idx` ON `TravelExpenseClaim` (`ticketId`);
CREATE INDEX `TravelExpenseClaim_customerId_idx` ON `TravelExpenseClaim` (`customerId`);
