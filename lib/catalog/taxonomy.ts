/**
 * Shared vocabulary for the 3D space: categories (what the item is), the room they live in, and themes (how it feels).
 * Pure, so the browser and the server tag items the same way.
 */
export const CATEGORIES: Array<{ label: string; room: string; match: RegExp }> = [
  { label: "Sofa", room: "Living room", match: /sofa|couch|loveseat|sectional|seater|comfy seating/i },
  { label: "Armchair", room: "Living room", match: /armchair|accent chair/i },
  { label: "Coffee table", room: "Living room", match: /coffee table/i },
  { label: "Side table", room: "Living room", match: /side table|end table/i },
  { label: "Rug", room: "Living room", match: /\brug\b|area rug/i },
  { label: "Throw pillows", room: "Living room", match: /pillow/i },
  { label: "Throw blanket", room: "Living room", match: /blanket|throw\b/i },
  { label: "Floor lamp", room: "Living room", match: /floor lamp|lighting/i },
  { label: "Bookshelf", room: "Living room", match: /bookshelf|bookcase/i },
  { label: "Wall art", room: "Living room", match: /wall art/i },
  { label: "Plants", room: "Living room", match: /plant/i },
  { label: "Ottoman", room: "Living room", match: /ottoman/i },
  { label: "Curtains", room: "Bedroom", match: /curtain/i },
  { label: "Bed frame", room: "Bedroom", match: /bed frame/i },
  { label: "Mattress", room: "Bedroom", match: /mattress/i },
  { label: "Desk lamp", room: "Office", match: /desk lamp/i },
  { label: "Desk chair", room: "Office", match: /desk chair/i },
  { label: "Waste bin", room: "Office", match: /waste bin|trash/i },
  { label: "Mini fridge", room: "Kitchen", match: /fridge/i },
  { label: "Microwave", room: "Kitchen", match: /microwave/i },
  { label: "Camp table", room: "Outdoors", match: /camp table/i },
  { label: "Camp utensils", room: "Outdoors", match: /utensil/i },
];

export const THEMES: Array<{ label: string; color: string; match: RegExp }> = [
  { label: "Cozy", color: "#ff8a5c", match: /cozy|plush|knit|sherpa|fleece|soft|warm|comfy|boucl|velvet|chenille/i },
  { label: "Minimal", color: "#7cc6ff", match: /minimal|modern|simple|sleek|white|clean|scandinavian/i },
  { label: "Natural", color: "#7ed6a5", match: /oak|wood|bamboo|rattan|jute|linen|cotton|walnut|plant/i },
  { label: "Compact", color: "#ffd166", match: /small|compact|mini|narrow|dorm|space[- ]saving|folding/i },
  { label: "Outdoorsy", color: "#b39dff", match: /camp|outdoor|hiking|portable|trail/i },
];

export function categorize(text: string) {
  return CATEGORIES.find((category) => category.match.test(text)) ?? null;
}

export function themesFor(text: string) {
  return THEMES.filter((theme) => theme.match.test(text)).map((theme) => theme.label);
}
