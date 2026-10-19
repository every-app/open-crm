CREATE TABLE `paid_session` (
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`slot` integer NOT NULL,
	`session_id` text NOT NULL,
	`leased_until` text NOT NULL,
	PRIMARY KEY(`organization_id`, `kind`, `slot`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `member` ADD `last_seen_at` text;--> statement-breakpoint
ALTER TABLE `company` ADD `research_held_at` text;--> statement-breakpoint
CREATE INDEX `company_organization_created_idx` ON `company` (`organization_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `contact` ADD `research_held_at` text;--> statement-breakpoint
CREATE INDEX `contact_organization_company_archived_idx` ON `contact` (`organization_id`,`company_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `contact_organization_created_idx` ON `contact` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_company_idx` ON `contact` (`company_id`);--> statement-breakpoint
ALTER TABLE `workspace` ADD `research_automatically` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `activity_company_idx` ON `activity` (`company_id`);--> statement-breakpoint
CREATE INDEX `activity_contact_idx` ON `activity` (`contact_id`);--> statement-breakpoint
CREATE INDEX `activity_deal_idx` ON `activity` (`deal_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_company_idx` ON `calendar_event` (`company_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_contact_idx` ON `calendar_event` (`contact_id`);--> statement-breakpoint
CREATE INDEX `deal_organization_company_archived_idx` ON `deal` (`organization_id`,`company_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `deal_organization_created_idx` ON `deal` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deal_company_idx` ON `deal` (`company_id`);--> statement-breakpoint
CREATE INDEX `email_thread_company_idx` ON `email_thread` (`company_id`);--> statement-breakpoint
CREATE INDEX `email_thread_contact_idx` ON `email_thread` (`contact_id`);--> statement-breakpoint
CREATE INDEX `agent_task_open_due_idx` ON `agent_task` (`due_at`) WHERE "agent_task"."finished_at" is null;--> statement-breakpoint
CREATE INDEX `form_submission_contact_idx` ON `form_submission` (`contact_id`);--> statement-breakpoint
CREATE INDEX `form_submission_created_idx` ON `form_submission` (`created_at`);--> statement-breakpoint
CREATE INDEX `tracked_visitor_contact_idx` ON `tracked_visitor` (`contact_id`);