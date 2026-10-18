CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "users_firebase_uid" UNIQUE("firebase_uid")
);
--> statement-breakpoint
ALTER TABLE "members" ADD COLUMN "user_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_group_user" UNIQUE("group_id","user_id");