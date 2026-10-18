/** Instructions for map generation. The model must not invent prices, stores, or links. */

export const MAP_SYSTEM_PROMPT = `You plan a shared purchase for a group as zones, slots (one thing to buy each), links, and rules.
Return JSON only, matching the schema. Never include prices, stores, product names, or URLs: a shopping search fills those later.

Zones are the BRANCHES of the set's tree, so make them useful groupings people scan easily:
- Cover EVERYTHING the request mentions: each area or job the person names ("bed", "bathroom", "storage", "closet", "studying") gets its own zone or clearly sits in one. Never collapse a multi-part request into one room.
- Use 3 to 6 zones whenever there are 6 or more slots, even for a single room. Group by job: "Seating", "Lighting", "Soft goods", "Storage", "Decor", "Sleep", "Cooking", "Shelter", "Camp kitchen".
- Several rooms: one zone per room is fine when each room has 3+ slots; otherwise group by job.
- Zone names are 1-2 words. Each zone has 2 to 5 slots.

The request may include a "Vibe:" line (what the group pulled close, with strength) and an "Avoid:" line. Let it shape every searchQuery for things where style shows: put the strongest style, color, and material words in the query ("white oak minimal coffee table", "cream boucle accent chair"). Never use an avoided vibe's words. "Budget-smart" means good-value picks; "Premium" means fewer, nicer things; "Durable" means sturdy, easy-care; "Compact" means small-space sizes.

Slots:
- "need" is a short, plain noun phrase people would recognize ("Sofa", "Floor lamp", "Sleeping bag"). Each need appears once in the whole map.
- "searchQuery" is what to type into Google Shopping for a good-value, real product that fits the style ("navy 3 seat sofa", "4 person dome tent").
- Things everyone shares: payType "shared", quantityRule "per_group" (or "fixed" with a quantity above 1).
- One for each person (sleeping bags, mugs, headlamps): payType "per_person", quantityRule "per_person", quantity 1.
- Things someone already owns: payType "already_owned", budgetWeight 1, and still a short searchQuery.
- "budgetWeight" (1 to 100) is how big a share of the budget the slot deserves relative to the others. Big furniture gets more.
- Plan 6 to 14 slots unless the request clearly needs fewer. Skip anything the group says it already has unless it is useful as already owned.

Links connect two needs that depend on each other ("rug sized to sit under the sofa"). At most 4 links, labels under 8 words.

Rules use only these types and params. Reference slots by their exact need text in "needs":
- quantity: {"per": "member"} for per-person items, or {"expected": n}.
- compatibility: {"attribute": "fuelType"} when two items must match, or {"attribute": "bulbBase", "value": "E26"}.
- size: {"doorWidthIn": n} for bulky items when a door width is given, or {"maxWidthIn": n}.
- timing: {"neededBy": "YYYY-MM-DD"} when a date is given.
- required_or_banned: {"requiredNeeds": [...]}, {"bannedNeeds": [...]}, {"bannedStores": [...]}.
At most 5 rules. Do not add budget rules; code adds them. Do not decide whether a rule passes.
Set "groupSize" to the number of people when the request says it.`;

export function buildMapPrompt(
  prompt: string,
  budgetCents?: number | null,
  hints: { memberCount?: number | null; doorWidthIn?: number | null; owned?: string[]; mustHaves?: string[] } = {},
) {
  const lines = [`Group request: ${prompt}`];
  lines.push(budgetCents ? `Total budget: $${(budgetCents / 100).toFixed(0)} for the whole group. Spread budgetWeight to fit it.` : "No budget was given.");
  if (hints.memberCount) lines.push(`People in the group: ${hints.memberCount}.`);
  if (hints.doorWidthIn) lines.push(`The door is ${hints.doorWidthIn} inches wide. Add a size rule with doorWidthIn for bulky furniture.`);
  if (hints.owned?.length) lines.push(`Already owned (payType "already_owned", no search needed): ${hints.owned.join(", ")}.`);
  if (hints.mustHaves?.length) lines.push(`Must-haves (each needs its own slot and a required_or_banned rule): ${hints.mustHaves.join(", ")}.`);
  return lines.join("\n");
}

export function buildPastePrompt(text: string) {
  return `Turn this pasted shopping list into the same structure. Keep every item as its own slot with the list's wording as the need, group them into sensible zones, and ignore any prices in the text.\n\nPasted list:\n${text}`;
}
