import { Suspense, type ReactNode } from "react";
import { SiteNav } from "@/components/shared/site-nav";

export function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="orbit">
      <Suspense fallback={<header className="orbit-nav" aria-hidden="true" />}>
        <SiteNav />
      </Suspense>
      <main className="orbit-main">{children}</main>
    </div>
  );
}
