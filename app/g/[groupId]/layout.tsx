import { Suspense, type ReactNode } from "react";
import { GroupAuthGate } from "@/app/g/[groupId]/auth-gate";

// Set pages wait on the sign-in check and the group's live data, so navigating into them is allowed to block.
export const instant = false;

export default function GroupLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="sign-in-shell"><p className="sign-in-status">Checking sign-in…</p></main>}>
      <GroupAuthGate>{children}</GroupAuthGate>
    </Suspense>
  );
}
