import { guidedLane } from "@/lib/checkout/guided";
import type { CheckoutLane } from "@/lib/checkout/lane";
import { protocolLane } from "@/lib/checkout/protocol";
import { zincLane } from "@/lib/checkout/zinc/lane";
import type { CheckoutLaneName } from "@/lib/types";

const LANES: Record<CheckoutLaneName, CheckoutLane> = { protocol: protocolLane, zinc: zincLane, guided: guidedLane };

let override: Partial<Record<CheckoutLaneName, CheckoutLane>> = {};

/** Test hook: replace lanes, or pass {} to restore them. */
export function setLanesForTests(lanes: Partial<Record<CheckoutLaneName, CheckoutLane>>) {
  override = lanes;
}

export function getLane(name: CheckoutLaneName): CheckoutLane {
  return override[name] ?? LANES[name];
}
