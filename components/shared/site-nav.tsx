"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown, Info, LogOut, Receipt, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { JarvisMark } from "@/components/shared/jarvis-mark";
import { MODE_INFO } from "@/components/shared/modes";
import { readLastGroup, readMode, stageMode, watchMode, type FundingMode } from "@/components/shared/session";
import { firebaseConfigured, signOut, watchAuth } from "@/lib/auth/client";

const MODES: FundingMode[] = ["solo", "group", "parent", "insurance"];

const LINKS = [
  { href: "/home", label: "New set", icon: Sparkles },
  { href: "/account", label: "My sets", icon: Receipt },
];

/**
 * The top bar on every app screen: slides in, a pill glides to whichever link you point at, it tightens on scroll,
 * and the account menu opens with a spring.
 */
export function SiteNav() {
  const pathname = usePathname();
  const router = useRouter();
  const groupId = pathname.match(/^\/g\/([^/]+)/)?.[1];
  const [you, setYou] = useState<{ name: string; email: string } | null>(null);
  const [mode, setMode] = useState<FundingMode>("group");
  const [lastGroup, setLastGroup] = useState<string | null>(null);
  const [scrolled, setScrolled] = useState(false);
  const [menu, setMenu] = useState(false);
  const [modeMenu, setModeMenu] = useState(false);
  const [pill, setPill] = useState<{ left: number; width: number; visible: boolean }>({ left: 0, width: 0, visible: false });
  const [hovered, setHovered] = useState<string | null>(null);
  const linksRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<HTMLDivElement>(null);

  const active = pathname === "/vibes" ? "/home" : (LINKS.find((link) => pathname === link.href || pathname.startsWith(`${link.href}/`))?.href ?? null);

  useEffect(() => {
    if (!firebaseConfigured()) return;
    return watchAuth((user) => {
      setMode(readMode());
      setLastGroup(readLastGroup());
      setYou(user ? { name: user.displayName?.trim() || user.email?.split("@")[0] || "You", email: user.email ?? "" } : null);
    });
  }, []);

  useEffect(() => watchMode(setMode), []);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Either menu closes on Escape or a click outside it.
  useEffect(() => {
    if (!menu && !modeMenu) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      const outside = (ref: { current: HTMLDivElement | null }) => !ref.current?.contains(event.target as Node);
      if (event instanceof KeyboardEvent ? event.key === "Escape" : outside(menuRef)) setMenu(false);
      if (event instanceof KeyboardEvent ? event.key === "Escape" : outside(modeRef)) setModeMenu(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [menu, modeMenu]);

  // The pill follows the hovered link, and rests on the current page's link.
  useLayoutEffect(() => {
    const target = hovered ?? active;
    const element = target ? linksRef.current?.querySelector<HTMLElement>(`[data-href="${target}"]`) : null;
    if (!element) {
      setPill((current) => ({ ...current, visible: false }));
      return;
    }
    setPill({ left: element.offsetLeft, width: element.offsetWidth, visible: true });
  }, [hovered, active, you]);

  async function leave() {
    setMenu(false);
    try {
      await signOut();
    } finally {
      router.push("/");
    }
  }

  return (
    <header className={`setly-nav${scrolled ? " scrolled" : ""}`}>
      <div className="setly-nav-row">
        <Link href="/home" className="nav-brand" aria-label="Setly: start a new set">
          <JarvisMark size={30} />
          <span>setly</span>
        </Link>

        <nav className="nav-links" aria-label="Primary" ref={linksRef} onMouseLeave={() => setHovered(null)}>
          <span className={`nav-pill${pill.visible ? " on" : ""}`} style={{ transform: `translateX(${pill.left}px)`, width: pill.width }} aria-hidden="true" />
          {LINKS.map(({ href, label, icon: Icon }, index) => (
            <Link key={href} href={href} data-href={href} className={active === href ? "current" : ""} aria-current={active === href ? "page" : undefined} onMouseEnter={() => setHovered(href)} onFocus={() => setHovered(href)} onBlur={() => setHovered(null)} style={{ animationDelay: `${0.08 + index * 0.06}s` }}>
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
          {groupId || lastGroup ? (
            <Link href={`/g/${groupId ?? lastGroup}`} data-href="set" className={groupId ? "current set-link" : "set-link"} onMouseEnter={() => setHovered("set")} onFocus={() => setHovered("set")} onBlur={() => setHovered(null)} style={{ animationDelay: "0.26s" }}>
              <span className="live-dot" aria-hidden="true" />
              <span>{groupId ? "This set" : "Last set"}</span>
            </Link>
          ) : null}
        </nav>

        <div className="nav-right">
          <div className="nav-account" ref={modeRef}>
            <button type="button" className="mode-chip" aria-expanded={modeMenu} aria-haspopup="menu" aria-label={`Who’s paying: ${MODE_INFO[mode].label}. Change`} onClick={() => setModeMenu((open) => !open)}>
              {mode === "insurance" ? <ShieldCheck aria-hidden="true" /> : null}
              {MODE_INFO[mode].short}
              <ChevronDown aria-hidden="true" />
            </button>
            {modeMenu ? (
              <div className="account-menu mode-menu" role="menu" aria-label="Who’s paying">
                <div className="menu-head"><strong>Who’s paying?</strong><span>Shapes the questions and how the set is split.</span></div>
                {MODES.map((key) => (
                  <button key={key} type="button" role="menuitemradio" aria-checked={mode === key} onClick={() => { stageMode(key); setModeMenu(false); }}>
                    <span className="mode-option"><b>{MODE_INFO[key].label}</b><small>{MODE_INFO[key].blurb}</small></span>
                    {mode === key ? <Check aria-hidden="true" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          {you ? (
            <div className="nav-account" ref={menuRef}>
              <button type="button" className="account-btn" aria-expanded={menu} aria-haspopup="menu" onClick={() => setMenu((open) => !open)}>
                <span className="avatar-dot t1" aria-hidden="true">{you.name.slice(0, 1).toUpperCase()}</span>
                <span className="account-name">{you.name.split(" ")[0]}</span>
                <ChevronDown aria-hidden="true" />
              </button>
              {menu ? (
                <div className="account-menu" role="menu">
                  <div className="menu-head">
                    <strong>{you.name}</strong>
                    <span>{you.email}</span>
                  </div>
                  <Link role="menuitem" href="/account" onClick={() => setMenu(false)}><UserRound aria-hidden="true" /> Account</Link>
                  <Link role="menuitem" href="/account#purchases" onClick={() => setMenu(false)}><Receipt aria-hidden="true" /> Purchases</Link>
                  <Link role="menuitem" href="/account#protection" onClick={() => setMenu(false)}><ShieldCheck aria-hidden="true" /> Protection</Link>
                  <Link role="menuitem" href="/" onClick={() => setMenu(false)}><Info aria-hidden="true" /> About Setly</Link>
                  <button type="button" role="menuitem" onClick={() => void leave()}><LogOut aria-hidden="true" /> Sign out</button>
                </div>
              ) : null}
            </div>
          ) : (
            <Link href={`/sign-in?next=${encodeURIComponent(pathname)}`} className="btn btn-accent nav-signin">Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}
