import { and, desc, eq, gte, isNull, or, sql } from "drizzle-orm";
import type { Product } from "@/lib/types";
import type { CatalogCategory, CatalogItem, SecondhandItemInput } from "@/lib/search/catalog";
import { catalogItemFromSecondhand, catalogItemToProduct, categorize, MIN_RATING, rankCatalogMatches } from "@/lib/search/catalog";

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
          // Keep Gemini's color, styles, and role when a reseed rewrites the keyword tags.
          role: sql`case when ${catalogItems.tags} ? 'color' then ${catalogItems.role} else excluded.role end`,
          tags: sql`excluded.tags || jsonb_strip_nulls(jsonb_build_object('color', ${catalogItems.tags} -> 'color', 'styles', ${catalogItems.tags} -> 'styles'))`,
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

/** Items Gemini hasn't tagged yet. */
export async function untaggedCatalogItems(limit: number) {
  const { db: database, schema } = await db();
  const { catalogItems } = schema;
  return database
    .select({ id: catalogItems.id, title: catalogItems.title, category: catalogItems.category, tags: catalogItems.tags })
    .from(catalogItems)
    .where(sql`not (${catalogItems.tags} ? 'color')`)
    .limit(limit);
}

/** Saves Gemini tags and the role they imply, in one statement per batch. */
export async function saveCatalogTags(updates: { id: string; tags: CatalogItem["tags"]; role: CatalogItem["role"] }[]) {
  if (updates.length === 0) return;
  const { db: database } = await db();
  const values = sql.join(
    updates.map((update) => sql`(${update.id}, ${JSON.stringify(update.tags)}::jsonb, ${update.role})`),
    sql`, `,
  );
  await database.execute(
    sql`update catalog_items as c set tags = v.tags, role = v.role from (values ${values}) as v(id, tags, role) where c.id = v.id`,
  );
}

const CANDIDATE_LIMIT = 400;

/**
 * Catalog answer for a map search, or null to fall through to SerpApi. One indexed read.
 * Never throws: a missing database or a bad row just means "not answered here".
 */
export async function searchStoredCatalog(query: string): Promise<Product[] | null> {
  try {
    const category = categorize(query, "");
    const { db: database, schema } = await db();
    const { catalogItems } = schema;
    const rows = await database
      .select()
      .from(catalogItems)
      .where(and(category === "other" ? undefined : eq(catalogItems.category, category), eq(catalogItems.condition, "new")))
      .orderBy(desc(catalogItems.qualityScore))
      .limit(CANDIDATE_LIMIT);
    return rankCatalogMatches(query, rows)?.map(catalogItemToProduct) ?? null;
  } catch {
    return null;
  }
}
