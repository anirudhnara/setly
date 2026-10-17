import { describe, it } from "vitest";
import { computeRefunds } from "@/lib/money/refunds";
import { computeShares } from "@/lib/money/shares";

void computeShares;
void computeRefunds;

describe("computeShares", () => {
  it.todo("splits a shared slot evenly across every member");
  it.todo("gives leftover cents one each to the earliest members by join order");
  it.todo("returns shares whose lines and totals sum to the exact charged amount");
  it.todo("charges each member their own item for a per-person slot");
  it.todo("charges nothing for an already-owned slot");
  it.todo("charges nothing when a slot has no chosen product");
});

describe("computeRefunds", () => {
  it.todo("refunds only the members who paid for that item");
  it.todo("splits the refund in proportion to what each payer paid for the item");
  it.todo("gives nothing to a member who did not pay for the item");
  it.todo("returns integer cents that sum to the amount those payers put toward the item");
});
