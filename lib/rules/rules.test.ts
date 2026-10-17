import { describe, it } from "vitest";
import { checkRules } from "@/lib/rules/check";

void checkRules;

describe("checkRules", () => {
  it.todo("marks a budget rule ok when the charged total is within maxCents");
  it.todo("marks a budget rule broken when the charged total is over maxCents");
  it.todo("marks a quantity rule from the slot quantity and the member count");
  it.todo("marks a compatibility rule broken when the named product attributes disagree");
  it.todo("returns not_checked for a size rule when product size attributes are missing");
  it.todo("returns not_checked for a timing rule when product date attributes are missing");
  it.todo("marks required_or_banned broken when a required need is missing");
  it.todo("marks required_or_banned broken when a chosen product is from a banned store");
});
