import type { ClaimInfo, ClaimLine, SponsorKind } from "@/lib/sponsor/card";

export const CATEGORIES = ["Furniture", "Bedding", "Kitchen", "Bath", "Lighting", "Decor", "Electronics", "School supplies", "Clothing", "Groceries", "Gaming", "Gift cards"] as const;

/** Stores the "test a purchase" box can try, each with what it sells. Made-up amounts are typed by the person. */
export const MERCHANTS: Array<{ name: string; category: string }> = [
  { name: "IKEA", category: "Furniture" },
  { name: "Target", category: "Bedding" },
  { name: "Fernwood Home", category: "Furniture" },
  { name: "Quillby Lighting", category: "Lighting" },
  { name: "Best Buy", category: "Electronics" },
  { name: "Walmart", category: "Kitchen" },
  { name: "Steam", category: "Gaming" },
  { name: "GiftCardz", category: "Gift cards" },
];

export const COPY: Record<SponsorKind, { sponsor: string; recipient: string; recipientRole: string; account: string }> = {
  parent: { sponsor: "Priya Rao", recipient: "Ani Rao", recipientRole: "Your kid", account: "Chase checking ••4417" },
  insurance: { sponsor: "Northwind Mutual", recipient: "Jordan Lee", recipientRole: "Policyholder", account: "Claims disbursement ••0921" },
};

export const PARENT_DEFAULTS = {
  amount: "600",
  perPurchase: "250",
  categories: ["Furniture", "Bedding", "Kitchen", "Bath", "Lighting", "School supplies"],
  blocked: "GiftCardz, Steam",
  days: 60,
};

export const SAMPLE_CLAIM: ClaimInfo = {
  number: "NWM-2026-104882",
  policy: "HO-3 · 7741-209-55",
  adjuster: "Dana Whitfield",
  peril: "Kitchen fire, smoke damage",
  dateOfLoss: "2026-10-09",
};

export const SAMPLE_LINES: ClaimLine[] = [
  { id: "line_sofa", label: "Sofa, 3-seat (smoke)", category: "Furniture", allowanceCents: 120_000 },
  { id: "line_mattress", label: "Queen mattress", category: "Bedding", allowanceCents: 90_000 },
  { id: "line_cookware", label: "Cookware and dishes", category: "Kitchen", allowanceCents: 45_000 },
  { id: "line_lamps", label: "Lamps, 2", category: "Lighting", allowanceCents: 18_000 },
  { id: "line_tv", label: "Television, 55 in", category: "Electronics", allowanceCents: 60_000 },
];
