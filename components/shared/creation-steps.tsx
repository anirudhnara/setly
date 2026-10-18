import { Check } from "lucide-react";

const STEPS = ["Tell us what you need", "Pick your vibe", "Your set"];

/** The three steps of making a new set, shown on the chat and the vibe space. */
export function CreationSteps({ current, tone = "light" }: { current: 0 | 1 | 2; tone?: "light" | "dark" }) {
  return (
    <ol className={`creation-steps ${tone}`} aria-label="Making your set">
      {STEPS.map((label, index) => (
        <li key={label} className={index < current ? "done" : index === current ? "current" : ""} aria-current={index === current ? "step" : undefined}>
          <span aria-hidden="true">{index < current ? <Check /> : index + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}
