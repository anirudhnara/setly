# Setly

Setly turns a group purchase into one shared plan: roommates make a map of what they need, agree on the products and budget, split the cost, and check out within the plan.

> “Claude can tell you what to buy. Setly is how four people actually buy it.”

This repository is initialized for the DubHacks ’26 build. The full product scope, demo flow, data model, routes, team boundaries, and fallback decisions are in [the project plan](docs/DUBHACKS_PROJECT_PLAN.md).

## Start locally

Requirements: Node.js 20.9 or newer and npm.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). The UI prototype is fixture-backed: add needs to the shared web, keep a private inventory, share wants with the group, explore card-aware recommendations, join a group, preview roommate or funder sign-in, and simulate plan checkout. `/checkout` is also available directly. These actions run locally in the browser; authentication, live group state, product search, and payments are not connected yet. The shared demo map is in `lib/fixtures/living-room.ts`, and the common application contract is in `lib/types.ts`.

## Stack

- Next.js App Router, React, TypeScript, and Tailwind CSS
- Tiger Data (managed Postgres) for group state, ledger, and price history
- Gemini for structured map generation; SerpApi Google Shopping for product search
- Stripe test mode for contributions, card authorization, and refunds
- Vercel for hosting

## Project layout

```text
app/                 Routes, layouts, and global styles
components/          Shared UI components
lib/types.ts         Shared domain and API types
lib/fixtures/        Deterministic demo data for parallel UI work
lib/ai/              Map generation and pasted-list parsing (to add)
lib/search/          Product lookup and caching (to add)
lib/rules/           Deterministic rule checks (to add)
lib/money/           Split and refund math (to add)
lib/db/              Database schema and queries (to add)
lib/payments/        Stripe and mock issuer adapters (to add)
docs/                Product plan and implementation references
```

All monetary values in the domain model are integer cents. LLM output supplies structure and product IDs; code should own prices, rule checks, contribution math, and authorization decisions.

## Environment variables

Copy `.env.example` to `.env.local` and add credentials as integrations are implemented. Keep secrets server-side and out of `NEXT_PUBLIC_*` variables. The UI and fixture data can be developed before credentials are available.

## Scripts

- `npm run dev` — local development
- `npm run build` — production build
- `npm start` — serve a production build
- `npm run lint` — ESLint
