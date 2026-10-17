import type { MapData, Member, Product, Rule, RuleStatus, Slot } from "@/lib/types";

/**
 * Evaluates every rule on the map in code and returns the same rules with updated status and message.
 * The model does not decide whether a rule passes. Pure: no database, network, or clock unless `now` is omitted.
 *
 * - budget: compare the charged plan total (or the total of `slotIds`) with `params.maxCents`.
 *   Over is broken, 95% or more is a warning.
 * - quantity: `params.per === "member"` needs one per member; `params.expected` compares each slot's quantity.
 * - compatibility: compare `params.attribute` across `slotIds`, or against `params.value` when given.
 * - size: `params.doorWidthIn` (fits through the door), `params.maxWidthIn`, or a two-slot `params.relation`
 *   (first slot at least as wide as the second). `not_checked` when size attributes are missing.
 * - timing: `params.neededBy` against `deliveryDate` or `deliveryDays` on each product. `not_checked` when missing.
 * - required_or_banned: `params.requiredNeeds`, `params.bannedNeeds`, `params.bannedStores`.
 *
 * Charged amounts match the money code: already-owned slots and slots without a chosen product cost nothing,
 * per-person slots cost price × quantity × member count, everything else price × quantity.
 */
export interface CheckRulesOptions {
  /** Used for per-person math when the group has no members yet (a freshly generated map). */
  memberCount?: number;
  /** Clock for timing rules. Defaults to the current time. */
  now?: Date;
}

interface Context {
  map: MapData;
  memberCount: number;
  now: Date;
  slotById: Map<string, Slot>;
  productById: Map<string, Product>;
}

type Verdict = { status: RuleStatus; message: string };

export function checkRules(map: MapData, members: Member[], options: CheckRulesOptions = {}): Rule[] {
  const context: Context = {
    map,
    memberCount: effectiveMemberCount(members, options.memberCount),
    now: options.now ?? new Date(),
    slotById: new Map(map.slots.map((slot) => [slot.id, slot])),
    productById: new Map(map.products.map((product) => [product.id, product])),
  };
  return map.rules.map((rule) => ({ ...rule, ...evaluate(rule, context) }));
}

export function effectiveMemberCount(members: Member[], fallback?: number) {
  if (members.length > 0) return members.length;
  return fallback !== undefined && Number.isInteger(fallback) && fallback > 0 ? fallback : 1;
}

/** The product currently chosen for a slot, or null. */
export function chosenProduct(map: MapData, slot: Slot): Product | null {
  if (!slot.chosenProductId) return null;
  return map.products.find((product) => product.id === slot.chosenProductId) ?? null;
}

/** Integer cents the group pays for one slot. Mirrors the share math in lib/money. */
export function chargedCentsForSlot(slot: Slot, product: Product | null, memberCount: number): number {
  if (slot.payType === "already_owned" || !product) return 0;
  const units = slot.payType === "per_person" ? slot.quantity * memberCount : slot.quantity;
  return product.priceCents * units;
}

/** Integer cents for the whole plan, or for the given slots only. */
export function planTotalCents(map: MapData, memberCount: number, slotIds?: string[]): number {
  const wanted = slotIds && slotIds.length > 0 ? new Set(slotIds) : null;
  return map.slots
    .filter((slot) => !wanted || wanted.has(slot.id))
    .reduce((sum, slot) => sum + chargedCentsForSlot(slot, chosenProduct(map, slot), memberCount), 0);
}

function evaluate(rule: Rule, context: Context): Verdict {
  switch (rule.type) {
    case "budget":
      return checkBudget(rule, context);
    case "quantity":
      return checkQuantity(rule, context);
    case "compatibility":
      return checkCompatibility(rule, context);
    case "size":
      return checkSize(rule, context);
    case "timing":
      return checkTiming(rule, context);
    case "required_or_banned":
      return checkRequiredOrBanned(rule, context);
    default:
      return { status: "not_checked", message: "This rule type isn't supported." };
  }
}

function checkBudget(rule: Rule, context: Context): Verdict {
  const maxCents = numberParam(rule.params.maxCents);
  if (maxCents === null || maxCents < 0) {
    return { status: "not_checked", message: "No budget is set, so spending isn't checked." };
  }
  const slots = rule.slotIds.length > 0 ? resolveSlots(rule, context) : context.map.slots;
  if (rule.slotIds.length > 0 && slots.length === 0) {
    return { status: "not_checked", message: "The items this budget covered were removed." };
  }
  const total = slots.reduce((sum, slot) => sum + chargedCentsForSlot(slot, productFor(slot, context), context.memberCount), 0);
  const empty = slots.filter((slot) => slot.payType !== "already_owned" && !productFor(slot, context)).length;
  const emptyNote = empty > 0 ? ` ${empty} ${empty === 1 ? "slot is" : "slots are"} still empty.` : "";
  const scope = rule.slotIds.length > 0 ? `${needList(slots)} budget` : "budget";
  if (total > maxCents) {
    return {
      status: "broken",
      message: `${formatCents(total)} is over the ${formatCents(maxCents)} ${scope} by ${formatCents(total - maxCents)}.${emptyNote}`,
    };
  }
  const left = maxCents - total;
  if (maxCents > 0 && total * 100 >= maxCents * 95) {
    return { status: "warning", message: `${formatCents(total)} of the ${formatCents(maxCents)} ${scope}, only ${formatCents(left)} left.${emptyNote}` };
  }
  return { status: "ok", message: `${formatCents(total)} of the ${formatCents(maxCents)} ${scope}, ${formatCents(left)} left.${emptyNote}` };
}

function checkQuantity(rule: Rule, context: Context): Verdict {
  const slots = resolveSlots(rule, context);
  if (slots.length === 0) return missingSlots(rule);
  const per = typeof rule.params.per === "string" ? rule.params.per.toLowerCase() : null;
  const expected = numberParam(rule.params.expected);
  const people = context.memberCount;

  if (per === "member" || per === "person") {
    const short = slots.filter((slot) => !isPerPerson(slot) && slot.quantity < people);
    if (short.length > 0) {
      return {
        status: "broken",
        message: short.map((slot) => `${slot.need}: ${slot.quantity} for ${people} ${plural(people, "person", "people")}`).join("; ") + ".",
      };
    }
    return { status: "ok", message: `${needList(slots)}: one for each of the ${people} ${plural(people, "person", "people")}.` };
  }

  if (expected !== null) {
    const counts = slots.map((slot) => ({ slot, count: isPerPerson(slot) ? slot.quantity * people : slot.quantity }));
    const under = counts.filter((entry) => entry.count < expected);
    if (under.length > 0) {
      return { status: "broken", message: under.map((entry) => `${entry.slot.need}: ${entry.count} of ${expected} needed`).join("; ") + "." };
    }
    const over = counts.filter((entry) => entry.count > expected);
    if (over.length > 0) {
      return { status: "warning", message: over.map((entry) => `${entry.slot.need}: ${entry.count}, more than the ${expected} needed`).join("; ") + "." };
    }
    return { status: "ok", message: `${needList(slots)}: ${expected}, as planned.` };
  }

  return { status: "not_checked", message: "No expected quantity is set." };
}

function checkCompatibility(rule: Rule, context: Context): Verdict {
  const attribute = typeof rule.params.attribute === "string" ? rule.params.attribute : null;
  if (!attribute) return { status: "not_checked", message: "No attribute to compare is set." };
  const slots = resolveSlots(rule, context);
  if (slots.length === 0) return missingSlots(rule);
  const label = humanize(attribute);

  const unpicked = slots.filter((slot) => !productFor(slot, context));
  if (unpicked.length > 0) {
    return { status: "not_checked", message: `Pick a product for ${needList(unpicked)} to check ${label}.` };
  }
  const values = slots.map((slot) => ({ slot, value: productFor(slot, context)?.attributes[attribute] }));
  const unknown = values.filter((entry) => entry.value === undefined || entry.value === "");
  if (unknown.length > 0) {
    return { status: "not_checked", message: `${needList(unknown.map((entry) => entry.slot))} doesn't list its ${label}.` };
  }

  const required = rule.params.value;
  if (typeof required === "string" || typeof required === "number") {
    const wrong = values.filter((entry) => normalizeValue(entry.value) !== normalizeValue(required));
    if (wrong.length > 0) {
      const detail = wrong.map((entry) => `${entry.slot.need} is ${entry.value}`).join(", ");
      return { status: "broken", message: `${detail}, but the plan needs ${label} ${required}.` };
    }
    return { status: "ok", message: `${needList(slots)}: ${label} ${required}, as needed.` };
  }

  const distinct = new Set(values.map((entry) => normalizeValue(entry.value)));
  if (distinct.size > 1) {
    return { status: "broken", message: `${capitalize(label)} doesn't match: ${values.map((entry) => `${entry.slot.need} is ${entry.value}`).join(", ")}.` };
  }
  return { status: "ok", message: `${needList(slots)} match on ${label} (${values[0].value}).` };
}

function checkSize(rule: Rule, context: Context): Verdict {
  const slots = resolveSlots(rule, context);
  if (slots.length === 0) return missingSlots(rule);
  const doorWidth = numberParam(rule.params.doorWidthIn);
  const maxWidth = numberParam(rule.params.maxWidthIn);

  if (doorWidth !== null) {
    const blocked: string[] = [];
    const unknown: Slot[] = [];
    const picked = slots.filter((slot) => productFor(slot, context));
    if (picked.length === 0) return noProducts(slots, "door fit");
    for (const slot of picked) {
      const product = productFor(slot, context)!;
      const dims = ["widthIn", "depthIn", "heightIn"]
        .map((key) => numberParam(product.attributes[key]))
        .filter((value): value is number => value !== null);
      const smallest = dims.length > 0 ? Math.min(...dims) : null;
      if (smallest !== null && smallest <= doorWidth) continue;
      if (dims.length < 3) {
        unknown.push(slot);
        continue;
      }
      blocked.push(`${slot.need} (smallest side ${smallest} in)`);
    }
    if (blocked.length > 0) {
      return { status: "broken", message: `Won't fit through the ${doorWidth} in door: ${blocked.join(", ")}.` };
    }
    const fits = picked.filter((slot) => !unknown.includes(slot));
    if (unknown.length > 0 && fits.length === 0) {
      return { status: "not_checked", message: `Dimensions are missing for ${needList(unknown)}, so door fit isn't checked.` };
    }
    if (unknown.length > 0) {
      // Each item is judged on its own: a missing size on one item doesn't hide that the others fit.
      return { status: "warning", message: `${needList(fits)} fit${fits.length === 1 ? "s" : ""} through the ${doorWidth} in door. Dimensions are missing for ${needList(unknown)}.` };
    }
    return { status: "ok", message: `${needList(picked)} fit${picked.length === 1 ? "s" : ""} through the ${doorWidth} in door.` };
  }

  if (maxWidth !== null) {
    const tooWide: string[] = [];
    const unknown: Slot[] = [];
    const picked = slots.filter((slot) => productFor(slot, context));
    if (picked.length === 0) return noProducts(slots, "fit");
    for (const slot of picked) {
      const product = productFor(slot, context)!;
      const width = numberParam(product.attributes.widthIn);
      if (width === null) unknown.push(slot);
      else if (width > maxWidth) tooWide.push(`${slot.need} (${width} in)`);
    }
    if (tooWide.length > 0) return { status: "broken", message: `Wider than the ${maxWidth} in space: ${tooWide.join(", ")}.` };
    const fits = picked.filter((slot) => !unknown.includes(slot));
    if (unknown.length > 0 && fits.length === 0) return { status: "not_checked", message: `Width is missing for ${needList(unknown)}, so fit isn't checked.` };
    if (unknown.length > 0) {
      return { status: "warning", message: `${needList(fits)} fit${fits.length === 1 ? "s" : ""} the ${maxWidth} in space. Width is missing for ${needList(unknown)}.` };
    }
    return { status: "ok", message: `${needList(picked)} fit${picked.length === 1 ? "s" : ""} the ${maxWidth} in space.` };
  }

  if (typeof rule.params.relation === "string" && slots.length >= 2) {
    const attribute = typeof rule.params.attribute === "string" ? rule.params.attribute : "widthIn";
    const [outer, inner] = slots;
    const outerValue = numberParam(productFor(outer, context)?.attributes[attribute]);
    const innerValue = numberParam(productFor(inner, context)?.attributes[attribute]);
    if (outerValue === null || innerValue === null) {
      const missing = [outer, inner].filter((_slot, index) => (index === 0 ? outerValue : innerValue) === null);
      return { status: "not_checked", message: `${capitalize(humanize(attribute))} is missing for ${needList(missing)}, so fit isn't checked.` };
    }
    if (outerValue < innerValue) {
      return { status: "warning", message: `${outer.need} (${outerValue} in) is smaller than ${inner.need} (${innerValue} in).` };
    }
    return { status: "ok", message: `${outer.need} (${outerValue} in) fits ${inner.need} (${innerValue} in).` };
  }

  return { status: "not_checked", message: "No size limit is set." };
}

function checkTiming(rule: Rule, context: Context): Verdict {
  const neededBy = dateParam(rule.params.neededBy);
  if (!neededBy) return { status: "not_checked", message: "No needed-by date is set." };
  const slots = resolveSlots(rule, context);
  if (slots.length === 0) return missingSlots(rule);
  const late: string[] = [];
  const unknown: Slot[] = [];
  const picked = slots.filter((slot) => productFor(slot, context));
  if (picked.length === 0) return noProducts(slots, "timing");
  for (const slot of picked) {
    const product = productFor(slot, context)!;
    const arrives = arrivalDate(product, context.now);
    if (!arrives) unknown.push(slot);
    else if (arrives.getTime() > neededBy.getTime()) late.push(`${slot.need} arrives ${formatDate(arrives)}`);
  }
  if (late.length > 0) return { status: "broken", message: `${late.join(", ")}, after ${formatDate(neededBy)}.` };
  if (unknown.length > 0) {
    return { status: "not_checked", message: `Delivery dates are missing for ${needList(unknown)}, so timing isn't checked.` };
  }
  return { status: "ok", message: `Everything arrives by ${formatDate(neededBy)}.` };
}

function checkRequiredOrBanned(rule: Rule, context: Context): Verdict {
  const required = stringList(rule.params.requiredNeeds);
  const bannedNeeds = stringList(rule.params.bannedNeeds);
  const bannedStores = stringList(rule.params.bannedStores);
  if (required.length === 0 && bannedNeeds.length === 0 && bannedStores.length === 0) {
    return { status: "not_checked", message: "No required or banned items are set." };
  }

  const problems: string[] = [];
  const warnings: string[] = [];
  for (const need of required) {
    const slot = context.map.slots.find((item) => sameNeed(item.need, need));
    if (!slot) problems.push(`${need} is required but isn't on the plan`);
    else if (slot.payType !== "already_owned" && !productFor(slot, context)) warnings.push(`${slot.need} is required but has no product yet`);
  }
  for (const need of bannedNeeds) {
    const slot = context.map.slots.find((item) => sameNeed(item.need, need));
    if (slot) problems.push(`${slot.need} isn't allowed on this plan`);
  }
  for (const slot of context.map.slots) {
    if (slot.payType === "already_owned") continue;
    const product = productFor(slot, context);
    if (!product) continue;
    const banned = bannedStores.find((store) => product.store.toLowerCase().includes(store.toLowerCase()));
    if (banned) problems.push(`${slot.need} is from ${product.store}, which is banned`);
  }

  if (problems.length > 0) return { status: "broken", message: `${problems.join("; ")}.` };
  if (warnings.length > 0) return { status: "warning", message: `${warnings.join("; ")}.` };
  const parts: string[] = [];
  if (required.length > 0) parts.push(`${listText(required)} ${required.length === 1 ? "is" : "are"} on the plan`);
  if (bannedStores.length > 0) parts.push(`nothing from ${listText(bannedStores, "or")}`);
  if (bannedNeeds.length > 0) parts.push(`no ${listText(bannedNeeds, "or")}`);
  return { status: "ok", message: `${capitalize(parts.join(", "))}.` };
}

function resolveSlots(rule: Rule, context: Context): Slot[] {
  return rule.slotIds.map((id) => context.slotById.get(id)).filter((slot): slot is Slot => slot !== undefined);
}

function productFor(slot: Slot, context: Context): Product | null {
  return slot.chosenProductId ? context.productById.get(slot.chosenProductId) ?? null : null;
}

function missingSlots(rule: Rule): Verdict {
  return {
    status: "not_checked",
    message: rule.slotIds.length > 0 ? "The items this rule checked were removed from the plan." : "This rule isn't attached to any items.",
  };
}

function noProducts(slots: Slot[], what: string): Verdict {
  return { status: "not_checked", message: `Pick a product for ${needList(slots)} to check ${what}.` };
}

function isPerPerson(slot: Slot) {
  return slot.payType === "per_person" || slot.quantityRule === "per_person";
}

function arrivalDate(product: Product, now: Date): Date | null {
  const date = dateParam(product.attributes.deliveryDate);
  if (date) return date;
  const days = numberParam(product.attributes.deliveryDays);
  if (days === null) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function numberParam(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function dateParam(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59Z` : value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

function normalizeValue(value: unknown) {
  return String(value).trim().toLowerCase();
}

/** "Throw pillows" matches "throw pillow"; case and a trailing s don't matter. */
function sameNeed(a: string, b: string) {
  const clean = (text: string) => text.trim().toLowerCase().replace(/\s+/g, " ");
  const [x, y] = [clean(a), clean(b)];
  return x === y || `${x}s` === y || `${y}s` === x || `${x}es` === y || `${y}es` === x;
}

function needList(slots: Slot[]) {
  return listText(slots.map((slot) => slot.need));
}

function listText(items: string[], joiner = "and") {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${joiner} ${items[items.length - 1]}`;
}

function plural(count: number, one: string, many: string) {
  return count === 1 ? one : many;
}

function humanize(attribute: string) {
  return attribute
    .replace(/(?<=[a-z])In$/, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .toLowerCase();
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatDate(date: Date) {
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/** Rule messages only. Whole dollars drop the cents: $1,200 and $12.99. */
function formatCents(cents: number) {
  const whole = cents % 100 === 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);
}
