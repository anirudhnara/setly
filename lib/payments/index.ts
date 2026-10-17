import { mockIssuer } from "@/lib/payments/mock-issuer";
import { stripeIssuer } from "@/lib/payments/stripe-issuer";
import type { Issuer } from "@/lib/payments/issuer";

export function getIssuer(): Issuer {
  return (process.env.ISSUER ?? "mock") === "stripe" ? stripeIssuer : mockIssuer;
}

export type { Issuer, StoreLimitInput } from "@/lib/payments/issuer";
