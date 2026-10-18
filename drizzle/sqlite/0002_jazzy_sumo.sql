CREATE TABLE `dispatcher_lane` (
	`lane` text PRIMARY KEY NOT NULL,
	`ran_at` text NOT NULL,
	`handled` integer DEFAULT 0 NOT NULL,
	`failed_at` text
);
--> statement-breakpoint
ALTER TABLE `workspace` ADD `enrichment_swept_at` text;--> statement-breakpoint
CREATE INDEX `agent_task_organization_company_idx` ON `agent_task` (`organization_id`,`company_id`);