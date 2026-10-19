CREATE TABLE "paid_session" (
	"organization_id" text NOT NULL,
	"kind" text NOT NULL,
	"slot" integer NOT NULL,
	"session_id" text NOT NULL,
	"leased_until" text NOT NULL,
	CONSTRAINT "paid_session_organization_id_kind_slot_pk" PRIMARY KEY("organization_id","kind","slot")
);
--> statement-breakpoint
ALTER TABLE "paid_session" ADD CONSTRAINT "paid_session_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;