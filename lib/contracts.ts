import { z } from "zod";
import type {
  Authorization,
  Card,
  Contribution,
  Group,
  GroupState,
  MapData,
  Member,
  MemberShare,
  Product,
  Refund,
  Slot,
  StoreLimit,
  User,
} from "@/lib/types";

export const quantityRuleSchema = z.enum(["per_group", "per_person", "fixed"]);
export const payTypeSchema = z.enum(["shared", "per_person", "already_owned"]);

export const createGroupRequestSchema = z.object({
  name: z.string().min(1),
  prompt: z.string().min(1),
  budgetCents: z.number().int().nonnegative(),
});
export type CreateGroupRequest = z.infer<typeof createGroupRequestSchema>;
export type CreateGroupResponse = GroupState;

export type GetGroupResponse = GroupState;

export type CurrentUserResponse = { user: User };
export type MyGroupsResponse = { groups: Group[] };

export const joinGroupRequestSchema = z.object({
  name: z.string().min(1).optional(),
});
export type JoinGroupRequest = z.infer<typeof joinGroupRequestSchema>;
export type JoinGroupResponse = { member: Member; state: GroupState };

export const lockGroupRequestSchema = z.object({});
export type LockGroupRequest = z.infer<typeof lockGroupRequestSchema>;
export type LockGroupResponse = { shares: MemberShare[]; state: GroupState };

export const generateMapRequestSchema = z.object({
  prompt: z.string().min(1),
  budgetCents: z.number().int().nonnegative().optional(),
});
export type GenerateMapRequest = z.infer<typeof generateMapRequestSchema>;
export type GenerateMapResponse = MapData;

export const pasteMapRequestSchema = z.object({
  text: z.string().min(1),
  groupId: z.string().min(1).optional(),
});
export type PasteMapRequest = z.infer<typeof pasteMapRequestSchema>;
export type PasteMapResponse = MapData;

export const createSlotRequestSchema = z.object({
  zoneId: z.string().min(1),
  need: z.string().min(1),
  quantityRule: quantityRuleSchema,
  quantity: z.number().int().positive(),
  budgetCents: z.number().int().nonnegative(),
  payType: payTypeSchema,
  ownerMemberId: z.string().min(1).nullable().optional(),
});
export type CreateSlotRequest = z.infer<typeof createSlotRequestSchema>;
export type CreateSlotResponse = { slot: Slot };

export const updateSlotRequestSchema = z.object({
  need: z.string().min(1).optional(),
  quantityRule: quantityRuleSchema.optional(),
  quantity: z.number().int().positive().optional(),
  budgetCents: z.number().int().nonnegative().optional(),
  payType: payTypeSchema.optional(),
  ownerMemberId: z.string().min(1).nullable().optional(),
  chosenProductId: z.string().min(1).nullable().optional(),
});
export type UpdateSlotRequest = z.infer<typeof updateSlotRequestSchema>;
export type UpdateSlotResponse = { slot: Slot };
export type DeleteSlotResponse = { id: string; deleted: true };

export type SlotOptionsResponse = { products: Product[] };

export const payRequestSchema = z.object({
  groupId: z.string().min(1),
  amountCents: z.number().int().positive(),
});
export type PayRequest = z.infer<typeof payRequestSchema>;
export type PayResponse = { contribution: Contribution; checkoutUrl: string | null };

export const stripeWebhookRequestSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  data: z.object({
    object: z.unknown(),
  }),
});
export type StripeWebhookRequest = z.infer<typeof stripeWebhookRequestSchema>;
export type StripeWebhookResponse = { received: true };

export const authorizeRequestSchema = z.object({
  cardId: z.string().min(1),
  merchant: z.string().min(1),
  amountCents: z.number().int().positive(),
});
export type AuthorizeRequest = z.infer<typeof authorizeRequestSchema>;
export type AuthorizeResponse = Authorization;

export const demoCheckoutRequestSchema = z.object({
  groupId: z.string().min(1),
});
export type DemoCheckoutRequest = z.infer<typeof demoCheckoutRequestSchema>;
export type DemoCheckoutResponse = {
  card: Card;
  storeLimits: StoreLimit[];
  authorizations: Authorization[];
};

export const returnItemRequestSchema = z.object({
  groupId: z.string().min(1),
  productId: z.string().min(1),
});
export type ReturnItemRequest = z.infer<typeof returnItemRequestSchema>;
export type ReturnItemResponse = { refunds: Refund[] };

export const shippingAddressSchema = z.object({
  firstName: z.string().trim().min(1).max(60),
  lastName: z.string().trim().min(1).max(60),
  line1: z.string().trim().min(1).max(60),
  line2: z.string().trim().max(60).nullable().default(null),
  city: z.string().trim().min(1).max(60),
  state: z.string().trim().regex(/^[A-Za-z]{2}$/, "Use the 2-letter state code").transform((value) => value.toUpperCase()),
  postalCode: z.string().trim().regex(/^\d{5}(-\d{4})?$/, "Use a 5-digit ZIP code"),
  phone: z.string().trim().regex(/^\+?[0-9 ().-]{7,20}$/, "Use a phone number"),
});

export const startCheckoutRequestSchema = z.object({
  groupId: z.string().min(1),
  address: shippingAddressSchema,
});
export type StartCheckoutRequest = z.infer<typeof startCheckoutRequestSchema>;
export type StartCheckoutResponse = GroupState;

/** The approving member comes from the session, never the body. */
export const approveCheckoutRequestSchema = z.object({
  groupId: z.string().min(1),
  storeOrderId: z.string().min(1),
  approve: z.boolean(),
});
export type ApproveCheckoutRequest = z.infer<typeof approveCheckoutRequestSchema>;
export type ApproveCheckoutResponse = GroupState;

export const settleCheckoutRequestSchema = z.object({
  groupId: z.string().min(1),
});
export type SettleCheckoutRequest = z.infer<typeof settleCheckoutRequestSchema>;
export type SettleCheckoutResponse = GroupState;

export const demoResetRequestSchema = z.object({});
export type DemoResetResponse = { reseeded: true };

export type ApiErrorBody = { error: string | { formErrors: string[]; fieldErrors: Record<string, string[]> } };

export async function readRequest<T>(request: Request, schema: z.ZodType<T>) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    payload = undefined;
  }
  return schema.safeParse(payload);
}
