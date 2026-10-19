CREATE TABLE "paid_session" (
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"slot" integer NOT NULL,
	"session_id" text NOT NULL,
	"leased_until" text NOT NULL,
	CONSTRAINT "paid_session_organization_id_kind_slot_pk" PRIMARY KEY("organization_id","kind","slot")
);
--> statement-breakpoint
ALTER TABLE "member" ADD COLUMN "last_seen_at" text;--> statement-breakpoint
ALTER TABLE "company" ADD COLUMN "research_held_at" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "research_held_at" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "research_automatically" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "paid_session" ADD CONSTRAINT "paid_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_company_idx" ON "activity" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "activity_contact_idx" ON "activity" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "activity_deal_idx" ON "activity" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "calendar_event_company_idx" ON "calendar_event" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "calendar_event_contact_idx" ON "calendar_event" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "company_organization_created_idx" ON "company" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_organization_company_archived_idx" ON "contact" USING btree ("organization_id","company_id","archived_at");--> statement-breakpoint
CREATE INDEX "contact_organization_created_idx" ON "contact" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "contact_company_idx" ON "contact" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "deal_organization_company_archived_idx" ON "deal" USING btree ("organization_id","company_id","archived_at");--> statement-breakpoint
CREATE INDEX "deal_organization_created_idx" ON "deal" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "deal_company_idx" ON "deal" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "email_thread_company_idx" ON "email_thread" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "email_thread_contact_idx" ON "email_thread" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "agent_task_open_due_idx" ON "agent_task" USING btree ("due_at") WHERE "agent_task"."finished_at" is null;--> statement-breakpoint
CREATE INDEX "form_submission_contact_idx" ON "form_submission" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "form_submission_created_idx" ON "form_submission" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tracked_visitor_contact_idx" ON "tracked_visitor" USING btree ("contact_id");