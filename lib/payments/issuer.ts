import type { Authorization, Card, Refund } from "@/lib/types";

export interface StoreLimitInput {
  store: string;
  limitCents: number;
}

export interface DemoCheckoutResult {
  card: Card;
  authorizations: Authorization[];
}

export interface Issuer {
  createCard(groupId: string, limits: StoreLimitInput[]): Promise<Card>;
  authorize(cardId: string, merchant: string, amountCents: number): Promise<Authorization>;
  runDemoCheckout(groupId: string): Promise<DemoCheckoutResult>;
  refundItem(productId: string): Promise<Refund[]>;
}
