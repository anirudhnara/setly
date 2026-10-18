import { Suspense, type ReactNode } from "react";
import { SiteNav } from "@/components/shared/site-nav";

export function Shell({ children, wide = false }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="orbit">
      <Suspense fallback={<header className="setly-nav" aria-hidden="true" />}>
        <SiteNav />
      </Suspense>
      <main className={`orbit-main${wide ? " wide" : ""}`}>{children}</main>
    </div>
  );
}
