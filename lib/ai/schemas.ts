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
