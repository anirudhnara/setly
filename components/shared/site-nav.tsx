"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { SAMPLE_GROUP_ID, readLastGroup, readYou } from "@/components/shared/session";

const LINKS = [
  { href: "/", label: "Welcome" },
  { href: "/home", label: "New plan" },
  { href: "/checkout", label: "Checkout" },
];

export function SiteNav() {
  const pathname = usePathname();
  const groupId = pathname.match(/^\/g\/([^/]+)/)?.[1];
  const [planId, setPlanId] = useState(groupId ?? SAMPLE_GROUP_ID);
  const [you, setYou] = useState("");

  useEffect(() => {
    if (groupId) {
      setPlanId(groupId);
      return;
    }
    setPlanId(readLastGroup() ?? SAMPLE_GROUP_ID);
  }, [groupId]);

  useEffect(() => {
    setYou(readYou() ?? "");
  }, []);

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
            My plan
          </Link>
        </nav>
        <span className="orbit-kicker">{you ? `Welcome, ${you}` : "Visa · DubHacks ’26"}</span>
      </div>
      {groupId ? (
        <nav className="orbit-subnav" aria-label="Group">
          <Link href={`/g/${groupId}`} aria-current={pathname === `/g/${groupId}` ? "page" : undefined}>Map</Link>
          <Link href={`/g/${groupId}/join`} aria-current={pathname.endsWith("/join") ? "page" : undefined}>Invite</Link>
          <Link href={`/g/${groupId}/split`} aria-current={pathname.endsWith("/split") ? "page" : undefined}>Contributions</Link>
          <Link href={`/g/${groupId}/checkout`} aria-current={pathname.endsWith("/checkout") ? "page" : undefined}>Checkout</Link>
          <Link href={`/g/${groupId}/settle`} aria-current={pathname.endsWith("/settle") ? "page" : undefined}>Summary</Link>
        </nav>
      ) : null}
    </header>
  );
}
