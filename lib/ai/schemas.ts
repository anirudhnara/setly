import { z } from "zod";

/**
 * Structure the model is allowed to return. Prices are not in this schema.
 * Search fills priceCents after a real store result is chosen.
 */
export const generatedSlotSchema = z.object({
  need: z.string().min(1),
  quantityRule: z.enum(["per_group", "per_person", "fixed"]),
  quantity: z.number().int().positive(),
  payType: z.enum(["shared", "per_person", "already_owned"]),
  searchQuery: z.string().min(1),
});

export const generatedZoneSchema = z.object({
  name: z.string().min(1),
  sortOrder: z.number().int().nonnegative(),
  slots: z.array(generatedSlotSchema).min(1),
});

export const generatedLinkSchema = z.object({
  fromNeed: z.string().min(1),
  toNeed: z.string().min(1),
  label: z.string().min(1),
});

export const generatedRuleSchema = z.object({
  type: z.enum(["budget", "quantity", "compatibility", "size", "timing", "required_or_banned"]),
  needs: z.array(z.string()),
  params: z.record(z.string(), z.unknown()),
  message: z.string(),
});

export const generatedMapSchema = z.object({
  zones: z.array(generatedZoneSchema).min(1),
  links: z.array(generatedLinkSchema),
  rules: z.array(generatedRuleSchema),
});

export type GeneratedMap = z.infer<typeof generatedMapSchema>;
