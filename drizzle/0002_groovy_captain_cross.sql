CREATE TABLE "ai_undo_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" uuid,
	"tool_name" text NOT NULL,
	"summary" text NOT NULL,
	"undo_data" jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"undone_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_messages" ADD COLUMN "tool_calls" jsonb;--> statement-breakpoint
ALTER TABLE "ai_undo_actions" ADD CONSTRAINT "ai_undo_actions_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_undo_actions" ADD CONSTRAINT "ai_undo_actions_conversation_id_ai_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."ai_conversations"("id") ON DELETE cascade ON UPDATE no action;