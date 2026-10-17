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
CREATE TABLE "form_submission" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"visitor_id" text,
	"contact_id" text,
	"host" text NOT NULL,
	"path" text NOT NULL,
	"email" text,
	"fields" jsonb NOT NULL,
	"first_touch" jsonb,
	"last_touch" jsonb,
	"dedupe_key" text NOT NULL,
	"filed_at" text,
	"skip_reason" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_domain" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"host" text NOT NULL,
	"scope" text DEFAULT 'EXACT_HOST' NOT NULL,
	"page_views" integer DEFAULT 0 NOT NULL,
	"last_seen_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"visitor_id" text NOT NULL,
	"type" text NOT NULL,
	"host" text NOT NULL,
	"path" text NOT NULL,
	"referrer" text,
	"label" text,
	"source" text,
	"medium" text,
	"campaign" text,
	"occurred_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracked_page_daily" (
	"organization_id" text NOT NULL,
	"day" text NOT NULL,
	"host" text NOT NULL,
	"path" text NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"visitors" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "tracked_page_daily_organization_id_day_host_path_pk" PRIMARY KEY("organization_id","day","host","path")
);
--> statement-breakpoint
CREATE TABLE "tracked_visitor" (
	"organization_id" text NOT NULL,
	"id" text NOT NULL,
	"contact_id" text,
	"first_source" text,
	"first_medium" text,
	"first_campaign" text,
	"first_term" text,
	"first_content" text,
	"first_referrer" text,
	"first_landing" text,
	"first_touch_at" text,
	"last_source" text,
	"last_medium" text,
	"last_campaign" text,
	"last_term" text,
	"last_content" text,
	"last_referrer" text,
	"last_landing" text,
	"last_touch_at" text,
	"first_seen" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_seen" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "tracked_visitor_organization_id_id_pk" PRIMARY KEY("organization_id","id")
);
--> statement-breakpoint
CREATE TABLE "tracking_counter" (
	"organization_id" text NOT NULL,
	"key" text NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	"expires_at" text NOT NULL,
	CONSTRAINT "tracking_counter_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
CREATE TABLE "tracking_site" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"site_id" text,
	"cross_domain" boolean DEFAULT true NOT NULL,
	"limit_to_domains" boolean DEFAULT true NOT NULL,
	"cookie_subdomains" boolean DEFAULT false NOT NULL,
	"secure_cookies" boolean DEFAULT true NOT NULL,
	"honour_dnt" boolean DEFAULT true NOT NULL,
	"cookie_days" integer DEFAULT 395 NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "calendar_event" ADD COLUMN "google_event_id" text;--> statement-breakpoint
ALTER TABLE "deal" ADD COLUMN "source" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "gmail_message_id" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "outlook_message_id" text;--> statement-breakpoint
ALTER TABLE "email_message" ADD COLUMN "outlook_web_link" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "model_refused_at" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "model_refusal" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "model_answered_at" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "setup_dismissed_at" text;--> statement-breakpoint
ALTER TABLE "mailbox_connection" ADD CONSTRAINT "mailbox_connection_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_connection" ADD CONSTRAINT "mailbox_connection_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_sync" ADD CONSTRAINT "mailbox_sync_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailbox_sync" ADD CONSTRAINT "mailbox_sync_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_state" ADD CONSTRAINT "oauth_state_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "oauth_state" ADD CONSTRAINT "oauth_state_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "form_submission" ADD CONSTRAINT "form_submission_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_domain" ADD CONSTRAINT "tracked_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_event" ADD CONSTRAINT "tracked_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_page_daily" ADD CONSTRAINT "tracked_page_daily_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_visitor" ADD CONSTRAINT "tracked_visitor_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracked_visitor" ADD CONSTRAINT "tracked_visitor_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_counter" ADD CONSTRAINT "tracking_counter_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_site" ADD CONSTRAINT "tracking_site_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_connection_organization_user_provider_uidx" ON "mailbox_connection" USING btree ("organization_id","user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "mailbox_sync_organization_user_source_uidx" ON "mailbox_sync" USING btree ("organization_id","user_id","source");--> statement-breakpoint
CREATE INDEX "mailbox_sync_next_idx" ON "mailbox_sync" USING btree ("next_sync_at");--> statement-breakpoint
CREATE INDEX "oauth_state_expires_idx" ON "oauth_state" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "form_submission_organization_dedupe_uidx" ON "form_submission" USING btree ("organization_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "form_submission_organization_contact_idx" ON "form_submission" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tracked_domain_organization_host_uidx" ON "tracked_domain" USING btree ("organization_id","host");--> statement-breakpoint
CREATE INDEX "tracked_event_organization_visitor_occurred_idx" ON "tracked_event" USING btree ("organization_id","visitor_id","occurred_at");--> statement-breakpoint
CREATE INDEX "tracked_event_organization_host_occurred_idx" ON "tracked_event" USING btree ("organization_id","host","occurred_at");--> statement-breakpoint
CREATE INDEX "tracked_event_organization_source_idx" ON "tracked_event" USING btree ("organization_id","source","medium");--> statement-breakpoint
CREATE INDEX "tracked_event_occurred_idx" ON "tracked_event" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "tracked_visitor_organization_contact_idx" ON "tracked_visitor" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "tracking_counter_expires_idx" ON "tracking_counter" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_site_site_id_uidx" ON "tracking_site" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "calendar_event_organization_synced_by_idx" ON "calendar_event" USING btree ("organization_id","synced_by_user_id");--> statement-breakpoint
CREATE INDEX "email_message_organization_gmail_idx" ON "email_message" USING btree ("organization_id","gmail_message_id");--> statement-breakpoint
CREATE INDEX "email_message_organization_synced_by_idx" ON "email_message" USING btree ("organization_id","synced_by_user_id");