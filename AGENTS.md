<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# AGENTS.md: Setly

Instructions for every AI coding agent working in this repo (Claude Code, Codex, Cursor, Gemini CLI, Copilot). Read this whole file before making changes. If anything here conflicts with a request, stop and ask the human.

## What we're building

Setly is group checkout for shared purchases, built at DubHacks '26 (Visa title track). A group types a prompt ("living room for 4 roommates, cozy, under $1,200") or pastes a list. Setly generates a base **map**: zones (living room, kitchen) containing slots (sofa, rug, lamp), each slot filled with a real product from a real store, plus links between slots and rules the plan must meet. Members join by link (name only, no login) and edit the map together. Each slot is paid as shared, per person, or already owned. The group locks the map, each member pays their share in Stripe test mode, and when the plan is fully funded a virtual card is issued that only works at the plan's stores, up to each store's subtotal. Returning an item refunds each payer automatically.

Pitch line: "Claude can tell you what to buy. Setly is how four people actually buy it."

## Hackathon constraints

- Submission deadline: **Sunday 10:00 AM**. A working demo beats complete features. Build the demo path first.
- The repo is **public**. Never commit secrets.
- At least 70% of the code must be written during the event. Use libraries freely; do not paste large blocks of outside code.
- Checkpoints: prompt to map works by 6 PM, card and checkout work by 10 PM, full flow works by midnight, feature freeze at 3 AM.

## Stack

- Next.js App Router, TypeScript (strict), Tailwind, shadcn/ui
- Tiger Data (managed Postgres with TimescaleDB) through Drizzle ORM and postgres.js
- Gemini API (`@google/genai`), SerpApi Google Shopping
- Stripe test mode: PaymentIntents for contributions, Issuing for the card, Refunds
- SWR for data fetching, polling every 1 second for live updates
- Vitest for tests, deployed on Vercel

## Commands

```bash
npm run dev          # local dev server
npm run typecheck    # tsc --noEmit
npm test             # vitest run
npm run build        # production build
npm run db:generate  # generate Drizzle migrations from lib/db/schema.ts
npm run db:migrate   # apply migrations
npm run seed         # create the demo group and warm caches
```

**Before you finish any task, run `npm run typecheck` and `npm test` and fix every failure.** Run `npm run build` before anything is merged to main.

## Ownership: stay in your lane

Four people work in parallel. Each owns specific folders. **Only edit files in the folders of the person you're working for.** If you need a change somewhere else, stop and say what you need instead of making it.

| Owner | Folders |
| --- | --- |
| Backend 1 (Money) | `lib/types.ts`, `lib/contracts.ts`, `lib/db`, `lib/money`, `lib/payments`, `app/api/groups`, `app/api/slots` (except `[id]/options`), `app/api/pay`, `app/api/webhooks`, `app/api/issuing`, `app/api/checkout`, `app/api/returns` |
| Backend 2 (Maps) | `lib/ai`, `lib/search`, `lib/rules`, `app/api/maps`, `app/api/slots/[id]/options`, `fixtures`, `scripts` |
| Frontend 1 (Map) | `app/page.tsx`, `app/g/[groupId]/page.tsx`, `components/map`, `components/shared` |
| Frontend 2 (Group and money) | `app/g/[groupId]/join`, `app/g/[groupId]/split`, `app/g/[groupId]/checkout`, `app/g/[groupId]/settle`, `components/group`, `components/checkout` |

Shared, read by everyone, edited only by Backend 1 through a reviewed PR: `lib/types.ts`, `lib/contracts.ts`. `components/ui` is shadcn-generated; add components with the shadcn CLI, don't hand-edit them.

## The contract

- `lib/types.ts` defines every domain type. `lib/contracts.ts` defines request and response types plus zod schemas for every API route.
- Code against these types. **Never change them yourself.** If a type is missing or wrong, stop and describe the change you need.
- Every API route starts as a typed stub returning fixture data. Backends replace stubs with real logic without changing the response shape.

## Domain model

- **Group** status moves: `editing` → `funding` → `active` → `purchased` → `settled`.
- **Map** = zones → slots → products, plus links and rules.
- **Slot** has a `quantityRule` (`per_group`, `per_person`, `fixed`) and a `payType` (`shared`, `per_person`, `already_owned`).
- **Rule** types (exactly six): `budget`, `quantity`, `compatibility`, `size`, `timing`, `required_or_banned`. Status: `ok`, `warning`, `broken`, `not_checked`.

### Money rules (never break these)

- **All money is integer cents.** Never use floats for money. Format for display only at the edge, with one shared helper.
- **Shared slots** split evenly among all members. Leftover cents go one each to the first members by join order, so shares always sum to the exact total.
- **Per-person slots** charge each member for their own item. **Already-owned slots** cost nothing.
- **Refunds** for an item go to the people who paid for that item, in proportion to what each paid for it.
- The card is created only when paid contributions equal the plan total.
- **Card authorization:** approve a charge only if the merchant is a plan store and the amount fits within that store's remaining limit. Log every decision, approved or declined, with a human-readable reason ("Best Buy is not in this plan").
- Money and rule logic live in **pure functions** (`lib/money`, `lib/rules`) with no database, network, or Stripe calls inside, and they have tests.

### AI rules

- Gemini always returns **JSON validated against a zod schema**. On a validation failure, retry once, then fall back to the cached fixture.
- **The model never produces prices.** Prices, stores, and URLs come from search data. The model may only reference product IDs it was given; drop any unknown ID.
- Rules from Gemini must use the six rule types. Code evaluates them; the model never decides a rule's status.
- Cache every SerpApi search in `search_cache`. The free quota is small.

### Payments rules

- **Stripe test mode only.** Never use live keys.
- Verify webhook signatures with `STRIPE_WEBHOOK_SECRET`.
- The real-time authorization route (`app/api/issuing/authorize`) must answer within about 2 seconds: at most one database read and one write, no AI calls, no external fetches.
- Use idempotency keys on payment and refund creation.
- All card logic goes through the `Issuer` interface in `lib/payments/issuer.ts`. `ISSUER=mock` and `ISSUER=stripe` must behave identically from the caller's view.

## Mock switches

- `MOCK_AI=1`: map routes and search return fixtures. No Gemini or SerpApi calls.
- `ISSUER=mock`: the in-repo mock issuer replaces Stripe Issuing.

Frontend work should run with both mocks on. Never remove a mock path; it's the demo fallback.

## Code conventions

- TypeScript strict. No `any`; use `unknown` and narrow it.
- Server components by default. Add `'use client'` only for interactive components.
- Screens call the API **only** through `lib/client.ts` (`useGroup` and the typed fetch helpers). Never call Gemini, SerpApi, Stripe, or the database from a component.
- Every route handler validates input with the zod schema from `lib/contracts.ts` and returns `{ error: string }` with a proper status code on failure. Handlers run on the Node.js runtime, which is already the default. Do not add `export const runtime = 'nodejs'`: `cacheComponents` is enabled in `next.config.ts`, and Next.js 16 rejects that export.
- Tailwind for styling, shadcn/ui components first. Keep the visual style consistent with the existing mockup and `components/shared`.
- Accessible by default: labels on inputs, alt text on images, buttons are `<button>`, don't rely on color alone for rule status (use an icon and text).
- No new dependencies without explaining why in your summary.
- Keep diffs small and focused on the task. Don't reformat or rename files you weren't asked to touch.

## Secrets and environment

- Real values live in `.env.local` (gitignored) and Vercel. Only `.env.example` is committed.
- Variables: `GEMINI_API_KEY`, `SERPAPI_KEY`, `DATABASE_URL`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`, `ISSUER`, `MOCK_AI`.
- Never print, log, or hard-code a key. Read env only through `lib/env.ts`.

## Database

- Schema lives in `lib/db/schema.ts`. Change it only if you're working for Backend 1, then run `npm run db:generate`. Never hand-edit generated migration files.
- `price_points` is a TimescaleDB hypertable (see `db/sql/price_points_hypertable.sql`).

## Git

- Never commit to `main` directly. Branches: `be1/...`, `be2/...`, `fe1/...`, `fe2/...`.
- Small commits after every working step. Small PRs, squash-merged.
- Don't commit `.env.local`, build output, or large generated files.

## Out of scope (do not build)

Live voting, user accounts or login, room photos, resale, creator sets, campus profiles, substitution rules, real-money payments, extra databases or real-time services. If a task seems to need one of these, stop and ask.

## When you're unsure

Stop and ask rather than guess. Especially: changing shared types, adding a dependency, touching another owner's folder, or anything involving money logic.

## Finishing a task

End every task with:

1. `npm run typecheck` and `npm test` passing.
2. A short summary: what you changed, which files, anything left undone, and any contract change you need from Backend 1.
