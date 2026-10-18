/**
 * Proof that the Zinc lane talks to the real v2 API: places a test-success and a test-price-exceeded order
 * through the same request builder and client the app uses, polls each until it finishes, and prints the result.
 * Refuses anything but a sandbox key (zn_test_). The key is never printed.
 *
 *   CHECKOUT_ZINC=sandbox npm run zinc:sandbox
 */
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const POLL_MS = 3_000;
const MAX_POLLS = 60;

async function main() {
  const key = process.env.ZINC_API_KEY ?? "";
  if (!key.startsWith("zn_test_")) {
    console.error("Refusing to run: ZINC_API_KEY must be a sandbox key starting with zn_test_.");
    process.exit(1);
  }
  const [{ buildZincOrder }, { createZincOrder, getZincOrder }, { toLaneUpdate }] = await Promise.all([
    import("@/lib/checkout/zinc/request"),
    import("@/lib/checkout/zinc/client"),
    import("@/lib/checkout/zinc/lane"),
  ]);
  const runId = Date.now().toString(36);

  for (const slug of ["test-success", "test-price-exceeded"]) {
    const order = {
      order: {
        id: `so_sandbox_${slug}_${runId}`,
        groupId: "grp_sandbox",
        store: "Zinc",
        lane: "zinc" as const,
        status: "pending" as const,
        subtotalCents: 1000,
        capCents: 5000,
        quotedCents: null,
        externalId: null,
        attempt: 0,
        error: null,
        tracking: [],
        finalTotalCents: null,
        updatedAt: new Date().toISOString(),
      },
      items: [{ product: { id: slug, slotId: "s", title: slug, store: "Zinc", priceCents: 1000, url: `https://zinc.com/shop/products/${slug}`, imageUrl: "", attributes: {} }, quantity: 1 }],
      address: { firstName: "Setly", lastName: "Demo", line1: "4000 15th Ave NE", line2: null, city: "Seattle", state: "WA", postalCode: "98105", phone: "2065550100" },
      cardId: null,
      authorizations: [],
      now: new Date(),
    };
    const body = buildZincOrder(order);
    console.log(`\n${slug}: POST /orders (max_price ${body.max_price}, idempotency_key ${body.idempotency_key})`);
    let zinc = await createZincOrder(key, body);
    console.log(`  created ${zinc.id} → ${zinc.status}`);
    for (let poll = 0; poll < MAX_POLLS && (zinc.status === "pending" || zinc.status === "in_progress"); poll += 1) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      zinc = await getZincOrder(key, zinc.id);
      console.log(`  ${zinc.status}`);
    }
    const update = toLaneUpdate(order, zinc);
    console.log(`  Zinc: ${zinc.status}${zinc.job_result?.error_type ? ` (${zinc.job_result.error_type})` : ""}`);
    console.log(`  price_components: ${JSON.stringify(zinc.job_result?.price_components ?? null)}`);
    console.log(`  Setly store order → ${update.status}${update.error ? `: ${update.error}` : ""}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
