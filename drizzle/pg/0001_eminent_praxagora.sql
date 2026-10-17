ALTER TABLE "deal" ADD COLUMN "source" text DEFAULT 'MANUAL' NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "model_refused_at" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "model_refusal" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "model_answered_at" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "setup_dismissed_at" text;