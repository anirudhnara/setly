import type { Metadata } from "next";
import { SettleView } from "@/components/group/settle-view";
import { GroupSlot } from "@/components/shared/group-slot";
import { Shell } from "@/components/shared/shell";

export const metadata: Metadata = { title: "Settle — Setly" };

export default function SettlePage({ params }: { params: Promise<{ groupId: string }> }) {
  return (
    <Shell>
      <GroupSlot params={params}>{(groupId) => <SettleView groupId={groupId} />}</GroupSlot>
    </Shell>
  );
}