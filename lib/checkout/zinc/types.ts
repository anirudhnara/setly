import { z } from "zod";

/** Zinc v2 API shapes (https://api.zinc.com/openapi.json). Unknown fields are ignored. */
export const zincStatusSchema = z.enum(["pending", "in_progress", "order_placed", "order_failed", "cancelled", "cancelled_by_retailer"]);
export type ZincStatus = z.infer<typeof zincStatusSchema>;

export const zincOrderSchema = z.object({
  id: z.string().min(1),
  status: zincStatusSchema,
  job_result: z
    .object({
      price_components: z
        .object({
          subtotal: z.number().int().nullish(),
          tax: z.number().int().nullish(),
          shipping: z.number().int().nullish(),
          total: z.number().int().nullish(),
        })
        .nullish(),
      error_type: z.string().nullish(),
      message: z.string().nullish(),
    })
    .nullish(),
  tracking_numbers: z
    .array(
      z.object({
        carrier: z.string().nullish(),
        tracking_number: z.string().nullish(),
        status: z.string().nullish(),
        zinc_tracking_url: z.string().nullish(),
      }),
    )
    .nullish(),
  merchant_order_ids: z.array(z.string()).nullish(),
});
export type ZincOrder = z.infer<typeof zincOrderSchema>;

export const zincRetailerCheckSchema = z.object({
  orderable: z.boolean().nullish(),
  support: z.string().nullish(),
  checkout: z.object({ guest_checkout: z.boolean().nullish() }).nullish(),
});
export type ZincRetailerCheck = z.infer<typeof zincRetailerCheckSchema>;

export interface ZincShippingAddress {
  first_name: string;
  last_name: string;
  address_line1: string;
  address_line2?: string;
  city: string;
  state: string;
  postal_code: string;
  phone_number: string;
  country: "US";
}

export interface ZincOrderRequest {
  products: { url: string; quantity: number }[];
  shipping_address: ZincShippingAddress;
  /** Cents. Zinc fails the order with max_price_exceeded rather than charge more. */
  max_price: number;
  idempotency_key: string;
  metadata: { groupId: string; storeOrderId: string };
}

/** A Zinc error that happened when the order was sent (400 invalid address, 402 insufficient funds). */
export class ZincRequestError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ZincRequestError";
    this.status = status;
  }
}
