import type { GeneratedMap } from "@/lib/ai/schemas";

/**
 * Pure text helpers. The generate request only carries a prompt string, so questionnaire answers
 * (budget, group size, door width) are read back out of it here. Used by the mock path and as hints for Gemini.
 */

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};

function toNumber(word: string): number | null {
  const lower = word.toLowerCase();
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower];
  const value = Number(lower);
  return Number.isInteger(value) ? value : null;
}

/** "$1,200", "1.5k", "budget 900" → integer cents. Null when no amount is found. */
export function parseBudgetCents(text: string): number | null {
  const money = text.match(/\$\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?/i);
  const budgetWord = text.match(/budget(?:\s+(?:of|is|around|about|under))?\s*:?\s*(\d[\d,]*(?:\.\d{1,2})?)\s*(k\b)?/i);
  const dollarsWord = text.match(/(\d[\d,]*(?:\.\d{1,2})?)\s*(k)?\s*(?:dollars|usd)\b/i);
  const match = money ?? budgetWord ?? dollarsWord;
  if (!match) return null;
  const dollars = Number(match[1].replace(/,/g, "")) * (match[2] ? 1000 : 1);
  if (!Number.isFinite(dollars) || dollars <= 0) return null;
  const after = text.slice((match.index ?? 0) + match[0].length);
  const perPerson = /^\s*(?:\/\s*|per\s+|a\s+)(?:person|head|roommate|member)\b|^\s*each\b/i.test(after);
  const people = perPerson ? parseMemberCount(text) : null;
  return Math.round(dollars * 100) * (people ?? 1);
}

/** "4 roommates", "group of three", "six friends" → member count. Null when not stated. */
export function parseMemberCount(text: string): number | null {
  const number = "(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)";
  const patterns = [
    new RegExp(`\\b${number}\\s+(?:of us|roommates?|people|persons?|friends|members|students|guys|kids|adults|campers|housemates|flatmates)\\b`, "i"),
    new RegExp(`\\b(?:group|party|family|team) of\\s+${number}\\b`, "i"),
    new RegExp(`\\b(?:people|members|roommates|group size|headcount)\\s*:\\s*${number}\\b`, "i"),
    new RegExp(`\\b(?:for|with)\\s+${number}\\b(?!\\s*(?:in\\b|inch|"|ft|feet|%|\\$|days?|nights?|weeks?|weekends?|months?|hours?|years?))`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const value = match ? toNumber(match[1]) : null;
    if (value !== null && value > 0 && value <= 50) return value;
  }
  return null;
}

/** "door is 32 inches", "32\" door", "door width: 30 in" → inches. Null when not stated. */
export function parseDoorWidthIn(text: string): number | null {
  const after = text.match(/door(?:way)?(?:\s+(?:width|is))*(?:\s+of)?\s*:?\s*(\d{2}(?:\.\d)?)\s*(?:"|in\b|inch|inches|(?=\s*(?:[,.;)]|$)))/i);
  const before = text.match(/(\d{2}(?:\.\d)?)\s*(?:"|-?\s*in\b|-?\s*inch(?:es)?)\s*(?:wide\s+)?door/i);
  const value = Number((after ?? before)?.[1]);
  return Number.isFinite(value) && value >= 20 && value <= 60 ? value : null;
}

const MAX_PASTED_SLOTS = 30;

/**
 * Turns a pasted list (a Claude answer, a registry, a spreadsheet column) into map structure without a model.
 * Lines ending in ":" or markdown headings become zones. Bullets, numbering, checkboxes, and prices are stripped.
 * "2x Chair" and "Chair (2)" set the quantity. "each" or "per person" makes the slot per person.
 */
export function parsePastedList(text: string): GeneratedMap {
  const lines = text.includes("\n") ? text.split(/\r?\n/) : text.split(/[,;]/);
  // In a pasted answer with bullets, the prose around the list isn't items.
  const isListLine = (line: string) => /^\s*(?:[-*•·]|\d+[.)]|\[[ xX]?\])\s+/.test(line);
  const listOnly = lines.filter(isListLine).length >= 2;
  const zones: GeneratedMap["zones"] = [];
  const seen = new Set<string>();
  let current: GeneratedMap["zones"][number] | null = null;
  let count = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, " ").trim();
    if (!line) continue;
    const heading = line.match(/^#{1,6}\s+(.+)$/) ?? line.match(/^([^:]{1,40}):\s*$/);
    if (heading) {
      const name = cleanName(heading[1]);
      // "Here's a list for your living room:" introduces the list; it isn't a zone.
      if (name.length > 30 || /^(here|sure|okay|ok|great|below|this|these)\b/i.test(name)) continue;
      current = { name, sortOrder: zones.length, slots: [] };
      zones.push(current);
      continue;
    }
    if (count >= MAX_PASTED_SLOTS) break;
    if (listOnly && !isListLine(rawLine)) continue;

    let item = line
      .replace(/^(?:[-*•·>]+|\d+[.)]|\[[ xX]?\])\s*/, "")
      .replace(/^(?:\[[ xX]?\])\s*/, "")
      .replace(/\*\*/g, "");
    let quantity = 1;
    const leading = item.match(/^(\d{1,2})\s*[x×]\s+(.+)$/i);
    if (leading) {
      quantity = Number(leading[1]);
      item = leading[2];
    }
    const trailing = item.match(/^(.+?)\s*(?:\((\d{1,2})\)|[x×]\s*(\d{1,2}))\s*$/i);
    if (trailing) {
      quantity = Number(trailing[2] ?? trailing[3]);
      item = trailing[1];
    }
    const perPerson = /\b(each|per person|for everyone|one per person|apiece)\b/i.test(item);
    const owned = /\b(already (?:have|own|owned)|have one|owned)\b/i.test(item);
    // Keep the item, drop notes after a dash or colon, prices, and links.
    item = item
      .replace(/https?:\/\/\S+/g, "")
      .replace(/\(.*?\)/g, "")
      .replace(/\s*:\s+.*$|\s+[-–—]\s+.*$/, "")
      .replace(/\$\s*\d[\d,]*(?:\.\d{1,2})?/g, "")
      .replace(/\b(each|per person|for everyone|one per person|apiece|already (?:have|own|owned)|have one|owned)\b/gi, "");
    const need = cleanName(item);
    if (/^(total|subtotal|grand total|budget|tax|shipping|estimated)\b/i.test(need)) continue;
    if (need.length < 2 || need.length > 60 || seen.has(need.toLowerCase())) continue;
    seen.add(need.toLowerCase());

    if (!current) {
      current = { name: "Plan", sortOrder: 0, slots: [] };
      zones.push(current);
    }
    current.slots.push({
      need,
      quantityRule: perPerson ? "per_person" : quantity > 1 ? "fixed" : "per_group",
      quantity: Math.max(1, Math.min(quantity, 50)),
      payType: owned ? "already_owned" : perPerson ? "per_person" : "shared",
      searchQuery: need,
      budgetWeight: 10,
    });
    count += 1;
  }

  const filled = zones.filter((zone) => zone.slots.length > 0).map((zone, index) => ({ ...zone, sortOrder: index }));
  return { zones: filled, links: [], rules: [] };
}

function cleanName(text: string) {
  const cleaned = text.replace(/[*_`#]/g, "").replace(/\s+/g, " ").replace(/[.,;:]+$/, "").trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

export interface QuestionnaireItems {
  owned: string[];
  mustHaves: string[];
}

/**
 * Questionnaire chips folded into the prompt: "already have: a lamp, a rug" and "must-haves: desk and bookshelf".
 * Owned items become already-owned slots (no cost); must-haves are added when missing and become a required rule.
 */
export function parseQuestionnaireItems(text: string): QuestionnaireItems {
  const grab = (pattern: RegExp) => {
    const match = text.match(pattern);
    if (!match) return [];
    return match[1]
      .split(/,|\band\b|\//i)
      .map((part) => cleanName(part.replace(/^\s*(?:a|an|the|some|our|my)\s+/i, "")))
      .filter((part) => part.length >= 2 && part.length <= 40);
  };
  return {
    owned: grab(/(?:already (?:have|own|owned)|owned items?|have already|skip)\s*:?\s*([^.;\n]+)/i),
    mustHaves: grab(/(?:must[- ]?haves?|need(?:s)? to have|required items?)\s*:?\s*([^.;\n]+)/i),
  };
}

/** "lamp" matches "Floor lamp", "rugs" matches "Rug". */
export function needMatches(need: string, item: string) {
  const clean = (value: string) => value.trim().toLowerCase().replace(/\s+/g, " ").replace(/(?<=[a-z]{3})(?:es|s)$/, "");
  const [a, b] = [clean(need), clean(item)];
  if (a === b) return true;
  const words = (value: string) => new Set(value.split(" "));
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  return shorter.split(" ").every((word) => words(longer).has(word));
}

/** Applies owned items and must-haves to model structure, whatever the model did with them. */
export function applyQuestionnaire(generated: GeneratedMap, items: QuestionnaireItems): GeneratedMap {
  if (items.owned.length === 0 && items.mustHaves.length === 0) return generated;
  const zones = generated.zones.map((zone) => ({
    ...zone,
    slots: zone.slots.map((slot) =>
      items.owned.some((item) => needMatches(slot.need, item)) ? { ...slot, payType: "already_owned" as const, quantityRule: "per_group" as const } : slot,
    ),
  }));
  const allNeeds = zones.flatMap((zone) => zone.slots.map((slot) => slot.need));
  const missing = items.mustHaves.filter((item) => !allNeeds.some((need) => needMatches(need, item)));
  if (missing.length > 0 && zones.length > 0) {
    zones[0] = {
      ...zones[0],
      slots: [...zones[0].slots, ...missing.map((need) => ({ need, quantityRule: "per_group" as const, quantity: 1, payType: "shared" as const, searchQuery: need, budgetWeight: 10 }))],
    };
  }
  const rules = items.mustHaves.length > 0 ? [...generated.rules, { type: "required_or_banned" as const, needs: [], params: { requiredNeeds: items.mustHaves } }] : generated.rules;
  return { ...generated, zones, rules };
}
