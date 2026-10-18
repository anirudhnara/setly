import { Suspense } from "react";
import { Landing } from "@/components/landing/landing";
import { SiteNav } from "@/components/shared/site-nav";
import { loadCatalog } from "@/lib/catalog/source";
import "@/components/landing/landing.css";

const HERO_CATEGORIES = ["Sofa", "Floor lamp", "Rug", "Armchair", "Coffee table", "Throw blanket", "Plants", "Desk lamp", "Bookshelf"];

/** One mid-priced, well-rated product per hero category for the orbit: real items, not the bargain-bin extremes. */
async function showcase() {
  const catalog = await loadCatalog();
  return HERO_CATEGORIES.flatMap((category) => {
    const options = catalog.filter((item) => item.category === category && (item.rating === null || item.rating >= 4)).sort((a, b) => a.priceCents - b.priceCents);
    const middle = options[Math.floor(options.length / 2)];
    return middle ? [middle] : [];
  });
}

export default async function LandingPage() {
  const items = await showcase();
  return (
    <div className="orbit landing-shell">
      <Suspense fallback={<header className="setly-nav" aria-hidden="true" />}>
        <SiteNav />
      </Suspense>
      <Landing showcase={items} />
    </div>
  );
}
