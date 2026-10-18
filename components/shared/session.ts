import type { MapData } from "@/lib/types";

export const SAMPLE_GROUP_ID = "grp_apartment";

export interface SessionMember {
  memberId: string;
  name: string;
}

export function stageMap(groupId: string, map: MapData) {
  write(`setly.map.${groupId}`, JSON.stringify(map));
  write("setly.lastGroup", groupId);
}

export function readStagedMap(groupId: string): MapData | null {
  const raw = read(`setly.map.${groupId}`);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isMap(value)) return null;
    return value;
  } catch {
    return null;
  }
}

export function stageMember(groupId: string, member: SessionMember) {
  write(`setly.member.${groupId}`, JSON.stringify(member));
  write("setly.lastGroup", groupId);
}

export function readMember(groupId: string): SessionMember | null {
  const raw = read(`setly.member.${groupId}`);
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const member = value as Partial<SessionMember>;
    if (typeof member.memberId !== "string" || typeof member.name !== "string") return null;
    return { memberId: member.memberId, name: member.name };
  } catch {
    return null;
  }
}

export function readLastGroup() {
  return read("setly.lastGroup");
}

/** Who's paying, picked in the chat or the nav. Display and prompt hint only; money logic doesn't read it. */
export type FundingMode = "solo" | "group" | "parent" | "insurance";
const MODES: FundingMode[] = ["solo", "group", "parent", "insurance"];
const MODE_EVENT = "setly:mode";

/** Saves the mode and tells every open screen (nav chip, chat, vibe step) so they stay in step. */
export function stageMode(mode: FundingMode) {
  write("setly.mode", mode);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<FundingMode>(MODE_EVENT, { detail: mode }));
}

/** Calls back whenever the mode changes. Returns the unsubscribe function, for an effect cleanup. */
export function watchMode(onChange: (mode: FundingMode) => void) {
  const listener = (event: Event) => {
    const mode = (event as CustomEvent<FundingMode>).detail;
    if (MODES.includes(mode)) onChange(mode);
  };
  window.addEventListener(MODE_EVENT, listener);
  return () => window.removeEventListener(MODE_EVENT, listener);
}

export function readMode(): FundingMode {
  const value = read("setly.mode");
  return MODES.includes(value as FundingMode) ? (value as FundingMode) : "group";
}

/** The brief from step 1, handed to the vibe step (2) and used to create the set (3). */
export interface Draft {
  name: string;
  prompt: string;
  budgetCents: number;
  people: number | null;
}

export function stageDraft(draft: Draft) {
  write("setly.draft", JSON.stringify(draft));
}

export function readDraft(): Draft | null {
  const raw = read("setly.draft");
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Draft>;
    if (typeof value.name !== "string" || typeof value.prompt !== "string" || typeof value.budgetCents !== "number") return null;
    return { name: value.name, prompt: value.prompt, budgetCents: value.budgetCents, people: typeof value.people === "number" ? value.people : null };
  } catch {
    return null;
  }
}

export function stageYou(name: string) {
  write("setly.you", name);
}

export function readYou() {
  return read("setly.you");
}

/** What this viewer has taught Setly about the set: loved and passed-on needs, and feedback said so far. */
export interface Taste {
  loved: string[];
  passed: string[];
  history: string[];
}

export function readTaste(groupId: string): Taste {
  const empty: Taste = { loved: [], passed: [], history: [] };
  const raw = read(`setly.taste.${groupId}`);
  if (!raw) return empty;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return empty;
    const taste = value as Partial<Record<keyof Taste, unknown>>;
    const strings = (list: unknown) => (Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : []);
    return { loved: strings(taste.loved), passed: strings(taste.passed), history: strings(taste.history).slice(-20) };
  } catch {
    return empty;
  }
}

export function stageTaste(groupId: string, taste: Taste) {
  write(`setly.taste.${groupId}`, JSON.stringify(taste));
}

function isMap(value: unknown): value is MapData {
  if (typeof value !== "object" || value === null) return false;
  const map = value as Partial<MapData>;
  return Array.isArray(map.zones) && Array.isArray(map.slots) && Array.isArray(map.products);
}

function write(key: string, value: string) {
  try {
    if (key === "setly.mode") localStorage.setItem(key, value);
    sessionStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function read(key: string) {
  try {
    return sessionStorage.getItem(key) ?? (key === "setly.mode" ? localStorage.getItem(key) : null);
  } catch {
    return null;
  }
}
