import type { MapData, Member, Rule } from "@/lib/types";

/**
 * Evaluates every rule on the map in code and returns the same rules with updated status and message.
 * The model does not decide whether a rule passes.
 *
 * - budget: compare the charged plan total with `params.maxCents`.
 * - quantity: compare slot quantities with the member count or `params.expected`.
 * - compatibility: compare the named product attribute across `slotIds`.
 * - size: return `not_checked` when width, length, or other size attributes are missing on a product.
 * - timing: return `not_checked` when delivery or date attributes are missing.
 * - required_or_banned: fail when a required need is absent or a banned store or product is chosen.
 */
export function checkRules(map: MapData, members: Member[]): Rule[] {
  // TODO(Backend 2 (Maps)): evaluate budget, quantity, compatibility, size, timing, and required_or_banned.
  void map;
  void members;
  return [];
}
