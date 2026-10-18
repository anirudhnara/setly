/**
 * Labels catalog items with a generalized color and styles using Gemini. No SerpApi.
 * Resumable: only untagged items are sent, so rerun it after a failure.
 *
 *   npm run catalog:tag                 # tag everything untagged
 *   npm run catalog:tag -- --limit 200  # try a few batches first
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
// This script calls Gemini on purpose, whatever MOCK_AI the dev server uses.
process.env.MOCK_AI = "0";

const BATCH_SIZE = 80;
const CONCURRENCY = 3;

async function main() {
  const limitIndex = process.argv.indexOf("--limit");
  const limit = limitIndex >= 0 ? Number(process.argv[limitIndex + 1]) : 100_000;
  if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive whole number");
  const [{ tagCatalogBatch, roleFromTags }, { untaggedCatalogItems, saveCatalogTags }] = await Promise.all([
    import("@/lib/ai/catalog-tags"),
    import("@/lib/search/catalog-store"),
  ]);
  const items = await untaggedCatalogItems(limit);
  const batches: (typeof items)[] = [];
  for (let start = 0; start < items.length; start += BATCH_SIZE) batches.push(items.slice(start, start + BATCH_SIZE));
  console.log(`${items.length} untagged items in ${batches.length} batches.`);

  let tagged = 0;
  let failed = 0;
  let next = 0;
  async function worker() {
    while (next < batches.length) {
      const index = next++;
      const batch = batches[index];
      try {
        const results = await tagCatalogBatch(batch.map((item) => ({ title: item.title, category: item.category })));
        const updates = batch.flatMap((item, i) => {
          const result = results[i];
          if (!result) return [];
          return [{ id: item.id, tags: { ...item.tags, color: result.color, styles: result.styles }, role: roleFromTags(result) }];
        });
        await saveCatalogTags(updates);
        tagged += updates.length;
        console.log(`  batch ${index + 1}/${batches.length}: ${updates.length}/${batch.length} tagged`);
      } catch (error) {
        failed += batch.length;
        console.error(`  batch ${index + 1}/${batches.length} failed: ${error instanceof Error ? error.message.slice(0, 200) : String(error)}`);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  console.log(`Tagged ${tagged} items. ${failed} in failed batches; rerun to retry them.`);
  process.exit(0);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
