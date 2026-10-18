CREATE TABLE "catalog_items" (
	"id" text PRIMARY KEY NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"store" text NOT NULL,
	"price_cents" integer NOT NULL,
	"url" text NOT NULL,
	"image_url" text NOT NULL,
	"condition" text NOT NULL,
	"source" text NOT NULL,
	"rating" real,
	"review_count" integer,
	"quality_score" real NOT NULL,
	"delivery" text,
	"shipping_days_max" integer,
	"variant_group" text NOT NULL,
	"role" text NOT NULL,
	"tags" jsonb NOT NULL,
	"scores" jsonb NOT NULL,
	"attributes" jsonb NOT NULL,
	"search_query" text,
	"added_by" text,
	"fetched_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "catalog_items_category_idx" ON "catalog_items" USING btree ("category","quality_score");--> statement-breakpoint
CREATE INDEX "catalog_items_variant_group_idx" ON "catalog_items" USING btree ("variant_group");