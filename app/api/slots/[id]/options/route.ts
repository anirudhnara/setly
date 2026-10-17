import { NextResponse } from "next/server";
import type { SlotOptionsResponse } from "@/lib/contracts";
import { loadApartmentMap } from "@/lib/fixtures/sample";
import type { Product } from "@/lib/types";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  // TODO(Backend 2 (Maps)): return real alternative products from search. Prices come from search.
  const map = loadApartmentMap();
  const slot = map.slots.find((item) => item.id === id) ?? map.slots[0];
  const chosen = map.products.find((product) => product.id === slot.chosenProductId) ?? map.products[0];
  const products: Product[] = [
    chosen,
    {
      ...chosen,
      id: `${chosen.id}_alt_ikea`,
      title: `${chosen.title} alternate`,
      store: "IKEA",
      priceCents: Math.max(0, chosen.priceCents - 1500),
      url: `https://www.ikea.com/us/en/search/?q=${encodeURIComponent(slot.need)}`,
      imageUrl: "https://placehold.co/480x360?text=Alternate",
    },
    {
      ...chosen,
      id: `${chosen.id}_alt_target`,
      title: `${chosen.title} budget pick`,
      store: "Target",
      priceCents: Math.max(0, chosen.priceCents - 3000),
      url: `https://www.target.com/s?searchTerm=${encodeURIComponent(slot.need)}`,
      imageUrl: "https://placehold.co/480x360?text=Budget",
    },
  ];
  const body: SlotOptionsResponse = { products };
  return NextResponse.json(body);
}
