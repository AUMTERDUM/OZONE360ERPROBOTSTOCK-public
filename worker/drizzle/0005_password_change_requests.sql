CREATE TABLE `PasswordChangeRequest` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`codeHash` text NOT NULL,
	`newPassword` text NOT NULL,
	`expiresAt` text NOT NULL,
	`usedAt` text,
	`createdAt` text DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `PasswordChangeRequest_userId_idx` ON `PasswordChangeRequest` (`userId`);
