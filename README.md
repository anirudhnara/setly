# Setly

Setly is group checkout for a shared purchase. A group describes what they need, gets a map of real products, splits the cost, and pays with a virtual card that only works at the plan's stores.

## Run

```bash
cp .env.example .env.local
npm install
npm run dev
```

Open http://localhost:3000.

`MOCK_AI=1` returns sample maps and search results, so Gemini and SerpApi keys can stay empty. `ISSUER=mock` approves or declines card charges in memory. Set `ISSUER=stripe` only when Stripe test keys are present. Money is integer cents.

## Ownership

| Owner | Folders |
| --- | --- |
| Backend 1 (Money) | `lib/types.ts`, `lib/contracts.ts`, `lib/db`, `lib/money`, `lib/payments`, `app/api/groups`, `app/api/slots` (except `[id]/options`), `app/api/pay`, `app/api/webhooks`, `app/api/issuing`, `app/api/checkout`, `app/api/returns` |
| Backend 2 (Maps) | `lib/ai`, `lib/search`, `lib/rules`, `app/api/maps`, `app/api/slots/[id]/options`, `fixtures`, `scripts` |
| Frontend 1 (Map) | `app/page.tsx`, `app/g/[groupId]/page.tsx`, `components/map`, `components/shared` |
| Frontend 2 (Group and money) | `app/g/[groupId]/join`, `split`, `checkout`, `settle`, `components/group`, `components/checkout` |

The product plan is in [docs/DUBHACKS_PROJECT_PLAN.md](docs/DUBHACKS_PROJECT_PLAN.md). Agent rules are in [AGENTS.md](AGENTS.md).
