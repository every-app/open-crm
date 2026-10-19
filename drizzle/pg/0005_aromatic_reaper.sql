ALTER TABLE "member" ADD COLUMN "last_seen_at" text;--> statement-breakpoint
CREATE INDEX "form_submission_created_idx" ON "form_submission" USING btree ("created_at");