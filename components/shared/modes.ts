import type { FundingMode } from "@/components/shared/session";

/** The four ways a set gets paid for (PRD: "Who's paying?"). Shared by the landing page, chat, space, and set pages. */
export const MODE_INFO: Record<FundingMode, { label: string; short: string; blurb: string; promptLine: string }> = {
  solo: { label: "Just me", short: "Solo", blurb: "Plan it, buy it, done. One card, one checkout.", promptLine: "Just me paying." },
  group: { label: "With my group", short: "Group", blurb: "Roommates or friends shape it together and split it to the cent.", promptLine: "Split across the group." },
  parent: { label: "A parent is helping", short: "Family", blurb: "Mom covers part, you cover the rest. Everyone sees exactly what they fund.", promptLine: "A parent is helping pay." },
  insurance: { label: "Insurance claim", short: "Claim", blurb: "After a loss, your insurer funds the whole claim up front. The card only buys replacements on your claim.", promptLine: "Funded by an insurance claim; replace lost items like-for-like." },
};
