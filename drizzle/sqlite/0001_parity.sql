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
	`model_id` text NOT NULL,
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
ALTER TABLE `calendar_event` ADD `google_event_id` text;--> statement-breakpoint
CREATE INDEX `calendar_event_organization_synced_by_idx` ON `calendar_event` (`organization_id`,`synced_by_user_id`);--> statement-breakpoint
ALTER TABLE `deal` ADD `source` text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE `email_message` ADD `gmail_message_id` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `outlook_message_id` text;--> statement-breakpoint
ALTER TABLE `email_message` ADD `outlook_web_link` text;--> statement-breakpoint
CREATE INDEX `email_message_organization_gmail_idx` ON `email_message` (`organization_id`,`gmail_message_id`);--> statement-breakpoint
CREATE INDEX `email_message_organization_synced_by_idx` ON `email_message` (`organization_id`,`synced_by_user_id`);--> statement-breakpoint
ALTER TABLE `workspace` ADD `model_refused_at` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `model_refusal` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `model_answered_at` text;--> statement-breakpoint
ALTER TABLE `workspace` ADD `setup_dismissed_at` text;