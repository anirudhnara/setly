import type { Card, StoreLimit } from "@/lib/types";

export interface AuthorizationDecision {
  approved: boolean;
  reason: string;
  store: string | null;
}

export function decideAuthorization(input: {
  card: Card | null;
  storeLimits: StoreLimit[];
  merchant: string;
  amountCents: number;
}): AuthorizationDecision {
  if (!input.card || input.card.status !== "active") {
    return { approved: false, reason: "Declined: card was not found or is not active.", store: null };
  }
  const store = matchStore(input.merchant, input.storeLimits.map((limit) => limit.store));
  if (!store) {
    return { approved: false, reason: `${input.merchant} is not in this plan.`, store: null };
  }
  const limit = input.storeLimits.find((item) => item.store === store);
  const remaining = (limit?.limitCents ?? 0) - (limit?.spentCents ?? 0);
  if (!limit || input.amountCents > remaining) {
    return { approved: false, reason: `Declined: amount exceeds the remaining limit for ${store}.`, store };
  }
  return { approved: true, reason: `Approved: ${store} is in this plan and the amount fits the remaining store limit.`, store };
}

function matchStore(merchant: string, stores: string[]) {
  const haystack = merchant.toLowerCase();
  return stores
    .filter((store) => haystack.includes(store.toLowerCase()))
    .sort((left, right) => right.length - left.length)[0];
}
