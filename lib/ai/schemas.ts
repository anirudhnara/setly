import { z } from "zod";

/**
 * Structure the model is allowed to return. Prices, stores, and URLs are not in this schema:
 * search fills them after a real store result is chosen. `budgetWeight` is a relative share of the budget
 * (code turns it into cents), not a price.
 */
export const generatedSlotSchema = z.object({
  need: z.string().min(1).max(60),
  quantityRule: z.enum(["per_group", "per_person", "fixed"]),
  quantity: z.number().int().positive().max(50),
  payType: z.enum(["shared", "per_person", "already_owned"]),
  searchQuery: z.string().min(1).max(120),
  budgetWeight: z.number().int().min(1).max(100).optional(),
});

export const generatedZoneSchema = z.object({
  name: z.string().min(1).max(40),
  sortOrder: z.number().int().nonnegative(),
  slots: z.array(generatedSlotSchema).min(1).max(15),
});

export const generatedLinkSchema = z.object({
  fromNeed: z.string().min(1),
  toNeed: z.string().min(1),
  label: z.string().min(1).max(80),
});

/** Known rule params, all optional. Code evaluates them in lib/rules; the model never sets a status. */
export const generatedRuleParamsSchema = z.object({
  per: z.enum(["member"]).optional(),
  expected: z.number().int().positive().optional(),
  attribute: z.string().optional(),
  value: z.string().optional(),
  doorWidthIn: z.number().positive().optional(),
  maxWidthIn: z.number().positive().optional(),
  relation: z.string().optional(),
  neededBy: z.string().optional(),
  requiredNeeds: z.array(z.string()).optional(),
  bannedNeeds: z.array(z.string()).optional(),
  bannedStores: z.array(z.string()).optional(),
});

export const generatedRuleSchema = z.object({
  type: z.enum(["budget", "quantity", "compatibility", "size", "timing", "required_or_banned"]),
  needs: z.array(z.string()),
  params: generatedRuleParamsSchema,
  message: z.string().optional(),
});

export const generatedMapSchema = z.object({
  groupSize: z.number().int().positive().max(50).optional(),
  zones: z.array(generatedZoneSchema).min(1).max(8),
  links: z.array(generatedLinkSchema),
  rules: z.array(generatedRuleSchema),
});

export type GeneratedMap = z.infer<typeof generatedMapSchema>;
export type GeneratedSlot = z.infer<typeof generatedSlotSchema>;
export type GeneratedRule = z.infer<typeof generatedRuleSchema>;

const RULE_TYPES = new Set(["budget", "quantity", "compatibility", "size", "timing", "required_or_banned"]);
const record = (value: unknown): Record<string, unknown> | null => (typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const whole = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

/**
 * Fixes the small slips the model makes in an otherwise good plan, before strict validation: a 0 budget weight on
 * something already owned, an empty search query, a long label, an unknown enum, a stray rule type. Anything it
 * can't fix (no zones at all) is left for validation to reject.
 */
export function repairGeneratedMap(json: unknown): unknown {
  const root = record(json);
  if (!root || !Array.isArray(root.zones)) return json;
  const zones = root.zones.flatMap((value, index) => {
    const zone = record(value);
    if (!zone || !Array.isArray(zone.slots)) return [];
    const slots = zone.slots.flatMap((slotValue) => {
      const slot = record(slotValue);
      const need = text(slot?.need, 60);
      if (!slot || !need) return [];
      const payType = ["shared", "per_person", "already_owned"].includes(String(slot.payType)) ? slot.payType : "shared";
      return [{
        need,
        quantityRule: ["per_group", "per_person", "fixed"].includes(String(slot.quantityRule)) ? slot.quantityRule : "per_group",
        quantity: whole(slot.quantity, 1, 50, 1),
        payType,
        searchQuery: text(slot.searchQuery, 120) || need,
        ...(slot.budgetWeight == null ? {} : { budgetWeight: whole(slot.budgetWeight, 1, 100, 1) }),
      }];
    });
    const name = text(zone.name, 40);
    return slots.length && name ? [{ name, sortOrder: index, slots: slots.slice(0, 15) }] : [];
  });
  const links = (Array.isArray(root.links) ? root.links : []).flatMap((value) => {
    const link = record(value);
    const fromNeed = text(link?.fromNeed, 60);
    const toNeed = text(link?.toNeed, 60);
    return fromNeed && toNeed ? [{ fromNeed, toNeed, label: text(link?.label, 80) || "goes with" }] : [];
  });
  const rules = (Array.isArray(root.rules) ? root.rules : []).flatMap((value) => {
    const rule = record(value);
    if (!rule || !RULE_TYPES.has(String(rule.type))) return [];
    const parsed = generatedRuleSchema.safeParse({ ...rule, needs: Array.isArray(rule.needs) ? rule.needs.filter((need) => typeof need === "string") : [], params: record(rule.params) ?? {} });
    return parsed.success ? [parsed.data] : [];
  });
  const groupSize = root.groupSize == null ? undefined : whole(root.groupSize, 1, 50, 1);
  return { ...(groupSize ? { groupSize } : {}), zones: zones.slice(0, 8), links, rules };
}
