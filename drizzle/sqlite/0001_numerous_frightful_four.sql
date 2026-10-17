ALTER TABLE `deal` ADD `source` text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `workspace` ADD `model_refused_at` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `model_refusal` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `model_answered_at` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `setup_dismissed_at` text;