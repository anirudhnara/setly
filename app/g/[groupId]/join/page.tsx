import type { Metadata } from "next";
import { JoinView } from "@/components/group/join-view";
import { GroupSlot } from "@/components/shared/group-slot";
import { Shell } from "@/components/shared/shell";

export const metadata: Metadata = { title: "Join — Setly" };

export default function JoinPage({ params }: { params: Promise<{ groupId: string }> }) {
  return (
    <Shell wide>
      <GroupSlot params={params}>{(groupId) => <JoinView groupId={groupId} />}</GroupSlot>
    </Shell>
  );
}
