import type { Metadata } from "next";
import { CheckoutView } from "@/components/checkout/checkout-view";
import { GroupSlot } from "@/components/shared/group-slot";
import { Shell } from "@/components/shared/shell";

export const metadata: Metadata = { title: "Pay — Setly" };

export default function GroupCheckoutPage({ params }: { params: Promise<{ groupId: string }> }) {
  return (
    <Shell>
      <GroupSlot params={params}>{(groupId) => <CheckoutView groupId={groupId} />}</GroupSlot>
    </Shell>
  );
}
