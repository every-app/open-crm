ALTER TABLE "company" ADD COLUMN "research_held_at" text;--> statement-breakpoint
ALTER TABLE "contact" ADD COLUMN "research_held_at" text;--> statement-breakpoint
ALTER TABLE "workspace" ADD COLUMN "research_automatically" boolean DEFAULT true NOT NULL;--> statement-breakpoint
CREATE INDEX "agent_task_open_due_idx" ON "agent_task" USING btree ("due_at") WHERE "agent_task"."finished_at" is null;