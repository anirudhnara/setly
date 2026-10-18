import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupAuthGate } from "@/app/g/[groupId]/auth-gate";
import { SponsorDashboard } from "@/components/sponsor/sponsor-dashboard";
import { Shell } from "@/components/shared/shell";
import "@/components/sponsor/sponsor.css";

export const metadata: Metadata = { title: "Claims — Setly" };

export default function Page() {
  return (
    <Shell wide>
      <Suspense fallback={null}>
        <GroupAuthGate>
          <SponsorDashboard kind="insurance" />
        </GroupAuthGate>
      </Suspense>
    </Shell>
  );
}
