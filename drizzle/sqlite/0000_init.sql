CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` text,
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
CREATE INDEX `activity_company_idx` ON `activity` (`company_id`);--> statement-breakpoint
CREATE INDEX `activity_contact_idx` ON `activity` (`contact_id`);--> statement-breakpoint
CREATE INDEX `activity_deal_idx` ON `activity` (`deal_id`);--> statement-breakpoint
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
	`google_event_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`company_id`) REFERENCES `company`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`contact_id`) REFERENCES `contact`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `calendar_event_organization_synced_by_idx` ON `calendar_event` (`organization_id`,`synced_by_user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `calendar_event_organization_ical_start_uidx` ON `calendar_event` (`organization_id`,`ical_uid`,`original_start_time`);--> statement-breakpoint
CREATE INDEX `calendar_event_organization_company_starts_idx` ON `calendar_event` (`organization_id`,`company_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `calendar_event_organization_contact_starts_idx` ON `calendar_event` (`organization_id`,`contact_id`,`starts_at`);--> statement-breakpoint
CREATE INDEX `calendar_event_company_idx` ON `calendar_event` (`company_id`);--> statement-breakpoint
CREATE INDEX `calendar_event_contact_idx` ON `calendar_event` (`contact_id`);--> statement-breakpoint
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
	`research_held_at` text,
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
CREATE INDEX `company_organization_created_idx` ON `company` (`organization_id`,`created_at`);--> statement-breakpoint
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
	`research_held_at` text,
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
CREATE INDEX `contact_organization_company_archived_idx` ON `contact` (`organization_id`,`company_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `contact_organization_created_idx` ON `contact` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `contact_company_idx` ON `contact` (`company_id`);--> statement-breakpoint
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
	`source` text DEFAULT 'MANUAL' NOT NULL,
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
CREATE INDEX `deal_organization_company_archived_idx` ON `deal` (`organization_id`,`company_id`,`archived_at`);--> statement-breakpoint
CREATE INDEX `deal_organization_created_idx` ON `deal` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `deal_company_idx` ON `deal` (`company_id`);--> statement-breakpoint
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
	`gmail_message_id` text,
	`outlook_message_id` text,
	`outlook_web_link` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`thread_id`) REFERENCES `email_thread`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_message_organization_rfc_uidx` ON `email_message` (`organization_id`,`rfc_message_id`);--> statement-breakpoint
CREATE INDEX `email_message_thread_sent_idx` ON `email_message` (`thread_id`,`sent_at`);--> statement-breakpoint
CREATE INDEX `email_message_organization_gmail_idx` ON `email_message` (`organization_id`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `email_message_organization_synced_by_idx` ON `email_message` (`organization_id`,`synced_by_user_id`);--> statement-breakpoint
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
CREATE INDEX `email_thread_company_idx` ON `email_thread` (`company_id`);--> statement-breakpoint
CREATE INDEX `email_thread_contact_idx` ON `email_thread` (`contact_id`);--> statement-breakpoint
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
	`next_fetch_at` text,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	PRIMARY KEY(`base_currency`, `quote_currency`)
);
--> statement-breakpoint
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
	`reporting_currency` text,
	`rates_refreshed_at` text,
	`archive_retention_days` integer DEFAULT 180 NOT NULL,
	`model_refused_at` text,
	`model_refusal` text,
	`model_answered_at` text,
	`enrichment_swept_at` text,
	`research_automatically` integer DEFAULT true NOT NULL,
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
CREATE INDEX `agent_task_organization_company_idx` ON `agent_task` (`organization_id`,`company_id`);--> statement-breakpoint
CREATE INDEX `agent_task_organization_deal_idx` ON `agent_task` (`organization_id`,`deal_id`);--> statement-breakpoint
CREATE INDEX `agent_task_open_due_idx` ON `agent_task` (`due_at`) WHERE "agent_task"."finished_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_task_open_kind_subject_uidx` ON `agent_task` (`organization_id`,`kind`,`subject`) WHERE "agent_task"."finished_at" is null;--> statement-breakpoint
CREATE TABLE `dispatcher_lane` (
	`lane` text PRIMARY KEY NOT NULL,
	`ran_at` text NOT NULL,
	`failed_at` text
);
--> statement-breakpoint
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
CREATE INDEX `form_submission_contact_idx` ON `form_submission` (`contact_id`);--> statement-breakpoint
CREATE INDEX `form_submission_created_idx` ON `form_submission` (`created_at`);--> statement-breakpoint
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
CREATE INDEX `tracked_visitor_contact_idx` ON `tracked_visitor` (`contact_id`);--> statement-breakpoint
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
CREATE UNIQUE INDEX `tracking_site_site_id_uidx` ON `tracking_site` (`site_id`);--> statement-breakpoint
CREATE TABLE `agent_action` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`run_id` text NOT NULL,
	`type` text NOT NULL,
	`provider` text NOT NULL,
	`target_type` text,
	`target_id` text,
	`target_label` text,
	`summary` text NOT NULL,
	`metadata` text,
	`status` text DEFAULT 'PLANNED' NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text,
	`external_id` text,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`planned_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`completed_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_definition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_action_organization_idempotency_uidx` ON `agent_action` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE INDEX `agent_action_run_planned_idx` ON `agent_action` (`run_id`,`planned_at`);--> statement-breakpoint
CREATE TABLE `agent_audit_event` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`version_id` text,
	`actor_user_id` text,
	`actor_type` text NOT NULL,
	`type` text NOT NULL,
	`summary` text NOT NULL,
	`before` text,
	`after` text,
	`request_id` text,
	`emitted_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_definition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `agent_version`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`actor_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_audit_event_agent_type_request_uidx` ON `agent_audit_event` (`agent_id`,`type`,`request_id`);--> statement-breakpoint
CREATE INDEX `agent_audit_event_agent_emitted_idx` ON `agent_audit_event` (`agent_id`,`emitted_at`);--> statement-breakpoint
CREATE TABLE `agent_builder_artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`conversation_id` text,
	`version_id` text,
	`path` text NOT NULL,
	`language` text NOT NULL,
	`content` text NOT NULL,
	`previous_content` text,
	`revision` integer NOT NULL,
	`status` text DEFAULT 'WRITING' NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`version_id`) REFERENCES `agent_version`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_builder_artifact_conversation_path_revision_uidx` ON `agent_builder_artifact` (`conversation_id`,`path`,`revision`) WHERE "agent_builder_artifact"."conversation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_builder_artifact_version_path_revision_uidx` ON `agent_builder_artifact` (`version_id`,`path`,`revision`) WHERE "agent_builder_artifact"."version_id" is not null;--> statement-breakpoint
CREATE TABLE `agent_conversation_attachment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`media_type` text NOT NULL,
	`size` integer NOT NULL,
	`storage_key` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_conversation_attachment_conversation_idx` ON `agent_conversation_attachment` (`conversation_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_conversation_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`message_id` text NOT NULL,
	`rating` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversation_feedback_message_uidx` ON `agent_conversation_feedback` (`conversation_id`,`user_id`,`message_id`);--> statement-breakpoint
CREATE TABLE `agent_definition` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`status` text DEFAULT 'DRAFT' NOT NULL,
	`created_by_id` text NOT NULL,
	`conversation_id` text,
	`current_version_id` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`archived_at` text,
	`deleted_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_definition_organization_status_idx` ON `agent_definition` (`organization_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_definition_conversation_uidx` ON `agent_definition` (`conversation_id`);--> statement-breakpoint
CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`version_id` text NOT NULL,
	`trigger_id` text,
	`initiated_by_id` text,
	`trigger_type` text NOT NULL,
	`status` text DEFAULT 'QUEUED' NOT NULL,
	`session_id` text,
	`idempotency_key` text NOT NULL,
	`input` text,
	`result` text,
	`summary` text,
	`no_action_needed` text,
	`model_id` text,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cost_usd` real DEFAULT 0 NOT NULL,
	`error_code` text,
	`error_message` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`started_at` text,
	`finished_at` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_definition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `agent_version`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`trigger_id`) REFERENCES `agent_trigger`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`initiated_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_organization_idempotency_uidx` ON `agent_run` (`organization_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_one_running_uidx` ON `agent_run` (`agent_id`) WHERE "agent_run"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX `agent_run_organization_agent_created_idx` ON `agent_run` (`organization_id`,`agent_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_run_status_created_idx` ON `agent_run` (`status`,`created_at`);--> statement-breakpoint
CREATE TABLE `agent_trigger` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`version_id` text NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`event` text,
	`interval_minutes` integer,
	`enabled` integer DEFAULT false NOT NULL,
	`next_run_at` text,
	`last_run_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_definition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`version_id`) REFERENCES `agent_version`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_trigger_enabled_next_run_idx` ON `agent_trigger` (`enabled`,`next_run_at`);--> statement-breakpoint
CREATE INDEX `agent_trigger_organization_event_idx` ON `agent_trigger` (`organization_id`,`event`,`enabled`);--> statement-breakpoint
CREATE INDEX `agent_trigger_agent_idx` ON `agent_trigger` (`agent_id`);--> statement-breakpoint
CREATE TABLE `agent_version` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`number` integer NOT NULL,
	`status` text DEFAULT 'READY' NOT NULL,
	`instructions` text NOT NULL,
	`manifest` text NOT NULL,
	`source_conversation_id` text,
	`created_by_id` text NOT NULL,
	`approved_at` text,
	`deployed_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agent_definition`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`source_conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_version_agent_number_uidx` ON `agent_version` (`agent_id`,`number`);--> statement-breakpoint
CREATE TABLE `slack_channel` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`slack_channel_id` text NOT NULL,
	`name` text NOT NULL,
	`member_count` integer,
	`available` integer DEFAULT true NOT NULL,
	`is_private` integer DEFAULT false NOT NULL,
	`is_member` integer DEFAULT false NOT NULL,
	`invite_requested_at` text,
	`classified_at` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_channel_organization_channel_uidx` ON `slack_channel` (`organization_id`,`slack_channel_id`);--> statement-breakpoint
CREATE INDEX `slack_channel_organization_name_idx` ON `slack_channel` (`organization_id`,`available`,`name`);--> statement-breakpoint
CREATE TABLE `slack_connection` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`team_id` text NOT NULL,
	`team_name` text,
	`bot_user_id` text,
	`bot_name` text,
	`bot_token` text NOT NULL,
	`bot_scopes` text NOT NULL,
	`user_token` text,
	`user_scopes` text,
	`connected_by_id` text,
	`connected_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`sync_started_at` text,
	`synced_at` text,
	`sync_error` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connected_by_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_connection_organization_uidx` ON `slack_connection` (`organization_id`);--> statement-breakpoint
CREATE TABLE `slack_member_match` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`slack_user_id` text,
	`slack_handle` text,
	`slack_email` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	`updated_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `slack_member_match_organization_user_uidx` ON `slack_member_match` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE TABLE `slack_oauth_state` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_conversation_share` (
	`conversation_id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')) NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `agent_conversation`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_conversation_share_token_hash_unique` ON `agent_conversation_share` (`token_hash`);