"use client";

import { createElement, useState } from "react";
import {
  Armchair, Backpack, Bath, Bed, BookOpen, Coffee, CookingPot, Flame, Flashlight, Lamp, LampFloor, Laptop, Microwave, Monitor,
  Package, Refrigerator, Shirt, Sofa, Speaker, Sprout, Tent, Tv, Utensils, Wind, type LucideIcon,
} from "lucide-react";
import type { Product } from "@/lib/types";

const ICONS: Array<[RegExp, LucideIcon]> = [
  [/sofa|couch|loveseat|sectional/i, Sofa],
  [/chair|stool|ottoman|bench|seat/i, Armchair],
  [/headlamp|flashlight|torch/i, Flashlight],
  [/floor lamp/i, LampFloor],
  [/lamp|light|lantern|bulb/i, Lamp],
  [/bed|mattress|pillow|duvet|sheet|blanket|throw|sleeping/i, Bed],
  [/tent|tarp|canopy/i, Tent],
  [/stove|grill|fuel|fire/i, Flame],
  [/pan|pot|cookware|kettle/i, CookingPot],
  [/coffee(?! table)|mug|cup/i, Coffee],
  [/microwave|oven|toaster/i, Microwave],
  [/fridge|refrigerator|cooler/i, Refrigerator],
  [/fork|plate|dish|utensil|knife|dinner|bowl|cutlery/i, Utensils],
  [/tv|television/i, Tv],
  [/monitor|screen/i, Monitor],
  [/laptop|computer|desk/i, Laptop],
  [/speaker|audio|sound/i, Speaker],
  [/book|shelf|bookcase/i, BookOpen],
  [/plant|planter|pot\b/i, Sprout],
  [/fan|purifier|heater/i, Wind],
  [/towel|bath|shower/i, Bath],
  [/backpack|bag|pack/i, Backpack],
  [/shirt|hoodie|jacket|apparel/i, Shirt],
];

export function iconForNeed(need: string): LucideIcon {
  return ICONS.find(([pattern]) => pattern.test(need))?.[1] ?? Package;
}

/** Real product photos sit on a white tile (multiply blends their white backgrounds). Placeholders get an icon instead. */
export function ProductImage({ product, need, className = "" }: { product: Product | null; need: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  const url = product?.imageUrl ?? "";
  const usable = /^https?:\/\//.test(url) && !/placehold\.co|placeholder|via\.placeholder/i.test(url) && !broken;
  const icon = iconForNeed(`${need} ${product?.title ?? ""}`);
  return (
    <span className={`product-image ${usable ? "has-photo" : "is-icon"} ${className}`}>
      {usable ? (
        // Remote store thumbnails come from many hosts, so a plain img avoids an image-domain allowlist.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={product?.title ?? need} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        createElement(icon, { "aria-hidden": true, strokeWidth: 1.4 })
      )}
    </span>
  );
}
