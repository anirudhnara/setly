import type { Metadata } from "next";
import { PlanView } from "@/components/map/plan-view";
import { GroupSlot } from "@/components/shared/group-slot";
import { Shell } from "@/components/shared/shell";
import "@/components/map/plan-view.css";

export const metadata: Metadata = { title: "Your set — Setly" };

export default function MapPage({ params }: { params: Promise<{ groupId: string }> }) {
  return (
    <Shell wide>
      <GroupSlot params={params}>{(groupId) => <PlanView groupId={groupId} />}</GroupSlot>
    </Shell>
  );
}
