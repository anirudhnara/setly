# Setly: product requirements

**Event:** DubHacks 2026, Visa track ("Reimagine Shopping"). Sponsored side tracks: SideShift and VEYZL. VEYZL is owned by another teammate and is not built in this repo.
**Submission:** Sunday, Oct 18, 10:30 AM
**Team:** Backend 1 (Money), Backend 2 (Maps), Frontend 1 (Map), Frontend 2 (Group and money)
**Read with:** `AGENTS.md` (rules every coding agent follows), `lib/types.ts` and `lib/contracts.ts` (the shared contract)

---

## 1. Summary

Setly turns a shared purchase into a **map** you build by hand and a **card** that can only buy that map.

You answer a short questionnaire. Setly lays out a map of real products from real stores. You grab products, shuffle through options, and snap them into place, like Tony Stark arranging holograms. When the map is right, each funder pays their part: roommates split it, a parent covers a share, or an insurer funds a family's rebuild after a fire. Setly issues one virtual card per map. It can only spend at the map's stores, up to the map's amounts. Checkout runs across every store, and returns split back to whoever paid.

**One line:** Claude can tell you what to buy. Setly is how the people paying for it actually buy it.

---

## 2. Problem

When more than one person pays for a purchase, one of them usually fronts the money, orders from several stores, handles swaps and returns, and chases everyone else for weeks.

| Tool today | What it does | What it can't do |
|---|---|---|
| Claude, ChatGPT, Gemini | Decide what to buy | Hold money, issue a card, decline a charge |
| Cash App Pools, PayPal Money Pools | Collect money before buying | Control what the money buys. The organizer can spend it on anything |
| Splitwise, Venmo requests | Settle up | Only after someone already paid |
| Privacy.com, kids' debit cards | Lock a card to a store or limit | Several funders, a shared plan, refund splitting |
| Insurance claim cards (Pliant), replacement lists (Edjuster) | Restrict a claim payout, or list replacements | Tie the card to each claim line |

**Insurance version:** on replacement-cost policies, insurers usually pay the depreciated value first and the rest only after the family buys replacements and sends receipts. Many families can't front that money, so they never collect it all.

---

## 3. Funders (one engine, three modes)

| Mode | Who funds | Who shops | What changes |
|---|---|---|---|
| **Group** | Each member pays their share | The group | Shares split per item. Card activates when everyone has paid |
| **Parent** | A parent covers all or part of a member's share | The member | Parent answers a short questionnaire, sees exactly what their money buys, adds a note |
| **Insurer** | Insurer funds the full claim | The policyholder | Map starts from claim lines. Every charge must fit a claim line |

The map, card, checkout, and returns work the same in every mode.

---

## 4. Experience pillars

### 4.1 Questionnaires (how every map starts)

No blank prompt box. Each mode starts with a few quick questions, mostly taps.

**Setup questionnaire (everyone):**
1. What are you setting up? (Living room, bedroom, apartment, trip, home office, other)
2. Who's paying? (Just me, a group, a parent is helping, insurance claim)
3. How many people? Add names.
4. Budget (slider), and whether it's per person or total.
5. Style: tap 2 or 3 image tiles (cozy, minimal, warm wood, navy, bright).
6. Space: room size and door width (optional, used by the rule checker).
7. Must-haves and already-owned items (chips, so the map skips them).
8. Or paste a list from anywhere (a Claude answer, a registry, a spreadsheet).

**Parent questionnaire (from the cover link):**
1. How much do you want to cover? (All of their share, a fixed amount, specific items)
2. Anything you won't pay for? (Categories to exclude)
3. A note to them.

**Insurer questionnaire (claim intake):**
1. Claim number and policyholder.
2. Claim lines: item, category, replacement value (prefilled from the demo claim).
3. Rooms affected.

Answers become the map request. Questionnaire answers are stored on the group so anyone can see why the map looks the way it does.

### 4.2 The map (the Tony Stark part)

The map is the centerpiece. It should feel physical and fast.

- **Layout:** the group in the center, slots around it (Sofa, Rug, Lamp, Bookshelf...), each slot holding one product card with image, price, store, and owner avatar.
- **Grab and move:** drag a product card off its slot to remove it, drop it on another slot of the same type to swap, drag it to a member's avatar to make it theirs, drag it to the center to make it shared.
- **Shuffle options:** each slot has a stack of options behind the current product. Flick or arrow through them like a deck. The price chip and running total update as you shuffle. Tap to snap one into place.
- **Lock:** pin a slot so regeneration doesn't touch it.
- **Rules light up:** a rule bar shows every rule's status (under budget, fits the room, fits through the door, no duplicates, every slot has an owner). Rules change color live as products move.
- **Edited by:** each slot shows who last changed it.
- **Motion:** spring physics on drag and snap, cards tilt slightly while held, smooth reflow when slots are added or removed. No voice.

### 4.3 Split and pay (payment information section)

- **Split view:** every slot listed with shared or owner, and each person's share. Custom percentages for shared slots.
- **Payment information section:** for each member, their share, who is paying it (themselves, a parent, both), payment status (not started, held, charged, refunded), and the card used (last four digits from Stripe test mode).
- **Pay:** each funder pays through Stripe Checkout in test mode. The payment is **held, not charged**.
- **Pool bar:** live progress of committed money, with avatars filling in as people pay. QR code for joining and paying.
- **Rule:** nobody is charged until the map is fully funded. If the deadline passes, every hold is released.

### 4.4 Card wallet (cards you shuffle through)

- When funding completes, all holds are charged at once and a virtual card is issued for the map.
- The wallet shows cards as a stack you can shuffle through: one card per map (for example, "Living room" funded by the group, "Jordan's desk" covered by Mom, "Fire claim #4471" funded by the insurer).
- **Front of each card:** name, last four digits, funding progress by funder, limit, amount spent.
- **Flip a card:** its rules (allowed stores and cap per store, total, expiry, claim lines for insurer cards).
- Cards that aren't fully funded show as "funding" with the pool bar on the front.

### 4.5 Checkout

- **Checkout page:** products grouped by store, subtotal per store, the card being used, and a "Run checkout" button.
- **Checkout run:** each store charges the card in turn (simulated). A live log shows each decision: approved with "Matches plan: IKEA," or declined with a reason ("Wayfair fee isn't in the plan," "GiftCardz isn't in this plan").
- Demo buttons to trigger an off-plan fee and an unknown store.

### 4.6 Returns and settle-up

- Return any item from the checkout log.
- The refund lands back on the card, then splits automatically: shared items to every payer, owned items to their owner, and a parent's covered portion back to the parent.
- Settle-up screen: what each person paid, what came back, final totals. Every number comes from the ledger.

### 4.7 Insurer view

- Claim lines with funded, spent, and remaining per line.
- Every approved charge matched to a claim line.
- Comparison banner: "Today: $4,100 now, $4,300 after receipts. With Setly: $8,400 now, spending locked to replacements."

---

## 5. Priorities

### P0: the demo doesn't work without these
- Setup questionnaire → map of real products.
- Map with drag, swap, shuffle options, assign shared or owner, lock.
- Rule bar with live status.
- Split view and payment information section.
- Pay with held payments, pool bar, capture when fully funded.
- One card issued per map (Stripe Issuing test mode, or mock issuer).
- Checkout page and checkout run with approve and decline reasons.
- Returns with automatic refund split.
- Every number on screen read from the ledger.

### P1: makes it convincing
- Card wallet with shuffle and flip.
- Parent questionnaire and cover link.
- Join by QR and live updates during the demo.
- "Edited by" badges.
- Paste-a-list.
- Tiger Data features: vector search for slot options, ledger as a TimescaleDB hypertable with a live spending chart.

### P2: only if ahead
- Insurer questionnaire, claim-line rules, and insurer view.
- Custom split percentages.
- Spring physics polish beyond the basics.

### Cut
Voice input, room photo uploads, AI room renders, creator sets, resale, item-level enforcement at the card network, real merchant checkout, accounts and login.

---

## 6. Screens, routes, and owners

| Screen | Frontend route | API routes | Frontend owner | Backend owner |
|---|---|---|---|---|
| Home and setup questionnaire | `app/page.tsx` | `app/api/groups`, `app/api/maps` | Frontend 1 | Backend 1, Backend 2 |
| Map | `app/g/[groupId]/page.tsx` | `app/api/maps`, `app/api/slots`, `app/api/slots/[id]/options` | Frontend 1 | Backend 2 (map, options, rules), Backend 1 (slots) |
| Join and QR | `app/g/[groupId]/join` | `app/api/groups` | Frontend 2 | Backend 1 |
| Split and payment information | `app/g/[groupId]/split` | `app/api/groups`, `app/api/pay` | Frontend 2 | Backend 1 |
| Parent questionnaire and cover | `app/g/[groupId]/split` (cover link) | `app/api/pay` | Frontend 2 | Backend 1 |
| Card wallet | `app/g/[groupId]/checkout` | `app/api/issuing` | Frontend 2 | Backend 1 |
| Checkout | `app/g/[groupId]/checkout` | `app/api/checkout`, `app/api/webhooks` | Frontend 2 | Backend 1 |
| Returns and settle-up | `app/g/[groupId]/settle` | `app/api/returns` | Frontend 2 | Backend 1 |
| Insurer intake and view (P2) | `app/g/[groupId]/split` (insurer mode) | `app/api/groups`, `app/api/maps`, `app/api/issuing` | Frontend 2 | Backend 1, Backend 2 |

If a screen or route doesn't fit this table, the owner proposes it in the team chat before building it.

---

## 7. Shared vocabulary

Use these names in code, UI, and conversation.

| Term | Meaning |
|---|---|
| **Group** | Everyone involved in one purchase, plus its mode (group, parent, insurer) and questionnaire answers |
| **Member** | A person in the group. Has a share |
| **Funder** | Whoever pays a share: the member, a parent, or an insurer |
| **Map** | The arrangement of slots for a group |
| **Slot** | One position in the map (Sofa, Rug). Holds one product, an owner or "shared," and a lock |
| **Option** | An alternative product for a slot, shown in the shuffle stack |
| **Rule** | A check on the map (budget, room fit, door fit, ownership). Always has a status: pass, warn, or fail |
| **Hold** | A share that's authorized but not charged |
| **Card** | The virtual card issued for a fully funded map |
| **Allotment** | The cap per store on a card |
| **Claim line** | An insurer-approved item and its replacement value |
| **Ledger** | Every hold, charge, decision, refund, and payout. The source of every number on screen |

---

## 8. Demo script (3 minutes, no voice)

| Time | Beat |
|---|---|
| 0:00 | "Who here has paid for something for a group, then chased people for weeks?" |
| 0:15 | Tap through the questionnaire: living room, group of 3, $1,500, cozy and navy, door is 32 inches. |
| 0:30 | The map assembles. Shuffle the rug options, snap a cheaper one in. Drag the lamp onto Sam's avatar. A sofa that won't fit the door turns its rule red; swap it, rule turns green. |
| 1:05 | Split view: each person's share. Jordan sends a cover link; Mom answers two questions and covers it. |
| 1:20 | QR on screen. Judges pay as roommates. The pool bar fills. The card appears in the wallet. |
| 1:50 | Checkout runs across three stores: approved, approved, approved. A surprise fee: declined, with the reason. |
| 2:10 | Return the rug. Refund splits to each payer, including Mom. |
| 2:25 | Shuffle the wallet to the insurer card: "Same engine, different funder. After a fire, the insurer funds the full claim on day one, and every dollar matches a claim line." |
| 2:50 | "Claude can tell you what to buy. Setly is how the people paying for it actually buy it." |

A recorded backup of this exact flow must exist by Sunday 8 AM.

---

## 9. Done means (per owner)

| Owner | Done means |
|---|---|
| Backend 1: Money | Every number on screen comes from the ledger, and money moves correctly in test mode |
| Backend 2: Maps | A questionnaire returns a valid map of real products in under 15 seconds, and every rule has a status |
| Frontend 1: Map | The map looks like the mockup, and grabbing, shuffling, and snapping feel instant |
| Frontend 2: Group and money | Every money moment is clear on screen (split, pay, pool, card, checkout, settle), and submissions are done |

**Project is ready when:**
- The full demo runs end to end twice in a row without manual fixes.
- With `MOCK_AI=1` and `ISSUER=mock`, the whole flow still works.
- Shares and refunds always add up to the exact total.
- Every decline shows a readable reason.
- Devpost, backup video, and side track forms are submitted.

---

## 10. Technical overview

- **App:** Next.js (app router), API routes under `app/api`, deployed on Vercel.
- **Database:** PostgreSQL on Tiger Cloud (Tiger Data). pgvector for slot options. Ledger as a TimescaleDB hypertable.
- **AI:** Gemini turns questionnaire answers into a map, returning only real product IDs. Every result is checked by the rule checker. `MOCK_AI=1` returns fixtures.
- **Products:** SerpApi search with caching, plus fixture products for demo maps.
- **Payments:** Stripe test mode. Checkout with held payments for shares, Stripe Issuing for the card, a real-time authorization webhook for approve and decline. `ISSUER=mock` swaps in a fake card with identical rules.
- **Contract:** `lib/types.ts` and `lib/contracts.ts` are the only shared files. Only Backend 1 edits them, through a PR, announced in chat.
- **Agents:** all tools follow `AGENTS.md`. Every route starts as a typed stub returning fixture data.

---

## 11. Timeline

| Time | Milestone |
|---|---|
| 1:30 PM | Scaffold merged: contract, stub routes with fixtures, `AGENTS.md`, mock switches. Everyone starts. |
| Every 60 to 90 min | Merge to main. Everyone pulls. |
| 6:00 PM | Full flow together, on stubs and mocks where needed. |
| 10:00 PM | Full flow on real logic in mock issuer mode. **If not, cut all P1 and P2.** |
| Midnight | Full flow with Stripe test mode. |
| 3:00 AM | Feature freeze. Fixes only. |
| 6:00 AM | Backup video, Devpost, side track forms, pitch rehearsal. |
| 10:00 AM | Submit (deadline 10:30). |

---

## 12. Risks

| Risk | Plan |
|---|---|
| Stripe Issuing can't be enabled | `ISSUER=mock`. Say so in the pitch |
| Gemini or SerpApi slow or failing | `MOCK_AI=1` fixtures, cached search, rule checker on every result |
| Map interactions feel laggy | Optimistic updates on the client, server sync after. Never wait on the network to move a card |
| Contract drift between teams | Only Backend 1 edits the contract, by PR, announced in chat |
| Two agents in one folder | One agent per working copy. Separate worktrees for parallel agents |
| Scope creep | Cut P1 and P2 at 10 PM if the core flow isn't working |
| Pitch blurs group and insurer | Group is the story. Insurer is one card in the wallet, 25 seconds |

---

## 13. Questions judges will ask

| Question | Answer |
|---|---|
| Why not just ask Claude? | Claude can make the list. It can't collect money from several people, issue a card, or decline a charge |
| Isn't this Cash App Pools? | Pools give one person a balance to spend on anything. Setly ties the money to the map |
| Cards don't see items | Correct. The card enforces store, amount per store, total, and expiry. Item-level control needs merchant line-item data or agent protocols like Google's AP2. We don't claim it |
| What if someone never pays? | The card never activates and every hold is released |
| How do you make money? | Interchange on card spend for groups (thin). The bigger opportunity is organizations that fund a purpose, starting with insurers |
| Why would insurers want this? | Faster claims and no receipt checking. Some won't, because unclaimed depreciation saves them money. That's the first thing we'd test |
| What's real and what's mocked? | Holds, the card, and approve or decline run on Stripe test mode. Store checkouts are simulated. The rules are real code |

---

## 14. Open questions

- Does the Tiger Data prize count as our one track or as a separate sponsor prize?
- Is Visa offering sandbox access to its developer tools at the event?
- Does the full Visa track description add requirements this PRD doesn't cover?
- After the hackathon: can an insurer pay the full replacement amount up front if spending is restricted to replacements?
