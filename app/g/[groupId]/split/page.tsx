import type { Metadata } from "next";
import { SplitView } from "@/components/group/split-view";
import { GroupSlot } from "@/components/shared/group-slot";
import { Shell } from "@/components/shared/shell";

export const metadata: Metadata = { title: "Split — Setly" };

export default function SplitPage({ params }: { params: Promise<{ groupId: string }> }) {
  return (
    <Shell>
      <GroupSlot params={params}>{(groupId) => <SplitView groupId={groupId} />}</GroupSlot>
    </Shell>
  );
}
