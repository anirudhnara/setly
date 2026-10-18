import { NextResponse } from "next/server";
import { demoStore } from "@/lib/stores/catalog";

/** The demo store's product feed. */
export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const store = demoStore(slug);
  if (!store) return NextResponse.json({ error: "Store not found" }, { status: 404 });
  return NextResponse.json({ name: store.name, slug: store.slug, products: store.items });
}
