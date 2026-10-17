CREATE TABLE `form_submission` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`visitor_id` text,
	`contact_id` text,
	`host` text NOT NULL,
	`path` text NOT NULL,
	`email` text,
	`fields` text NOT NULL,
	`first_touch` text,
	`last_touch` text,
	`dedupe_key` text NOT NULL,
	`filed_at` text,
	`skip_reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `form_submission_organization_dedupe_uidx` ON `form_submission` (`organization_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `form_submission_organization_contact_idx` ON `form_submission` (`organization_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `tracked_domain` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`host` text NOT NULL,
	`scope` text DEFAULT 'EXACT_HOST' NOT NULL,
	`page_views` integer DEFAULT 0 NOT NULL,
	`last_seen_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracked_domain_organization_host_uidx` ON `tracked_domain` (`organization_id`,`host`);--> statement-breakpoint
CREATE TABLE `tracked_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`visitor_id` text NOT NULL,
	`type` text NOT NULL,
	`host` text NOT NULL,
	`path` text NOT NULL,
	`referrer` text,
	`label` text,
	`source` text,
	`medium` text,
	`campaign` text,
	`occurred_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracked_event_organization_visitor_occurred_idx` ON `tracked_event` (`organization_id`,`visitor_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `tracked_event_organization_host_occurred_idx` ON `tracked_event` (`organization_id`,`host`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `tracked_event_organization_source_idx` ON `tracked_event` (`organization_id`,`source`,`medium`);--> statement-breakpoint
CREATE INDEX `tracked_event_occurred_idx` ON `tracked_event` (`occurred_at`);--> statement-breakpoint
CREATE TABLE `tracked_page_daily` (
	`organization_id` text NOT NULL,
	`day` text NOT NULL,
	`host` text NOT NULL,
	`path` text NOT NULL,
	`views` integer DEFAULT 0 NOT NULL,
	`visitors` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`organization_id`, `day`, `host`, `path`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tracked_visitor` (
	`organization_id` text NOT NULL,
	`id` text NOT NULL,
	`contact_id` text,
	`first_source` text,
	`first_medium` text,
	`first_campaign` text,
	`first_term` text,
	`first_content` text,
	`first_referrer` text,
	`first_landing` text,
	`first_touch_at` text,
	`last_source` text,
	`last_medium` text,
	`last_campaign` text,
	`last_term` text,
	`last_content` text,
	`last_referrer` text,
	`last_landing` text,
	`last_touch_at` text,
	`first_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_seen` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`organization_id`, `id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `tracked_visitor_organization_contact_idx` ON `tracked_visitor` (`organization_id`,`contact_id`);--> statement-breakpoint
CREATE TABLE `tracking_counter` (
	`organization_id` text NOT NULL,
	`key` text NOT NULL,
	`value` integer DEFAULT 0 NOT NULL,
	`expires_at` text NOT NULL,
	PRIMARY KEY(`organization_id`, `key`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `tracking_counter_expires_idx` ON `tracking_counter` (`expires_at`);--> statement-breakpoint
CREATE TABLE `tracking_site` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`site_id` text,
	`cross_domain` integer DEFAULT true NOT NULL,
	`limit_to_domains` integer DEFAULT true NOT NULL,
	`cookie_subdomains` integer DEFAULT false NOT NULL,
	`secure_cookies` integer DEFAULT true NOT NULL,
	`honour_dnt` integer DEFAULT true NOT NULL,
	`cookie_days` integer DEFAULT 395 NOT NULL,
	`paused` integer DEFAULT false NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tracking_site_site_id_uidx` ON `tracking_site` (`site_id`);