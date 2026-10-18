import { splitCents } from "@/lib/money/cents";
import type { Contribution, MemberShare, Refund, RefundReason, StoreOrder } from "@/lib/types";

/** What one member paid toward one store: items plus buffer (`cents`) and the Zinc fee (`feeCents`). */
export interface StorePayment {
  memberId: string;
  cents: number;
  feeCents: number;
}

/** Each store's payments from the members whose contribution is paid, read from their share lines. */
export function contributionsByStore(shares: MemberShare[], contributions: Contribution[]): Map<string, StorePayment[]> {
  const paid = new Set(
    contributions
      .filter((contribution) => contribution.status === "paid" || contribution.status === "refunded_partial")
      .map((contribution) => contribution.memberId),
  );
  const byStore = new Map<string, StorePayment[]>();
  for (const share of shares) {
    if (!paid.has(share.memberId)) continue;
    for (const line of share.lines) {
      if (!line.store || line.cents <= 0) continue;
      const payments = byStore.get(line.store) ?? [];
      let payment = payments.find((item) => item.memberId === share.memberId);
      if (!payment) {
        payment = { memberId: share.memberId, cents: 0, feeCents: 0 };
        payments.push(payment);
      }
      if (line.kind === "zinc_fee") payment.feeCents += line.cents;
      else payment.cents += line.cents;
      byStore.set(line.store, payments);
    }
  }
  return byStore;
}

/**
 * Refunds what checkout didn't spend, once every store order is finished.
 *
 * A store's surplus is what members paid toward it minus what it charged (nothing if it failed or was canceled).
 * A store approved to charge more than members paid toward it borrows from the other stores' surpluses,
 * taken from each in proportion to its size, so refunds never exceed what is left over in total.
 * Each store's refund is split by what each member paid toward that store, and a failed Zinc order
 * refunds its $1 fee too. Refund ids are `ref_<storeOrderId>_<memberId>[_fee]`, so settling twice
 * gives the same refunds.
 */
export function leftoverRefunds(storeOrders: StoreOrder[], byStore: Map<string, StorePayment[]>, createdAt = new Date().toISOString()): Refund[] {
  const rows = storeOrders.map((order) => {
    const payments = byStore.get(order.store) ?? [];
    const paid = payments.reduce((sum, payment) => sum + payment.cents, 0);
    const spent = order.status === "failed" || order.status === "canceled" ? 0 : (order.finalTotalCents ?? order.capCents);
    return { order, payments, surplus: paid - spent };
  });
  const deficit = rows.reduce((sum, row) => sum + Math.max(0, -row.surplus), 0);
  const positive = rows.filter((row) => row.surplus > 0);
  const borrowed = splitCents(
    Math.min(deficit, positive.reduce((sum, row) => sum + row.surplus, 0)),
    positive.map((row) => row.surplus),
  );

  const refunds: Refund[] = [];
  const push = (order: StoreOrder, payment: StorePayment, amountCents: number, reason: RefundReason, suffix = "") => {
    if (amountCents <= 0) return;
    refunds.push({
      id: `ref_${order.id}_${payment.memberId}${suffix}`,
      groupId: order.groupId,
      productId: null,
      storeOrderId: order.id,
      memberId: payment.memberId,
      amountCents,
      reason,
      createdAt,
    });
  };

  for (const row of rows) {
    const { order, payments } = row;
    const failed = order.status === "failed" || order.status === "canceled";
    const index = positive.indexOf(row);
    const refundable = index >= 0 ? row.surplus - (borrowed[index] ?? 0) : 0;
    const reason: RefundReason = failed ? "store_failed" : order.lane === "zinc" ? "zinc_held" : "leftover_buffer";
    const amounts = splitCents(refundable, payments.map((payment) => payment.cents));
    payments.forEach((payment, paymentIndex) => push(order, payment, amounts[paymentIndex] ?? 0, reason));
    if (failed && order.lane === "zinc") {
      payments.forEach((payment) => push(order, payment, payment.feeCents, "store_failed", "_fee"));
    }
  }
  return refunds;
}
