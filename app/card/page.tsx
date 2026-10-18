import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupAuthGate } from "@/app/g/[groupId]/auth-gate";
import { RecipientView } from "@/components/sponsor/recipient-view";
import { Shell } from "@/components/shared/shell";
import "@/components/sponsor/sponsor.css";

export const metadata: Metadata = { title: "Your cards — Setly" };

export default function Page() {
  return (
    <Shell wide>
      <Suspense fallback={null}>
        <GroupAuthGate>
          <RecipientView />
        </GroupAuthGate>
      </Suspense>
    </Shell>
  );
}
