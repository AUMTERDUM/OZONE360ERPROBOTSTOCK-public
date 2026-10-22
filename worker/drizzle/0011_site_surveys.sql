CREATE TABLE `SiteSurvey` (
	`id` text PRIMARY KEY NOT NULL,
	`formType` text NOT NULL,
	`siteName` text NOT NULL,
	`surveyDate` text,
	`engineerName` text,
	`zone` text,
	`answers` text DEFAULT '{}' NOT NULL,
	`createdBy` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updatedAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
