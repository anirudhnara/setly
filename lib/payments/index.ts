import { mockIssuer } from "@/lib/payments/mock-issuer";
import { stripeIssuer } from "@/lib/payments/stripe-issuer";
import type { Issuer } from "@/lib/payments/issuer";

let issuerOverride: Issuer | null = null;

/** Test hook. Pass null to use ISSUER again. */
export function setIssuerForTests(issuer: Issuer | null) {
  issuerOverride = issuer;
}

export function getIssuer(): Issuer {
  if (issuerOverride) return issuerOverride;
  return (process.env.ISSUER ?? "mock") === "stripe" ? stripeIssuer : mockIssuer;
}

export type { Issuer, StoreLimitInput } from "@/lib/payments/issuer";
