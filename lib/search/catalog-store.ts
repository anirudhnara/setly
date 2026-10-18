import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { CatalogCategory, CatalogItem, SecondhandItemInput } from "@/lib/search/catalog";
import { catalogItemFromSecondhand, MIN_RATING } from "@/lib/search/catalog";

/** Database IO for the catalog. Needs DATABASE_URL; the pure logic lives in lib/search/catalog.ts. */

const BATCH_SIZE = 200;

async function db() {
  const [{ getDb }, schema] = await Promise.all([import("@/lib/db/client"), import("@/lib/db/schema")]);
  return { db: getDb(), schema };
}

/**
 * Inserts or refreshes items and records each price in the price_points hypertable.
 * One search can list the same product from two stores; the first (cheapest-ranked) copy wins.
 */
export async function upsertCatalogItems(input: CatalogItem[]) {
  const { db: database, schema } = await db();
  const { catalogItems, pricePoints } = schema;
  const items = [...new Map(input.toReversed().map((item) => [item.id, item])).values()];
  for (let start = 0; start < items.length; start += BATCH_SIZE) {
    const batch = items.slice(start, start + BATCH_SIZE);
    await database
      .insert(catalogItems)
      .values(batch)
      .onConflictDoUpdate({
        target: catalogItems.id,
        set: {
          category: sql`excluded.category`,
          title: sql`excluded.title`,
          store: sql`excluded.store`,
          priceCents: sql`excluded.price_cents`,
          url: sql`excluded.url`,
          imageUrl: sql`excluded.image_url`,
          rating: sql`excluded.rating`,
          reviewCount: sql`excluded.review_count`,
          qualityScore: sql`excluded.quality_score`,
          delivery: sql`excluded.delivery`,
          shippingDaysMax: sql`excluded.shipping_days_max`,
          variantGroup: sql`excluded.variant_group`,
          role: sql`excluded.role`,
          tags: sql`excluded.tags`,
          scores: sql`excluded.scores`,
          attributes: sql`excluded.attributes`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
    await database
      .insert(pricePoints)
      .values(batch.map((item) => ({ productId: item.id, priceCents: item.priceCents, observedAt: item.fetchedAt })))
      .onConflictDoNothing();
  }
}

/** Best items in a category first. Unrated items (most secondhand listings) are kept. */
export async function listCatalogItems(options: { category: CatalogCategory; limit?: number; condition?: "new" | "used" }) {
  const { db: database, schema } = await db();
  const { catalogItems } = schema;
  return database
    .select()
    .from(catalogItems)
    .where(
      and(
        eq(catalogItems.category, options.category),
        or(isNull(catalogItems.rating), gte(catalogItems.rating, MIN_RATING)),
        options.condition ? eq(catalogItems.condition, options.condition) : undefined,
      ),
    )
    .orderBy(desc(catalogItems.qualityScore))
    .limit(options.limit ?? 100);
}

/** Every near-duplicate of an item, for swapping within a set. */
export async function listVariants(variantGroup: string) {
  const { db: database, schema } = await db();
  return database
    .select()
    .from(schema.catalogItems)
    .where(eq(schema.catalogItems.variantGroup, variantGroup))
    .orderBy(desc(schema.catalogItems.qualityScore));
}

/** Adds a listing someone found themselves (eBay, Facebook Marketplace). Throws a ZodError on bad input. */
export async function addSecondhandItem(input: SecondhandItemInput) {
  const item = catalogItemFromSecondhand(input, new Date());
  await upsertCatalogItems([item]);
  return item;
}

/** Item, variant group, and used-item counts per category, for checking coverage against the target. */
export async function catalogCoverage() {
  const { db: database, schema } = await db();
  const { catalogItems } = schema;
  return database
    .select({
      category: catalogItems.category,
      items: sql<number>`count(*)::int`,
      variantGroups: sql<number>`count(distinct ${catalogItems.variantGroup})::int`,
      used: sql<number>`(count(*) filter (where ${catalogItems.condition} = 'used'))::int`,
    })
    .from(catalogItems)
    .groupBy(catalogItems.category);
}
