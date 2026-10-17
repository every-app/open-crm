CREATE TABLE `mailbox_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`account_email` text NOT NULL,
	`scopes` text NOT NULL,
	`access_token` text,
	`access_token_expires_at` text,
	`refresh_token` text,
	`status` text DEFAULT 'ACTIVE' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_connection_organization_user_provider_uidx` ON `mailbox_connection` (`organization_id`,`user_id`,`provider`);--> statement-breakpoint
CREATE TABLE `mailbox_sync` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'IDLE' NOT NULL,
	`cursor` text,
	`auto_create` integer DEFAULT false NOT NULL,
	`last_synced_at` text,
	`last_error` text,
	`next_sync_at` text,
	`lease_until` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mailbox_sync_organization_user_source_uidx` ON `mailbox_sync` (`organization_id`,`user_id`,`source`);--> statement-breakpoint
CREATE INDEX `mailbox_sync_next_idx` ON `mailbox_sync` (`next_sync_at`);--> statement-breakpoint
CREATE TABLE `oauth_state` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`code_verifier` text NOT NULL,
	`expires_at` text NOT NULL,
	`consumed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `oauth_state_expires_idx` ON `oauth_state` (`expires_at`);--> statement-breakpoint
ALTER TABLE `calendar_event` ADD `google_event_id` text;--> statement-breakpoint
CREATE INDEX `calendar_event_organization_synced_by_idx` ON `calendar_event` (`organization_id`,`synced_by_user_id`);--> statement-breakpoint
ALTER TABLE `email_message` ADD `gmail_message_id` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `outlook_message_id` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `outlook_web_link` text;--> statement-breakpoint
CREATE INDEX `email_message_organization_gmail_idx` ON `email_message` (`organization_id`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `email_message_organization_synced_by_idx` ON `email_message` (`organization_id`,`synced_by_user_id`);