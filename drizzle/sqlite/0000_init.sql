CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `member_organizationId_userId_uidx` ON `member` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`created_at` integer NOT NULL,
	`metadata` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_uidx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `activity` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`type` text NOT NULL,
	`subject` text,
	`body` text,
	`occurred_at` text,
	`due_at` text,
	`completed_at` text,
	`company_id` text,
	`contact_id` text,
	`deal_id` text,
	`created_by_id` text,
	`meta` text,
	`email_thread_id` text,
	`calendar_event_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`email_thread_id`) REFERENCES `email_thread`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`calendar_event_id`) REFERENCES `calendar_event`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_email_thread_uidx` ON `activity` (`email_thread_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `activity_calendar_event_uidx` ON `activity` (`calendar_event_id`);--> statement-breakpoint
CREATE INDEX `activity_organization_company_created_idx` ON `activity` (`organization_id`,`company_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_organization_deal_created_idx` ON `activity` (`organization_id`,`deal_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_organization_contact_created_idx` ON `activity` (`organization_id`,`contact_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `activity_organization_due_idx` ON `activity` (`organization_id`,`due_at`);--> statement-breakpoint
CREATE INDEX `activity_created_by_idx` ON `activity` (`created_by_id`);--> statement-breakpoint
CREATE TABLE `calendar_attendee` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`event_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`response_status` text,
	`is_organizer` integer DEFAULT false NOT NULL,
	`contact_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_event`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_attendee_event_email_uidx` ON `calendar_attendee` (`event_id`,`email`);--> statement-breakpoint
CREATE INDEX `calendar_attendee_contact_idx` ON `calendar_attendee` (`contact_id`);--> statement-breakpoint
CREATE TABLE `calendar_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`ical_uid` text NOT NULL,
	`original_start_time` text NOT NULL,
	`recurring_event_id` text,
	`title` text,
	`description` text,
	`location` text,
	`conference_url` text,
	`starts_at` text NOT NULL,
	`ends_at` text NOT NULL,
	`is_all_day` integer DEFAULT false NOT NULL,
	`status` text NOT NULL,
	`organizer_email` text,
	`company_id` text,
	`contact_id` text,
	`synced_by_user_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_organization_ical_start_uidx` ON `calendar_event` (`organization_id`,`ical_uid`,`original_start_time`);--> statement-breakpoint
CREATE INDEX `calendar_event_organization_company_starts_idx` ON `calendar_event` (`organization_id`,`company_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `calendar_event_organization_contact_starts_idx` ON `calendar_event` (`organization_id`,`contact_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `company` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`domain` text,
	`website` text,
	`description` text,
	`logo_url` text,
	`logo_dark_url` text,
	`icon_url` text,
	`icon_dark_url` text,
	`icon_tone` text,
	`brand_color` text,
	`industry` text,
	`sub_industry` text,
	`city` text,
	`state_code` text,
	`country` text,
	`country_code` text,
	`phone` text,
	`email` text,
	`linkedin_url` text,
	`twitter_url` text,
	`github_url` text,
	`pricing_url` text,
	`careers_url` text,
	`owner_id` text,
	`primary_contact_id` text,
	`enrichment_status` text DEFAULT 'PENDING' NOT NULL,
	`enriched_at` text,
	`enrichment_error` text,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`last_activity_at` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`primary_contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `company_organization_domain_active_uidx` ON `company` (`organization_id`,`domain`) WHERE "company"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `company_primary_contact_uidx` ON `company` (`primary_contact_id`);--> statement-breakpoint
CREATE INDEX `company_organization_owner_idx` ON `company` (`organization_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `company_organization_name_idx` ON `company` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `company_organization_last_activity_idx` ON `company` (`organization_id`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `company_organization_archived_idx` ON `company` (`organization_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `company_enrichment` (
	`company_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source` text DEFAULT 'context.dev' NOT NULL,
	`raw` text NOT NULL,
	`fetched_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text,
	`email` text,
	`phone` text,
	`title` text,
	`seniority` text,
	`function` text,
	`linkedin_url` text,
	`twitter_url` text,
	`github_url` text,
	`image_url` text,
	`socials_checked_at` text,
	`enrichment_status` text DEFAULT 'PENDING' NOT NULL,
	`enriched_at` text,
	`enrichment_error` text,
	`company_id` text,
	`owner_id` text,
	`source` text DEFAULT 'MANUAL' NOT NULL,
	`last_activity_at` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `contact_organization_email_active_uidx` ON `contact` (`organization_id`,`email`) WHERE "contact"."archived_at" is null;--> statement-breakpoint
CREATE INDEX `contact_organization_company_idx` ON `contact` (`organization_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `contact_organization_owner_idx` ON `contact` (`organization_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `contact_organization_last_activity_idx` ON `contact` (`organization_id`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `contact_organization_archived_idx` ON `contact` (`organization_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `contact_brief` (
	`contact_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`narrative` text NOT NULL,
	`sections` text NOT NULL,
	`score` real NOT NULL,
	`source_url` text,
	`session_id` text,
	`refreshed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `contact_fact` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`field` text NOT NULL,
	`value` text NOT NULL,
	`score` real NOT NULL,
	`band` text NOT NULL,
	`evidence` text NOT NULL,
	`method` text NOT NULL,
	`source_url` text,
	`session_id` text,
	`status` text DEFAULT 'PROPOSED' NOT NULL,
	`decided_by_id` text,
	`decided_at` text,
	`observed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`superseded_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`decided_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `contact_fact_contact_field_status_idx` ON `contact_fact` (`contact_id`,`field`,`status`);--> statement-breakpoint
CREATE INDEX `contact_fact_organization_status_observed_idx` ON `contact_fact` (`organization_id`,`status`,`observed_at`);--> statement-breakpoint
CREATE TABLE `deal` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`company_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`stage` text DEFAULT 'DEMO_BOOKED' NOT NULL,
	`stage_changed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`amount` real,
	`currency` text DEFAULT 'USD' NOT NULL,
	`expected_close_date` text,
	`closed_at` text,
	`closed_reason` text,
	`base_amount` real,
	`base_currency` text,
	`fx_rate` real,
	`fx_rate_at` text,
	`last_activity_at` text,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `deal_organization_company_idx` ON `deal` (`organization_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `deal_organization_owner_idx` ON `deal` (`organization_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `deal_organization_stage_idx` ON `deal` (`organization_id`,`stage`);--> statement-breakpoint
CREATE INDEX `deal_organization_expected_close_idx` ON `deal` (`organization_id`,`expected_close_date`);--> statement-breakpoint
CREATE INDEX `deal_organization_last_activity_idx` ON `deal` (`organization_id`,`last_activity_at`);--> statement-breakpoint
CREATE INDEX `deal_organization_base_amount_idx` ON `deal` (`organization_id`,`base_amount`);--> statement-breakpoint
CREATE INDEX `deal_organization_currency_idx` ON `deal` (`organization_id`,`currency`);--> statement-breakpoint
CREATE INDEX `deal_organization_archived_idx` ON `deal` (`organization_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `deal_contact` (
	`deal_id` text NOT NULL,
	`contact_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text,
	PRIMARY KEY(`deal_id`, `contact_id`),
	FOREIGN KEY (`deal_id`) REFERENCES `deal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `deal_contact_contact_idx` ON `deal_contact` (`contact_id`);--> statement-breakpoint
CREATE TABLE `email_message` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`thread_id` text NOT NULL,
	`rfc_message_id` text NOT NULL,
	`synced_by_user_id` text,
	`direction` text NOT NULL,
	`from_email` text NOT NULL,
	`from_name` text,
	`recipients` text NOT NULL,
	`subject` text,
	`snippet` text,
	`body` text,
	`sent_at` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `email_thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_organization_rfc_uidx` ON `email_message` (`organization_id`,`rfc_message_id`);--> statement-breakpoint
CREATE INDEX `email_message_thread_sent_idx` ON `email_message` (`thread_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `email_thread` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`root_message_id` text NOT NULL,
	`subject` text,
	`company_id` text,
	`contact_id` text,
	`first_message_at` text NOT NULL,
	`last_message_at` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_thread_organization_root_uidx` ON `email_thread` (`organization_id`,`root_message_id`);--> statement-breakpoint
CREATE INDEX `email_thread_organization_company_last_idx` ON `email_thread` (`organization_id`,`company_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `email_thread_organization_contact_last_idx` ON `email_thread` (`organization_id`,`contact_id`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `field_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity` text NOT NULL,
	`key` text NOT NULL,
	`label` text NOT NULL,
	`type` text NOT NULL,
	`agent_filled` integer DEFAULT true NOT NULL,
	`agent_brief` text,
	`required` integer DEFAULT false NOT NULL,
	`show_on_sheet` integer DEFAULT true NOT NULL,
	`show_on_table` integer DEFAULT false NOT NULL,
	`show_on_filter` integer DEFAULT false NOT NULL,
	`position` integer NOT NULL,
	`archived_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_definition_organization_entity_key_uidx` ON `field_definition` (`organization_id`,`entity`,`key`);--> statement-breakpoint
CREATE INDEX `field_definition_organization_entity_position_idx` ON `field_definition` (`organization_id`,`entity`,`position`);--> statement-breakpoint
CREATE TABLE `field_option` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`field_id` text NOT NULL,
	`label` text NOT NULL,
	`position` integer NOT NULL,
	`archived_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `field_definition`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `field_option_field_position_idx` ON `field_option` (`field_id`,`position`);--> statement-breakpoint
CREATE TABLE `field_value` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`field_id` text NOT NULL,
	`company_id` text,
	`contact_id` text,
	`deal_id` text,
	`text` text,
	`number` real,
	`date` text,
	`bool` integer,
	`option_id` text,
	`user_id` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`field_id`) REFERENCES `field_definition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`option_id`) REFERENCES `field_option`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `field_value_field_company_uidx` ON `field_value` (`field_id`,`company_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `field_value_field_contact_uidx` ON `field_value` (`field_id`,`contact_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `field_value_field_deal_uidx` ON `field_value` (`field_id`,`deal_id`);--> statement-breakpoint
CREATE INDEX `field_value_field_text_idx` ON `field_value` (`field_id`,`text`);--> statement-breakpoint
CREATE INDEX `field_value_field_number_idx` ON `field_value` (`field_id`,`number`);--> statement-breakpoint
CREATE INDEX `field_value_field_date_idx` ON `field_value` (`field_id`,`date`);--> statement-breakpoint
CREATE INDEX `field_value_company_idx` ON `field_value` (`company_id`);--> statement-breakpoint
CREATE INDEX `field_value_contact_idx` ON `field_value` (`contact_id`);--> statement-breakpoint
CREATE INDEX `field_value_deal_idx` ON `field_value` (`deal_id`);--> statement-breakpoint
CREATE INDEX `field_value_option_idx` ON `field_value` (`option_id`);--> statement-breakpoint
CREATE INDEX `field_value_user_idx` ON `field_value` (`user_id`);--> statement-breakpoint
CREATE TABLE `fx_rate` (
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` real NOT NULL,
	`as_of` text NOT NULL,
	`provider` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`base_currency`, `quote_currency`)
);
--> statement-breakpoint
CREATE TABLE `manual_fx_rate` (
	`organization_id` text NOT NULL,
	`base_currency` text NOT NULL,
	`quote_currency` text NOT NULL,
	`rate` real NOT NULL,
	`as_of` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`organization_id`, `base_currency`, `quote_currency`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `saved_view` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`entity` text NOT NULL,
	`name` text NOT NULL,
	`shared` integer DEFAULT false NOT NULL,
	`filters` text NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `saved_view_organization_entity_owner_name_uidx` ON `saved_view` (`organization_id`,`entity`,`owner_id`,`name`);--> statement-breakpoint
CREATE INDEX `saved_view_organization_entity_shared_idx` ON `saved_view` (`organization_id`,`entity`,`shared`);--> statement-breakpoint
CREATE TABLE `suppressed_contact` (
	`organization_id` text NOT NULL,
	`email` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`organization_id`, `email`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `suppressed_domain` (
	`organization_id` text NOT NULL,
	`domain` text NOT NULL,
	`reason` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`organization_id`, `domain`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`website` text,
	`onboarded_at` text,
	`agent_model_id` text,
	`agent_model_context_window` integer,
	`reporting_currency` text,
	`rates_refreshed_at` text,
	`archive_retention_days` integer DEFAULT 180 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspace_profile` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`website` text NOT NULL,
	`narrative` text NOT NULL,
	`sections` text NOT NULL,
	`source_url` text,
	`session_id` text,
	`refreshed_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_conversation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text DEFAULT 'RECORD' NOT NULL,
	`contact_id` text,
	`company_id` text,
	`deal_id` text,
	`user_id` text NOT NULL,
	`session_id` text NOT NULL,
	`title` text,
	`message_count` integer DEFAULT 0 NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_message_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`last_assistant_at` text,
	`last_read_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`deal_id`) REFERENCES `deal`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversation_session_id_unique` ON `agent_conversation` (`session_id`);--> statement-breakpoint
CREATE INDEX `agent_conversation_contact_last_idx` ON `agent_conversation` (`contact_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `agent_conversation_company_last_idx` ON `agent_conversation` (`company_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `agent_conversation_deal_last_idx` ON `agent_conversation` (`deal_id`,`last_message_at`);--> statement-breakpoint
CREATE INDEX `agent_conversation_organization_user_kind_last_idx` ON `agent_conversation` (`organization_id`,`user_id`,`kind`,`last_message_at`);--> statement-breakpoint
CREATE TABLE `agent_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`session_id` text NOT NULL,
	`contact_id` text,
	`company_id` text,
	`deal_id` text,
	`conversation_id` text,
	`type` text NOT NULL,
	`data` text NOT NULL,
	`emitted_at` text NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_event_session_emitted_idx` ON `agent_event` (`session_id`,`emitted_at`);--> statement-breakpoint
CREATE INDEX `agent_event_organization_contact_emitted_idx` ON `agent_event` (`organization_id`,`contact_id`,`emitted_at`);--> statement-breakpoint
CREATE INDEX `agent_event_organization_company_emitted_idx` ON `agent_event` (`organization_id`,`company_id`,`emitted_at`);--> statement-breakpoint
CREATE INDEX `agent_event_organization_deal_emitted_idx` ON `agent_event` (`organization_id`,`deal_id`,`emitted_at`);--> statement-breakpoint
CREATE INDEX `agent_event_conversation_emitted_idx` ON `agent_event` (`conversation_id`,`emitted_at`);--> statement-breakpoint
CREATE TABLE `agent_task` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`contact_id` text,
	`company_id` text,
	`deal_id` text,
	`kind` text NOT NULL,
	`reason` text NOT NULL,
	`payload` text,
	`priority` integer DEFAULT 0 NOT NULL,
	`budget` integer DEFAULT 4 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`due_at` text NOT NULL,
	`leased_until` text,
	`session_id` text,
	`started_at` text,
	`finished_at` text,
	`outcome` text,
	`subject` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_task_due_lease_idx` ON `agent_task` (`due_at`,`leased_until`);--> statement-breakpoint
CREATE INDEX `agent_task_organization_contact_idx` ON `agent_task` (`organization_id`,`contact_id`);--> statement-breakpoint
CREATE INDEX `agent_task_organization_deal_idx` ON `agent_task` (`organization_id`,`deal_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_task_open_kind_subject_uidx` ON `agent_task` (`organization_id`,`kind`,`subject`) WHERE "agent_task"."finished_at" is null;