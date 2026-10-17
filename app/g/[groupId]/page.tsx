import type { Metadata } from "next";
import { PlanView } from "@/components/map/plan-view";
import { GroupSlot } from "@/components/shared/group-slot";

export const metadata: Metadata = { title: "Setly" };

export default function MapPage({ params }: { params: Promise<{ groupId: string }> }) {
  return <GroupSlot params={params}>{(groupId) => <PlanView groupId={groupId} />}</GroupSlot>;
}
