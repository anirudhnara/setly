import type { CSSProperties } from "react";
import { createElement } from "react";
import { formatBudget } from "@/components/shared/format";
import { iconForNeed } from "@/components/shared/product-image";
import { groupName, type Brief } from "@/components/console/brief";

/** Items a set like this usually needs, shown as ghost leaves until the real set is grown. Display only. */
const LIKELY: Array<[RegExp, string[]]> = [
  [/camp|tent|hike|trail|backpack/i, ["Tent", "Sleeping bags", "Camp stove", "Lantern", "Cooler"]],
  [/kitchen|cook/i, ["Cookware set", "Knife set", "Dinnerware", "Coffee maker", "Storage"]],
  [/dorm|bed ?room/i, ["Bed frame", "Desk", "Desk lamp", "Storage bins", "Rug"]],
  [/office|desk|study|wfh/i, ["Desk", "Desk chair", "Monitor", "Desk lamp", "Shelf"]],
  [/party|birthday|wedding|event/i, ["Decorations", "Tableware", "Speaker", "Lights", "Cooler"]],
  [/trip|travel|beach|vacation/i, ["Luggage", "Beach towels", "Sunscreen", "Speaker", "Cooler"]],
  [/living|apartment|room|house|home/i, ["Sofa", "Rug", "Floor lamp", "Coffee table", "Throw pillows"]],
];

function list(text: string) {
  return text.split(/\s*,\s*/).map((item) => item.trim()).filter(Boolean);
}

export function LiveSetPreview({ brief, building }: { brief: Brief; building: boolean }) {
  const must = list(brief.mustHaves);
  const owned = list(brief.owned);
  const guessed = (LIKELY.find(([pattern]) => pattern.test(brief.scene))?.[1] ?? [])
    .filter((item) => ![...must, ...owned].some((known) => known.toLowerCase().includes(item.toLowerCase().split(" ")[0]) || item.toLowerCase().includes(known.toLowerCase())));
  const leaves = [
    ...must.map((label) => ({ label, kind: "must" as const })),
    ...owned.map((label) => ({ label, kind: "owned" as const })),
    ...guessed.slice(0, Math.max(0, 6 - must.length - owned.length)).map((label) => ({ label, kind: "likely" as const })),
  ];
  while (leaves.length < 4) leaves.push({ label: "", kind: "likely" });
  const facts = [brief.people ? `${brief.people} ${brief.people === 1 ? "person" : "people"}` : "", brief.budgetCents ? formatBudget(brief.budgetCents) : "", brief.vibe, brief.doorIn ? `${brief.doorIn}″ door` : "", brief.when && brief.when !== "no deadline" ? brief.when : ""].filter(Boolean);

  return (
    <div className={`live-set${building ? " building" : ""}`}>
      <div className="live-root">
        <strong>{brief.scene ? groupName(brief) : "Your set"}</strong>
        <div className="live-facts">
          {facts.length ? facts.map((fact) => <span key={fact}>{fact}</span>) : <span className="ghost">Tell me what it’s for</span>}
        </div>
      </div>
      <ul className="live-leaves">
        {leaves.map((leaf, index) => (
          <li key={`${leaf.kind}:${leaf.label || index}`} className={`live-leaf ${leaf.kind}${leaf.label ? "" : " empty"}`} style={{ "--i": index } as CSSProperties}>
            <span className="live-icon" aria-hidden="true">{leaf.label ? createElement(iconForNeed(leaf.label), { strokeWidth: 1.5 }) : null}</span>
            <span className="live-label">{leaf.label || " "}</span>
            <span className="live-tag">{leaf.kind === "must" ? "Must-have" : leaf.kind === "owned" ? "Owned" : leaf.label ? "Likely" : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
