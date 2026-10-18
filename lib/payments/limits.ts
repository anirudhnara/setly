import type { CheckoutLaneName, MapData, Member } from "@/lib/types";
import type { StoreLimitInput } from "@/lib/payments/issuer";
import { capCents, storeSubtotals } from "@/lib/money/buffer";

/**
 * Card limits per store. Without `laneForStore` each limit is the store's subtotal.
 * With it, protocol and guided stores get their cap (subtotal + buffer), and Zinc stores get no card limit:
 * Zinc is paid from the Zinc wallet, and its cap is reserved on the store order instead.
 */
export function storeLimitInputs(map: MapData, members: Member[], laneForStore?: (store: string) => CheckoutLaneName): StoreLimitInput[] {
  return storeSubtotals(map, members).flatMap(({ store, subtotalCents }) => {
    if (!laneForStore) return [{ store, limitCents: subtotalCents }];
    if (laneForStore(store) === "zinc") return [];
    return [{ store, limitCents: capCents(subtotalCents) }];
  });
}
