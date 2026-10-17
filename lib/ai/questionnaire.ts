/**
 * Setup questionnaire answers (PRD 4.1) → the prompt string the generate route takes.
 * The contract only carries `prompt` and `budgetCents`, so the home screen should build the prompt with this
 * function: lib/ai/parse.ts reads budget, group size, door width, owned items, and must-haves back out of
 * exactly these phrases. Pure, with no server imports, so client components can use it.
 */
export interface QuestionnaireAnswers {
  /** "Living room", "Bedroom", "Apartment", "Trip", "Home office", or free text. */
  space: string;
  /** Number of people, including names when known. */
  people?: number;
  names?: string[];
  /** Integer cents. */
  budgetCents?: number;
  budgetIsPerPerson?: boolean;
  styles?: string[];
  roomSize?: string;
  doorWidthIn?: number;
  mustHaves?: string[];
  alreadyOwned?: string[];
  /** Free text the user typed or pasted. */
  notes?: string;
}

export function questionnairePrompt(answers: QuestionnaireAnswers): string {
  const parts: string[] = [answers.space.trim() || "A shared purchase"];
  if (answers.people && answers.people > 0) {
    const names = answers.names?.filter((name) => name.trim()).join(", ");
    parts.push(`for a group of ${answers.people}${names ? ` (${names})` : ""}`);
  }
  if (answers.budgetCents && answers.budgetCents > 0) {
    parts.push(`budget $${formatDollars(answers.budgetCents)} ${answers.budgetIsPerPerson ? "per person" : "total"}`);
  }
  if (answers.styles?.length) parts.push(`style: ${answers.styles.join(" and ")}`);
  if (answers.roomSize) parts.push(`room is ${answers.roomSize}`);
  if (answers.doorWidthIn) parts.push(`door is ${answers.doorWidthIn} inches`);
  let prompt = `${parts.join(", ")}.`;
  if (answers.alreadyOwned?.length) prompt += ` Already have: ${answers.alreadyOwned.join(", ")}.`;
  if (answers.mustHaves?.length) prompt += ` Must-haves: ${answers.mustHaves.join(", ")}.`;
  if (answers.notes?.trim()) prompt += ` ${answers.notes.trim()}`;
  return prompt;
}

/** "$1,500" or "$1,500.50". Integer cents in, display text out. */
function formatDollars(cents: number) {
  const dollars = Math.floor(cents / 100).toLocaleString("en-US");
  const rest = cents % 100;
  return rest === 0 ? dollars : `${dollars}.${String(rest).padStart(2, "0")}`;
}
