import Link from "next/link";
import { Check } from "lucide-react";
import type { GroupState } from "@/lib/types";

const STEPS = [
  { key: "set", label: "Set", path: "" },
  { key: "invite", label: "Invite", path: "/join" },
  { key: "split", label: "Split", path: "/split" },
  { key: "pay", label: "Pay", path: "/checkout" },
  { key: "returns", label: "Returns", path: "/settle" },
] as const;

export type GroupStep = (typeof STEPS)[number]["key"];

/** Which steps are finished, from the group's status and money. */
function done(state: GroupState, key: GroupStep) {
  const status = state.group.status;
  if (key === "set") return state.map.slots.length > 0;
  if (key === "invite") return state.members.length > 1;
  if (key === "split") return status !== "editing";
  if (key === "pay") return state.card !== null || status === "purchased" || status === "settled";
  return status === "settled" || state.refunds.length > 0;
}

export function GroupHeader({ state, step, title, lede }: { state: GroupState; step: GroupStep; title: string; lede: string }) {
  return (
    <header className="group-head">
      <nav className="steps" aria-label="Group progress">
        {STEPS.map((item, index) => {
          const finished = done(state, item.key);
          return (
            <Link key={item.key} href={`/g/${state.group.id}${item.path}`} className={`step${item.key === step ? " current" : ""}${finished ? " done" : ""}`} aria-current={item.key === step ? "step" : undefined}>
              <span className="step-dot" aria-hidden="true">{finished ? <Check /> : index + 1}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <span className="orbit-label">{state.group.name}</span>
      <h1>{title}</h1>
      <p className="group-lede">{lede}</p>
    </header>
  );
}

export function Avatar({ name, size = 34, tone = 0 }: { name: string; size?: number; tone?: number }) {
  return (
    <span className={`avatar-dot t${tone % 5}`} style={{ width: size, height: size, fontSize: size * 0.4 }} aria-hidden="true">
      {name.trim().slice(0, 1).toUpperCase() || "?"}
    </span>
  );
}
