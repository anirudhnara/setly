import { laneForStore } from "@/lib/checkout/registry";
import type { Product } from "@/lib/types";

/** "1-click" when Setly can buy it itself (protocol or Zinc), "Guided" when a member checks out with the card. */
export function withCheckoutBadge(product: Product): Product {
  const lane = laneForStore(product.store);
  return { ...product, attributes: { ...product.attributes, lane, checkout: lane === "guided" ? "Guided" : "1-click" } };
}
