"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { SAMPLE_GROUP_ID, readLastGroup } from "@/components/shared/session";

const LINKS = [
  { href: "/", label: "Signal" },
  { href: "/home", label: "Console" },
  { href: "/checkout", label: "Studio" },
];

export function SiteNav() {
  const pathname = usePathname();
  const groupId = pathname.match(/^\/g\/([^/]+)/)?.[1];
  const [planId, setPlanId] = useState(groupId ?? SAMPLE_GROUP_ID);

  useEffect(() => {
    if (groupId) {
      setPlanId(groupId);
      return;
    }
    setPlanId(readLastGroup() ?? SAMPLE_GROUP_ID);
  }, [groupId]);

  return (
    <header className="orbit-nav">
      <div className="orbit-nav-row">
        <Link href="/" className="orbit-brand">
          <JarvisMark size={28} />
          <span>setly</span>
        </Link>
        <nav className="orbit-links" aria-label="Primary">
          {LINKS.map((link) => (
            <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>
              {link.label}
            </Link>
          ))}
          <Link href={`/g/${planId}`} aria-current={pathname.startsWith("/g/") ? "page" : undefined}>
            Plan
          </Link>
        </nav>
        <span className="orbit-kicker">Visa · DubHacks ’26</span>
      </div>
      {groupId ? (
        <nav className="orbit-subnav" aria-label="Group">
          <Link href={`/g/${groupId}`} aria-current={pathname === `/g/${groupId}` ? "page" : undefined}>Map</Link>
          <Link href={`/g/${groupId}/join`} aria-current={pathname.endsWith("/join") ? "page" : undefined}>Join</Link>
          <Link href={`/g/${groupId}/split`} aria-current={pathname.endsWith("/split") ? "page" : undefined}>Split</Link>
          <Link href={`/g/${groupId}/checkout`} aria-current={pathname.endsWith("/checkout") ? "page" : undefined}>Pay</Link>
          <Link href={`/g/${groupId}/settle`} aria-current={pathname.endsWith("/settle") ? "page" : undefined}>Settle</Link>
        </nav>
      ) : null}
    </header>
  );
}
