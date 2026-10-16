CREATE TABLE "member" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organization" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"logo" text,
	"created_at" timestamp with time zone NOT NULL,
	"metadata" text,
	CONSTRAINT "organization_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "activity" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"type" text NOT NULL,
	"subject" text,
	"body" text,
	"occurred_at" text,
	"due_at" text,
	"completed_at" text,
	"company_id" text,
	"contact_id" text,
	"deal_id" text,
	"created_by_id" text,
	"meta" jsonb,
	"email_thread_id" text,
	"calendar_event_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "calendar_attendee" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"event_id" text NOT NULL,
	"email" text NOT NULL,
	"name" text,
	"response_status" text,
	"is_organizer" boolean DEFAULT false NOT NULL,
	"contact_id" text
);
--> statement-breakpoint
CREATE TABLE "calendar_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"ical_uid" text NOT NULL,
	"original_start_time" text NOT NULL,
	"recurring_event_id" text,
	"title" text,
	"description" text,
	"location" text,
	"conference_url" text,
	"starts_at" text NOT NULL,
	"ends_at" text NOT NULL,
	"is_all_day" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"organizer_email" text,
	"company_id" text,
	"contact_id" text,
	"synced_by_user_id" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"website" text,
	"description" text,
	"logo_url" text,
	"logo_dark_url" text,
	"icon_url" text,
	"icon_dark_url" text,
	"icon_tone" text,
	"brand_color" text,
	"industry" text,
	"sub_industry" text,
	"city" text,
	"state_code" text,
	"country" text,
	"country_code" text,
	"phone" text,
	"email" text,
	"linkedin_url" text,
	"twitter_url" text,
	"github_url" text,
	"pricing_url" text,
	"careers_url" text,
	"owner_id" text,
	"primary_contact_id" text,
	"enrichment_status" text DEFAULT 'PENDING' NOT NULL,
	"enriched_at" text,
	"enrichment_error" text,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"last_activity_at" text,
	"archived_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "company_enrichment" (
	"company_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"source" text DEFAULT 'context.dev' NOT NULL,
	"raw" jsonb NOT NULL,
	"fetched_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text,
	"email" text,
	"phone" text,
	"title" text,
	"seniority" text,
	"function" text,
	"linkedin_url" text,
	"twitter_url" text,
	"github_url" text,
	"image_url" text,
	"socials_checked_at" text,
	"enrichment_status" text DEFAULT 'PENDING' NOT NULL,
	"enriched_at" text,
	"enrichment_error" text,
	"company_id" text,
	"owner_id" text,
	"source" text DEFAULT 'MANUAL' NOT NULL,
	"last_activity_at" text,
	"archived_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_brief" (
	"contact_id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"narrative" text NOT NULL,
	"sections" jsonb NOT NULL,
	"score" double precision NOT NULL,
	"source_url" text,
	"session_id" text,
	"refreshed_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_fact" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"field" text NOT NULL,
	"value" text NOT NULL,
	"score" double precision NOT NULL,
	"band" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"method" text NOT NULL,
	"source_url" text,
	"session_id" text,
	"status" text DEFAULT 'PROPOSED' NOT NULL,
	"decided_by_id" text,
	"decided_at" text,
	"observed_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"superseded_at" text
);
--> statement-breakpoint
CREATE TABLE "deal" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"company_id" text NOT NULL,
	"owner_id" text NOT NULL,
	"stage" text DEFAULT 'DEMO_BOOKED' NOT NULL,
	"stage_changed_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"amount" double precision,
	"currency" text DEFAULT 'USD' NOT NULL,
	"expected_close_date" text,
	"closed_at" text,
	"closed_reason" text,
	"base_amount" double precision,
	"base_currency" text,
	"fx_rate" double precision,
	"fx_rate_at" text,
	"last_activity_at" text,
	"archived_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deal_contact" (
	"deal_id" text NOT NULL,
	"contact_id" text NOT NULL,
	"organization_id" text NOT NULL,
	"role" text,
	CONSTRAINT "deal_contact_deal_id_contact_id_pk" PRIMARY KEY("deal_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "email_message" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"thread_id" text NOT NULL,
	"rfc_message_id" text NOT NULL,
	"synced_by_user_id" text,
	"direction" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"recipients" jsonb NOT NULL,
	"subject" text,
	"snippet" text,
	"body" text,
	"sent_at" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_thread" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"root_message_id" text NOT NULL,
	"subject" text,
	"company_id" text,
	"contact_id" text,
	"first_message_at" text NOT NULL,
	"last_message_at" text NOT NULL,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_definition" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity" text NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"type" text NOT NULL,
	"agent_filled" boolean DEFAULT true NOT NULL,
	"agent_brief" text,
	"required" boolean DEFAULT false NOT NULL,
	"show_on_sheet" boolean DEFAULT true NOT NULL,
	"show_on_table" boolean DEFAULT false NOT NULL,
	"show_on_filter" boolean DEFAULT false NOT NULL,
	"position" integer NOT NULL,
	"archived_at" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_option" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"field_id" text NOT NULL,
	"label" text NOT NULL,
	"position" integer NOT NULL,
	"archived_at" text
);
--> statement-breakpoint
CREATE TABLE "field_value" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"field_id" text NOT NULL,
	"company_id" text,
	"contact_id" text,
	"deal_id" text,
	"text" text,
	"number" double precision,
	"date" text,
	"bool" boolean,
	"option_id" text,
	"user_id" text,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rate" (
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" double precision NOT NULL,
	"as_of" text NOT NULL,
	"provider" text,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "fx_rate_base_currency_quote_currency_pk" PRIMARY KEY("base_currency","quote_currency")
);
--> statement-breakpoint
CREATE TABLE "manual_fx_rate" (
	"organization_id" text NOT NULL,
	"base_currency" text NOT NULL,
	"quote_currency" text NOT NULL,
	"rate" double precision NOT NULL,
	"as_of" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "manual_fx_rate_organization_id_base_currency_quote_currency_pk" PRIMARY KEY("organization_id","base_currency","quote_currency")
);
--> statement-breakpoint
CREATE TABLE "saved_view" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"entity" text NOT NULL,
	"name" text NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"filters" jsonb NOT NULL,
	"owner_id" text NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppressed_contact" (
	"organization_id" text NOT NULL,
	"email" text NOT NULL,
	"reason" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "suppressed_contact_organization_id_email_pk" PRIMARY KEY("organization_id","email")
);
--> statement-breakpoint
CREATE TABLE "suppressed_domain" (
	"organization_id" text NOT NULL,
	"domain" text NOT NULL,
	"reason" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	CONSTRAINT "suppressed_domain_organization_id_domain_pk" PRIMARY KEY("organization_id","domain")
);
--> statement-breakpoint
CREATE TABLE "workspace" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"website" text,
	"onboarded_at" text,
	"agent_model_id" text,
	"agent_model_context_window" integer,
	"reporting_currency" text,
	"rates_refreshed_at" text,
	"archive_retention_days" integer DEFAULT 180 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspace_profile" (
	"organization_id" text PRIMARY KEY NOT NULL,
	"website" text NOT NULL,
	"narrative" text NOT NULL,
	"sections" jsonb NOT NULL,
	"source_url" text,
	"session_id" text,
	"refreshed_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_conversation" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"kind" text DEFAULT 'RECORD' NOT NULL,
	"contact_id" text,
	"company_id" text,
	"deal_id" text,
	"user_id" text NOT NULL,
	"session_id" text NOT NULL,
	"title" text,
	"message_count" integer DEFAULT 0 NOT NULL,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"updated_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_message_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL,
	"last_assistant_at" text,
	"last_read_at" text,
	CONSTRAINT "agent_conversation_session_id_unique" UNIQUE("session_id")
);
--> statement-breakpoint
CREATE TABLE "agent_event" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"session_id" text NOT NULL,
	"contact_id" text,
	"company_id" text,
	"deal_id" text,
	"conversation_id" text,
	"type" text NOT NULL,
	"data" jsonb NOT NULL,
	"emitted_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_task" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"contact_id" text,
	"company_id" text,
	"deal_id" text,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"payload" jsonb,
	"priority" integer DEFAULT 0 NOT NULL,
	"budget" integer DEFAULT 4 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"due_at" text NOT NULL,
	"leased_until" text,
	"session_id" text,
	"started_at" text,
	"finished_at" text,
	"outcome" text,
	"subject" text,
	"created_at" text DEFAULT to_char(now() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member" ADD CONSTRAINT "member_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_created_by_id_user_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_email_thread_id_email_thread_id_fk" FOREIGN KEY ("email_thread_id") REFERENCES "public"."email_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity" ADD CONSTRAINT "activity_calendar_event_id_calendar_event_id_fk" FOREIGN KEY ("calendar_event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_attendee" ADD CONSTRAINT "calendar_attendee_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_attendee" ADD CONSTRAINT "calendar_attendee_event_id_calendar_event_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."calendar_event"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_attendee" ADD CONSTRAINT "calendar_attendee_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calendar_event" ADD CONSTRAINT "calendar_event_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company" ADD CONSTRAINT "company_primary_contact_id_contact_id_fk" FOREIGN KEY ("primary_contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_enrichment" ADD CONSTRAINT "company_enrichment_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "company_enrichment" ADD CONSTRAINT "company_enrichment_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact" ADD CONSTRAINT "contact_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_brief" ADD CONSTRAINT "contact_brief_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_brief" ADD CONSTRAINT "contact_brief_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fact" ADD CONSTRAINT "contact_fact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fact" ADD CONSTRAINT "contact_fact_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_fact" ADD CONSTRAINT "contact_fact_decided_by_id_user_id_fk" FOREIGN KEY ("decided_by_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal" ADD CONSTRAINT "deal_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contact" ADD CONSTRAINT "deal_contact_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contact" ADD CONSTRAINT "deal_contact_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_contact" ADD CONSTRAINT "deal_contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_message" ADD CONSTRAINT "email_message_thread_id_email_thread_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."email_thread"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread" ADD CONSTRAINT "email_thread_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread" ADD CONSTRAINT "email_thread_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_thread" ADD CONSTRAINT "email_thread_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_definition" ADD CONSTRAINT "field_definition_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_option" ADD CONSTRAINT "field_option_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_option" ADD CONSTRAINT "field_option_field_id_field_definition_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_field_id_field_definition_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."field_definition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_option_id_field_option_id_fk" FOREIGN KEY ("option_id") REFERENCES "public"."field_option"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_value" ADD CONSTRAINT "field_value_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_fx_rate" ADD CONSTRAINT "manual_fx_rate_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_view" ADD CONSTRAINT "saved_view_owner_id_user_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressed_contact" ADD CONSTRAINT "suppressed_contact_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppressed_domain" ADD CONSTRAINT "suppressed_domain_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_profile" ADD CONSTRAINT "workspace_profile_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_contact_id_contact_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contact"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_company_id_company_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."company"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_deal_id_deal_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deal"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_conversation" ADD CONSTRAINT "agent_conversation_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_event" ADD CONSTRAINT "agent_event_conversation_id_agent_conversation_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."agent_conversation"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_task" ADD CONSTRAINT "agent_task_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_organizationId_idx" ON "member" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "member_userId_idx" ON "member" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "member_organizationId_userId_uidx" ON "member" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_slug_uidx" ON "organization" USING btree ("slug");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_email_thread_uidx" ON "activity" USING btree ("email_thread_id");--> statement-breakpoint
CREATE UNIQUE INDEX "activity_calendar_event_uidx" ON "activity" USING btree ("calendar_event_id");--> statement-breakpoint
CREATE INDEX "activity_organization_company_created_idx" ON "activity" USING btree ("organization_id","company_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_organization_deal_created_idx" ON "activity" USING btree ("organization_id","deal_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_organization_contact_created_idx" ON "activity" USING btree ("organization_id","contact_id","created_at");--> statement-breakpoint
CREATE INDEX "activity_organization_due_idx" ON "activity" USING btree ("organization_id","due_at");--> statement-breakpoint
CREATE INDEX "activity_created_by_idx" ON "activity" USING btree ("created_by_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_attendee_event_email_uidx" ON "calendar_attendee" USING btree ("event_id","email");--> statement-breakpoint
CREATE INDEX "calendar_attendee_contact_idx" ON "calendar_attendee" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "calendar_event_organization_ical_start_uidx" ON "calendar_event" USING btree ("organization_id","ical_uid","original_start_time");--> statement-breakpoint
CREATE INDEX "calendar_event_organization_company_starts_idx" ON "calendar_event" USING btree ("organization_id","company_id","starts_at");--> statement-breakpoint
CREATE INDEX "calendar_event_organization_contact_starts_idx" ON "calendar_event" USING btree ("organization_id","contact_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "company_organization_domain_active_uidx" ON "company" USING btree ("organization_id","domain") WHERE "company"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "company_primary_contact_uidx" ON "company" USING btree ("primary_contact_id");--> statement-breakpoint
CREATE INDEX "company_organization_owner_idx" ON "company" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "company_organization_name_idx" ON "company" USING btree ("organization_id","name");--> statement-breakpoint
CREATE INDEX "company_organization_last_activity_idx" ON "company" USING btree ("organization_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "company_organization_archived_idx" ON "company" USING btree ("organization_id","archived_at");--> statement-breakpoint
CREATE UNIQUE INDEX "contact_organization_email_active_uidx" ON "contact" USING btree ("organization_id","email") WHERE "contact"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "contact_organization_company_idx" ON "contact" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "contact_organization_owner_idx" ON "contact" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "contact_organization_last_activity_idx" ON "contact" USING btree ("organization_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "contact_organization_archived_idx" ON "contact" USING btree ("organization_id","archived_at");--> statement-breakpoint
CREATE INDEX "contact_fact_contact_field_status_idx" ON "contact_fact" USING btree ("contact_id","field","status");--> statement-breakpoint
CREATE INDEX "contact_fact_organization_status_observed_idx" ON "contact_fact" USING btree ("organization_id","status","observed_at");--> statement-breakpoint
CREATE INDEX "deal_organization_company_idx" ON "deal" USING btree ("organization_id","company_id");--> statement-breakpoint
CREATE INDEX "deal_organization_owner_idx" ON "deal" USING btree ("organization_id","owner_id");--> statement-breakpoint
CREATE INDEX "deal_organization_stage_idx" ON "deal" USING btree ("organization_id","stage");--> statement-breakpoint
CREATE INDEX "deal_organization_expected_close_idx" ON "deal" USING btree ("organization_id","expected_close_date");--> statement-breakpoint
CREATE INDEX "deal_organization_last_activity_idx" ON "deal" USING btree ("organization_id","last_activity_at");--> statement-breakpoint
CREATE INDEX "deal_organization_base_amount_idx" ON "deal" USING btree ("organization_id","base_amount");--> statement-breakpoint
CREATE INDEX "deal_organization_currency_idx" ON "deal" USING btree ("organization_id","currency");--> statement-breakpoint
CREATE INDEX "deal_organization_archived_idx" ON "deal" USING btree ("organization_id","archived_at");--> statement-breakpoint
CREATE INDEX "deal_contact_contact_idx" ON "deal_contact" USING btree ("contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "email_message_organization_rfc_uidx" ON "email_message" USING btree ("organization_id","rfc_message_id");--> statement-breakpoint
CREATE INDEX "email_message_thread_sent_idx" ON "email_message" USING btree ("thread_id","sent_at");--> statement-breakpoint
CREATE UNIQUE INDEX "email_thread_organization_root_uidx" ON "email_thread" USING btree ("organization_id","root_message_id");--> statement-breakpoint
CREATE INDEX "email_thread_organization_company_last_idx" ON "email_thread" USING btree ("organization_id","company_id","last_message_at");--> statement-breakpoint
CREATE INDEX "email_thread_organization_contact_last_idx" ON "email_thread" USING btree ("organization_id","contact_id","last_message_at");--> statement-breakpoint
CREATE UNIQUE INDEX "field_definition_organization_entity_key_uidx" ON "field_definition" USING btree ("organization_id","entity","key");--> statement-breakpoint
CREATE INDEX "field_definition_organization_entity_position_idx" ON "field_definition" USING btree ("organization_id","entity","position");--> statement-breakpoint
CREATE INDEX "field_option_field_position_idx" ON "field_option" USING btree ("field_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "field_value_field_company_uidx" ON "field_value" USING btree ("field_id","company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_value_field_contact_uidx" ON "field_value" USING btree ("field_id","contact_id");--> statement-breakpoint
CREATE UNIQUE INDEX "field_value_field_deal_uidx" ON "field_value" USING btree ("field_id","deal_id");--> statement-breakpoint
CREATE INDEX "field_value_field_text_idx" ON "field_value" USING btree ("field_id","text");--> statement-breakpoint
CREATE INDEX "field_value_field_number_idx" ON "field_value" USING btree ("field_id","number");--> statement-breakpoint
CREATE INDEX "field_value_field_date_idx" ON "field_value" USING btree ("field_id","date");--> statement-breakpoint
CREATE INDEX "field_value_company_idx" ON "field_value" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "field_value_contact_idx" ON "field_value" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "field_value_deal_idx" ON "field_value" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "field_value_option_idx" ON "field_value" USING btree ("option_id");--> statement-breakpoint
CREATE INDEX "field_value_user_idx" ON "field_value" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_view_organization_entity_owner_name_uidx" ON "saved_view" USING btree ("organization_id","entity","owner_id","name");--> statement-breakpoint
CREATE INDEX "saved_view_organization_entity_shared_idx" ON "saved_view" USING btree ("organization_id","entity","shared");--> statement-breakpoint
CREATE INDEX "agent_conversation_contact_last_idx" ON "agent_conversation" USING btree ("contact_id","last_message_at");--> statement-breakpoint
CREATE INDEX "agent_conversation_company_last_idx" ON "agent_conversation" USING btree ("company_id","last_message_at");--> statement-breakpoint
CREATE INDEX "agent_conversation_deal_last_idx" ON "agent_conversation" USING btree ("deal_id","last_message_at");--> statement-breakpoint
CREATE INDEX "agent_conversation_organization_user_kind_last_idx" ON "agent_conversation" USING btree ("organization_id","user_id","kind","last_message_at");--> statement-breakpoint
CREATE INDEX "agent_event_session_emitted_idx" ON "agent_event" USING btree ("session_id","emitted_at");--> statement-breakpoint
CREATE INDEX "agent_event_organization_contact_emitted_idx" ON "agent_event" USING btree ("organization_id","contact_id","emitted_at");--> statement-breakpoint
CREATE INDEX "agent_event_organization_company_emitted_idx" ON "agent_event" USING btree ("organization_id","company_id","emitted_at");--> statement-breakpoint
CREATE INDEX "agent_event_organization_deal_emitted_idx" ON "agent_event" USING btree ("organization_id","deal_id","emitted_at");--> statement-breakpoint
CREATE INDEX "agent_event_conversation_emitted_idx" ON "agent_event" USING btree ("conversation_id","emitted_at");--> statement-breakpoint
CREATE INDEX "agent_task_due_lease_idx" ON "agent_task" USING btree ("due_at","leased_until");--> statement-breakpoint
CREATE INDEX "agent_task_organization_contact_idx" ON "agent_task" USING btree ("organization_id","contact_id");--> statement-breakpoint
CREATE INDEX "agent_task_organization_deal_idx" ON "agent_task" USING btree ("organization_id","deal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_task_open_kind_subject_uidx" ON "agent_task" USING btree ("organization_id","kind","subject") WHERE "agent_task"."finished_at" is null;