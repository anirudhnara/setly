import { Suspense, type ReactNode } from "react";
import { GroupAuthGate } from "@/app/g/[groupId]/auth-gate";

export default function GroupLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="sign-in-shell"><p className="sign-in-status">Checking sign-in…</p></main>}>
      <GroupAuthGate>{children}</GroupAuthGate>
    </Suspense>
  );
}
