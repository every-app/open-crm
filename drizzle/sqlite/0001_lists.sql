-- Lists with optional stages, and deals made opt-in. Additive only: three
-- new tables, a nullable column on activity, a defaulted one on workspace,
-- and the backfill that keeps deals on where an organization has any.
-- drizzle-kit leaves ON DELETE off an added column's reference; it is
-- written in by hand, so deleting a list entry keeps its timeline lines.
CREATE TABLE `list_entry` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`list_id` text NOT NULL,
	`contact_id` text,
	`company_id` text,
	`stage_id` text,
	`stage_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`added_by_id` text,
	`added_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `record_list`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`stage_id`) REFERENCES `list_stage`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`added_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `list_entry_list_contact_uidx` ON `list_entry` (`list_id`,`contact_id`) WHERE "list_entry"."contact_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `list_entry_list_company_uidx` ON `list_entry` (`list_id`,`company_id`) WHERE "list_entry"."company_id" is not null;--> statement-breakpoint
CREATE INDEX `list_entry_organization_contact_idx` ON `list_entry` (`organization_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `list_entry_organization_company_idx` ON `list_entry` (`organization_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `list_entry_list_stage_idx` ON `list_entry` (`list_id`,`stage_id`);--> statement-breakpoint
CREATE INDEX `list_entry_contact_idx` ON `list_entry` (`contact_id`);--> statement-breakpoint
CREATE INDEX `list_entry_company_idx` ON `list_entry` (`company_id`);--> statement-breakpoint
CREATE INDEX `list_entry_stage_idx` ON `list_entry` (`stage_id`);--> statement-breakpoint
CREATE INDEX `list_entry_added_by_idx` ON `list_entry` (`added_by_id`);--> statement-breakpoint
CREATE TABLE `list_stage` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text DEFAULT 'OPEN' NOT NULL,
	`position` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`list_id`) REFERENCES `record_list`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `list_stage_list_position_idx` ON `list_stage` (`list_id`,`position`);--> statement-breakpoint
CREATE TABLE `record_list` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity` text NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`description` text,
	`follow_up_days` integer,
	`created_by_id` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `record_list_organization_name_uidx` ON `record_list` (`organization_id`,lower("name")) WHERE "record_list"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `record_list_created_by_idx` ON `record_list` (`created_by_id`);--> statement-breakpoint
ALTER TABLE `activity` ADD `list_entry_id` text REFERENCES list_entry(id) ON DELETE set null;--> statement-breakpoint
CREATE INDEX `activity_list_entry_idx` ON `activity` (`list_entry_id`);--> statement-breakpoint
ALTER TABLE `workspace` ADD `deals_enabled` integer DEFAULT false NOT NULL;--> statement-breakpoint
-- Deals become opt-in. Every organization that has a deal (archived ones
-- included) keeps them on; the rest start with them off.
UPDATE `workspace` SET `deals_enabled` = 1 WHERE `organization_id` IN (SELECT `organization_id` FROM `deal`);
