"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { SponsorCard } from "@/lib/sponsor/card";

/**
 * Sponsored cards live in this browser (demo). "sent" are cards you funded; "received" are cards sent to you.
 * Reads and writes are guarded: a private window or blocked storage just means an empty list.
 */
export type CardBox = "sent" | "received";

const KEY: Record<CardBox, string> = { sent: "setly:sponsor:sent", received: "setly:sponsor:received" };
const EMPTY: SponsorCard[] = [];
const cache = new Map<CardBox, { raw: string | null; cards: SponsorCard[] }>();
const listeners = new Set<() => void>();

function read(box: CardBox): SponsorCard[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(KEY[box]);
  } catch {
    raw = null;
  }
  const hit = cache.get(box);
  if (hit && hit.raw === raw) return hit.cards;
  let cards: SponsorCard[] = EMPTY;
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    cards = Array.isArray(parsed) ? (parsed as SponsorCard[]) : EMPTY;
  } catch {
    cards = EMPTY;
  }
  cache.set(box, { raw, cards });
  return cards;
}

function write(box: CardBox, cards: SponsorCard[]) {
  const raw = JSON.stringify(cards);
  try {
    window.localStorage.setItem(KEY[box], raw);
  } catch {
    // Storage is off: keep the change for this page view only.
  }
  cache.set(box, { raw, cards });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function useCards(box: CardBox) {
  const cards = useSyncExternalStore(subscribe, () => read(box), () => EMPTY);
  const update = useCallback((change: (current: SponsorCard[]) => SponsorCard[]) => write(box, change(read(box))), [box]);
  return [cards, update] as const;
}
