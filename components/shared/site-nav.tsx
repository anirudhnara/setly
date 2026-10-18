"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { firebaseConfigured, signOut, watchAuth } from "@/lib/auth/client";
import { SAMPLE_GROUP_ID, readLastGroup } from "@/components/shared/session";

const LINKS = [{ href: "/home", label: "New set" }];

export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
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
    if (!firebaseConfigured()) return;
    return watchAuth((user) => {
      setYou(user?.displayName?.trim() || user?.email?.split("@")[0] || "");
    });
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
            My set
          </Link>
        </nav>
        <span className="orbit-kicker">
          {you ? (
            <>
              <span className="avatar" aria-hidden="true">{you.slice(0, 1).toUpperCase()}</span>
              {you}
              <button type="button" className="nav-sign-out" onClick={() => void signOut().then(() => router.push("/"))}>
                Sign out
              </button>
            </>
          ) : (
            "Shop together"
          )}
        </span>
      </div>
      {groupId && pathname === `/g/${groupId}` ? (
        <nav className="orbit-subnav" aria-label="Group">
          <Link href={`/g/${groupId}`} aria-current={pathname === `/g/${groupId}` ? "page" : undefined}>Set</Link>
          <Link href={`/g/${groupId}/join`} aria-current={pathname.endsWith("/join") ? "page" : undefined}>Invite</Link>
          <Link href={`/g/${groupId}/split`} aria-current={pathname.endsWith("/split") ? "page" : undefined}>Split</Link>
          <Link href={`/g/${groupId}/checkout`} aria-current={pathname.endsWith("/checkout") ? "page" : undefined}>Checkout</Link>
          <Link href={`/g/${groupId}/settle`} aria-current={pathname.endsWith("/settle") ? "page" : undefined}>Returns</Link>
        </nav>
      ) : null}
    </header>
  );
}
