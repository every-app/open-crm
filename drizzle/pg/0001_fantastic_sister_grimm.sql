CREATE TABLE "mailbox_connection" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"account_email" text NOT NULL,
	"scopes" text NOT NULL,
	"access_token" text,
	"access_token_expires_at" text,
	"refresh_token" text,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mailbox_sync" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'IDLE' NOT NULL,
	"cursor" text,
	"auto_create" boolean DEFAULT false NOT NULL,
	"last_synced_at" text,
	"last_error" text,
	"next_sync_at" text,
	"lease_until" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "oauth_state" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"code_verifier" text NOT NULL,
	"expires_at" text NOT NULL,
	"consumed_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "gmail_message_id" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "outlook_message_id" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "outlook_web_link" text;--> statement-breakpoint
ALTER TABLE "mailbox_connection" ADD CONSTRAINT "mailbox_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_connection" ADD CONSTRAINT "mailbox_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_sync" ADD CONSTRAINT "mailbox_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_sync" ADD CONSTRAINT "mailbox_sync_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_state" ADD CONSTRAINT "oauth_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_state" ADD CONSTRAINT "oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_connection_organization_user_provider_uidx" ON "mailbox_connection" USING btree ("organization_id","user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_sync_organization_user_source_uidx" ON "mailbox_sync" USING btree ("organization_id","user_id","source");--> statement-breakpoint
CREATE INDEX "mailbox_sync_next_idx" ON "mailbox_sync" USING btree ("next_sync_at");--> statement-breakpoint
CREATE INDEX "oauth_state_expires_idx" ON "oauth_state" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "calendar_event_organization_synced_by_idx" ON "calendar_event" USING btree ("organization_id","synced_by_user_id");--> statement-breakpoint
CREATE INDEX "email_message_organization_gmail_idx" ON "email_message" USING btree ("organization_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "email_message_organization_synced_by_idx" ON "email_message" USING btree ("organization_id","synced_by_user_id");