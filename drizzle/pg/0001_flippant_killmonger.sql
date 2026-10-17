CREATE TABLE "agent_action" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"run_id" text NOT NULL,
	"type" text NOT NULL,
	"provider" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"target_label" text,
	"summary" text NOT NULL,
	"metadata" jsonb,
	"status" text DEFAULT 'PLANNED' NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_hash" text,
	"external_id" text,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"planned_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"started_at" text,
	"completed_at" text
);
--> statement-breakpoint
CREATE TABLE "agent_audit_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version_id" text,
	"actor_user_id" text,
	"actor_type" text NOT NULL,
	"type" text NOT NULL,
	"summary" text NOT NULL,
	"before" jsonb,
	"after" jsonb,
	"request_id" text,
	"emitted_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_builder_artifact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text,
	"version_id" text,
	"path" text NOT NULL,
	"language" text NOT NULL,
	"content" text NOT NULL,
	"previous_content" text,
	"revision" integer NOT NULL,
	"status" text DEFAULT 'WRITING' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversation_attachment" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"media_type" text NOT NULL,
	"size" integer NOT NULL,
	"storage_key" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversation_feedback" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"user_id" text NOT NULL,
	"message_id" text NOT NULL,
	"rating" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"created_by_id" text NOT NULL,
	"conversation_id" text,
	"current_version_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"archived_at" text,
	"deleted_at" text
);
--> statement-breakpoint
CREATE TABLE "agent_run" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version_id" text NOT NULL,
	"trigger_id" text,
	"initiated_by_id" text,
	"trigger_type" text NOT NULL,
	"status" text DEFAULT 'QUEUED' NOT NULL,
	"session_id" text,
	"idempotency_key" text NOT NULL,
	"input" jsonb,
	"result" jsonb,
	"summary" text,
	"no_action_needed" text,
	"model_id" text,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" double precision DEFAULT 0 NOT NULL,
	"error_code" text,
	"error_message" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"started_at" text,
	"finished_at" text
);
--> statement-breakpoint
CREATE TABLE "agent_trigger" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"version_id" text NOT NULL,
	"type" text NOT NULL,
	"name" text NOT NULL,
	"summary" text NOT NULL,
	"event" text,
	"interval_minutes" integer,
	"enabled" boolean DEFAULT false NOT NULL,
	"next_run_at" text,
	"last_run_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_version" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"number" integer NOT NULL,
	"status" text DEFAULT 'READY' NOT NULL,
	"instructions" text NOT NULL,
	"manifest" jsonb NOT NULL,
	"model_id" text NOT NULL,
	"source_conversation_id" text,
	"created_by_id" text NOT NULL,
	"approved_at" text,
	"deployed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_channel" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"name" text NOT NULL,
	"member_count" integer,
	"available" boolean DEFAULT true NOT NULL,
	"is_private" boolean DEFAULT false NOT NULL,
	"is_member" boolean DEFAULT false NOT NULL,
	"invite_requested_at" text,
	"classified_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"team_id" text NOT NULL,
	"team_name" text,
	"bot_user_id" text,
	"bot_token" text NOT NULL,
	"bot_scopes" text NOT NULL,
	"user_token" text,
	"user_scopes" text,
	"connected_by_id" text,
	"connected_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"sync_started_at" text,
	"synced_at" text,
	"sync_error" text
);
--> statement-breakpoint
CREATE TABLE "slack_member_match" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"slack_user_id" text,
	"slack_handle" text,
	"slack_email" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_oauth_state" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_action" ADD CONSTRAINT "agent_action_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action" ADD CONSTRAINT "agent_action_agent_id_agent_definition_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_action" ADD CONSTRAINT "agent_action_run_id_agent_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_run"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_audit_event" ADD CONSTRAINT "agent_audit_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_audit_event" ADD CONSTRAINT "agent_audit_event_agent_id_agent_definition_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_audit_event" ADD CONSTRAINT "agent_audit_event_version_id_agent_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_version"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_audit_event" ADD CONSTRAINT "agent_audit_event_actor_user_id_user_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_builder_artifact" ADD CONSTRAINT "agent_builder_artifact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_builder_artifact" ADD CONSTRAINT "agent_builder_artifact_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_builder_artifact" ADD CONSTRAINT "agent_builder_artifact_version_id_agent_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_attachment" ADD CONSTRAINT "agent_conversation_attachment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_attachment" ADD CONSTRAINT "agent_conversation_attachment_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_attachment" ADD CONSTRAINT "agent_conversation_attachment_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_feedback" ADD CONSTRAINT "agent_conversation_feedback_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_feedback" ADD CONSTRAINT "agent_conversation_feedback_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation_feedback" ADD CONSTRAINT "agent_conversation_feedback_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_definition" ADD CONSTRAINT "agent_definition_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_agent_id_agent_definition_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_version_id_agent_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_trigger_id_agent_trigger_id_fk" FOREIGN KEY ("trigger_id") REFERENCES "public"."agent_trigger"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_run" ADD CONSTRAINT "agent_run_initiated_by_id_user_id_fk" FOREIGN KEY ("initiated_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trigger" ADD CONSTRAINT "agent_trigger_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trigger" ADD CONSTRAINT "agent_trigger_agent_id_agent_definition_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_trigger" ADD CONSTRAINT "agent_trigger_version_id_agent_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."agent_version"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_agent_id_agent_definition_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agent_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_source_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("source_conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_version" ADD CONSTRAINT "agent_version_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channel" ADD CONSTRAINT "slack_channel_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connection" ADD CONSTRAINT "slack_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_connection" ADD CONSTRAINT "slack_connection_connected_by_id_user_id_fk" FOREIGN KEY ("connected_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_member_match" ADD CONSTRAINT "slack_member_match_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_member_match" ADD CONSTRAINT "slack_member_match_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_oauth_state" ADD CONSTRAINT "slack_oauth_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_oauth_state" ADD CONSTRAINT "slack_oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_action_organization_idempotency_uidx" ON "agent_action" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "agent_action_run_planned_idx" ON "agent_action" USING btree ("run_id","planned_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_audit_event_agent_type_request_uidx" ON "agent_audit_event" USING btree ("agent_id","type","request_id");--> statement-breakpoint
CREATE INDEX "agent_audit_event_agent_emitted_idx" ON "agent_audit_event" USING btree ("agent_id","emitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_builder_artifact_conversation_path_revision_uidx" ON "agent_builder_artifact" USING btree ("conversation_id","path","revision") WHERE "agent_builder_artifact"."conversation_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_builder_artifact_version_path_revision_uidx" ON "agent_builder_artifact" USING btree ("version_id","path","revision") WHERE "agent_builder_artifact"."version_id" is not null;--> statement-breakpoint
CREATE INDEX "agent_conversation_attachment_conversation_idx" ON "agent_conversation_attachment" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_conversation_feedback_message_uidx" ON "agent_conversation_feedback" USING btree ("conversation_id","user_id","message_id");--> statement-breakpoint
CREATE INDEX "agent_definition_organization_status_idx" ON "agent_definition" USING btree ("organization_id","status","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_definition_conversation_uidx" ON "agent_definition" USING btree ("conversation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_organization_idempotency_uidx" ON "agent_run" USING btree ("organization_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_run_one_running_uidx" ON "agent_run" USING btree ("agent_id") WHERE "agent_run"."status" = 'RUNNING';--> statement-breakpoint
CREATE INDEX "agent_run_organization_agent_created_idx" ON "agent_run" USING btree ("organization_id","agent_id","created_at");--> statement-breakpoint
CREATE INDEX "agent_run_status_created_idx" ON "agent_run" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "agent_trigger_enabled_next_run_idx" ON "agent_trigger" USING btree ("enabled","next_run_at");--> statement-breakpoint
CREATE INDEX "agent_trigger_organization_event_idx" ON "agent_trigger" USING btree ("organization_id","event","enabled");--> statement-breakpoint
CREATE INDEX "agent_trigger_agent_idx" ON "agent_trigger" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_version_agent_number_uidx" ON "agent_version" USING btree ("agent_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channel_organization_channel_uidx" ON "slack_channel" USING btree ("organization_id","slack_channel_id");--> statement-breakpoint
CREATE INDEX "slack_channel_organization_name_idx" ON "slack_channel" USING btree ("organization_id","available","name");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_connection_organization_uidx" ON "slack_connection" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_member_match_organization_user_uidx" ON "slack_member_match" USING btree ("organization_id","user_id");