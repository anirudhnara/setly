import type { Metadata } from "next";
import { Suspense } from "react";
import { GroupAuthGate } from "@/app/g/[groupId]/auth-gate";
import { SiteNav } from "@/components/shared/site-nav";
import { VibeView } from "@/components/vibes/vibe-view";
import "@/components/space/space.css";

export const metadata: Metadata = { title: "Pick your vibe — Setly" };

export default function VibesPage() {
  return (
    <div className="orbit space-shell">
      <Suspense fallback={<header className="setly-nav" aria-hidden="true" />}>
        <SiteNav />
      </Suspense>
      <Suspense fallback={null}>
        <GroupAuthGate>
          <VibeView />
        </GroupAuthGate>
      </Suspense>
    </div>
  );
}
