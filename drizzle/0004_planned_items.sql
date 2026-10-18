ALTER TABLE "project_activity_log" ADD COLUMN "target_date" timestamp;--> statement-breakpoint
ALTER TABLE "project_activity_log" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
-- Entries logged before planned items existed were already done: keep them counting toward progress.
UPDATE "project_activity_log" SET "completed_at" = "entry_date" WHERE "completed_at" IS NULL;
