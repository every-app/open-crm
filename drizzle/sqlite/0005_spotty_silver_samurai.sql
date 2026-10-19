ALTER TABLE `member` ADD `last_seen_at` text;--> statement-breakpoint
CREATE INDEX `form_submission_created_idx` ON `form_submission` (`created_at`);