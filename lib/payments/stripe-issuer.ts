import type { Authorization, Card, Refund } from "@/lib/types";
import type { DemoCheckoutResult, Issuer, StoreLimitInput } from "@/lib/payments/issuer";

async function notImplemented(): Promise<never> {
  // TODO(Backend 1 (Money)): implement Stripe Issuing in test mode. Do not put live keys in code.
  const { default: Stripe } = await import("stripe");
  void Stripe;
  throw new Error("not implemented");
}

export const stripeIssuer: Issuer = {
  async createCard(_groupId: string, _limits: StoreLimitInput[]): Promise<Card> {
    return notImplemented();
  },
  async authorize(_cardId: string, _merchant: string, _amountCents: number): Promise<Authorization> {
    return notImplemented();
  },
  async runDemoCheckout(_groupId: string): Promise<DemoCheckoutResult> {
    return notImplemented();
  },
  async refundItem(_productId: string): Promise<Refund[]> {
    return notImplemented();
  },
};
