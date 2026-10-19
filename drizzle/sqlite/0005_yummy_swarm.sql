ALTER TABLE `company` ADD `research_held_at` text;--> statement-breakpoint
ALTER TABLE `contact` ADD `research_held_at` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `research_automatically` integer DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX `agent_task_open_due_idx` ON `agent_task` (`due_at`) WHERE "agent_task"."finished_at" is null;