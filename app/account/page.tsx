import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupAuthGate } from "@/app/g/[groupId]/auth-gate";
import { AccountView } from "@/components/account/account-view";
import { Shell } from "@/components/shared/shell";

export const metadata: Metadata = { title: "Account — Setly" };

export default function AccountPage() {
  return (
    <Shell wide>
      <Suspense fallback={null}>
        <GroupAuthGate>
          <AccountView />
        </GroupAuthGate>
      </Suspense>
    </Shell>
  );
}
