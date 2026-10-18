CREATE TABLE "store_orders" (
	"id" text PRIMARY KEY NOT NULL,
	"group_id" text NOT NULL,
	"store" text NOT NULL,
	"lane" text NOT NULL,
	"status" text NOT NULL,
	"subtotal_cents" integer NOT NULL,
	"cap_cents" integer NOT NULL,
	"quoted_cents" integer,
	"external_id" text,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error" text,
	"tracking" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"final_total_cents" integer,
	"updated_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "product_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "address_json" jsonb;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "store_order_id" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "reason" text DEFAULT 'return' NOT NULL;--> statement-breakpoint
ALTER TABLE "store_orders" ADD CONSTRAINT "store_orders_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;