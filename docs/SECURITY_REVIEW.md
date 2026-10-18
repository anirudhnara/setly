# Security hardening — October 18, 2026

This is a source-code hardening pass, not a penetration test or a guarantee of complete security. Changes are local and have not been deployed.

## Changes

- `app/api/groups/[id]/route.ts` now requires group membership before returning the map, members, contributions, card, or refunds. `components/group/join-view.tsx` lets invitees join before accessing those details. Possession of a group invitation link still permits joining an editing group, as designed.
- `app/api/issuing/authorize/route.ts` verifies a Stripe signature over the raw body before performing any authorization. Missing, stale, invalid, and tampered signatures are rejected. No Firebase verification or external fetch was added to this route.
- `app/api/demo/reset/route.ts` is disabled in production. Local resets require both `DEMO_RESET=1` and a server-only `DEMO_RESET_TOKEN` of at least 32 characters, supplied as a Bearer token. `.env.example` documents this setting. Do not expose this token in browser code.
- `lib/security/request.ts` limits actual streamed request bodies to 256 KiB, including bodies without a Content-Length header. All API routes that previously imported the contract's JSON reader now use this bounded reader; signed webhooks and demo reset use its raw-text reader. Public schemas and response types are unchanged.
- `lib/auth/admin.ts` checks Firebase token revocation and disabled users. `lib/auth/verify-token.ts` prevents installing a test verifier outside tests.
- `lib/auth/redirect.ts` and the sign-in form constrain post-login navigation to internal paths, including rejecting backslash and control-character bypasses.
- `lib/security/rate-limit.ts` and `lib/auth/session.ts` limit authenticated AI/search requests to 20 per minute per Firebase identity per server process. Group polling does not count toward this limit. Limiter storage is bounded.
- `lib/env.ts` rejects non-test Stripe secret keys; the payment webhook rejects live-mode events.
- `lib/payments/decide.ts` rejects invalid cent amounts and requires exact merchant names, ignoring case and surrounding whitespace. Substring matches such as “FakeIKEA” cannot authorize a charge. Unrecognized merchant descriptors fail closed.
- `next.config.ts` adds HTTPS transport policy in production, clickjacking and MIME-sniffing protection, a baseline CSP, referrer and feature restrictions, and private/no-store caching for API responses. It disables the framework identification header. The opener policy allows Firebase Google sign-in popups.
- `lib/db/http.ts` returns generic unexpected-error responses. API, AI, search, and issuer fallback logs no longer print raw provider/database error details or shopping queries that could contain sensitive information.
- `package.json` and `package-lock.json` upgrade Firebase Admin to 14.5 and Vitest to 4.1, enforce patched gRPC 1.14, and move the shadcn generator into development dependencies. No new direct dependencies were added. Use the repository's Node 24 runtime.

## Verification

- Type checking, the test suite, and the production build pass under Node 24.
- Regression tests exercise unauthorized group reads, signature rejection and acceptance, streamed body limits, login redirects, local/production reset protections, invalid merchant names and amounts, live-key rejection, generic errors, and AI throttling.
- A local production-server HTTP check confirms the headers, no-store API caching, missing framework header, authentication failures, hidden reset endpoint, and rejection of unsigned authorizations.
- `npm audit --omit=dev`: zero known findings at verification time.
- Full `npm audit`: 13 development-tool findings, comprising 9 high and 4 moderate; zero critical. These trace to braces through globbing tools and an old esbuild through Drizzle's loader. The registry currently offers no patched braces release. Forced downgrades or incompatible transitive overrides were not applied. Keep development servers private. Advisory references: [braces](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [esbuild](https://github.com/advisories/GHSA-67mh-4wv8-2f99).
- The Postgres integration test remains skipped unless its test database is configured. Firebase credentials, real token revocation, hosted Google sign-in, and Stripe delivery have not been exercised against external accounts.

## Remaining requirements and limits

- Configure Firebase service-account credentials (or Application Default Credentials) before deployment. Revocation checks require authenticated Firebase Admin access; project-ID-only token verification no longer suffices. Missing privileges fail closed. See [Firebase session management](https://firebase.google.com/docs/auth/admin/manage-sessions).
- Add deployment-wide request limits through the hosting platform. The in-process limiter resets on restarts and is independent across server instances; it cannot enforce a global quota or block unauthenticated network floods.
- The CSP is a baseline protecting framing, objects, base URLs, and form destinations. It does not yet restrict script sources. A strict script policy needs a separate change compatible with the app's cached/partially prerendered pages and Firebase popup flow.
- The issuing route retains the existing custom `{ cardId, merchant, amountCents }` contract, now requiring a valid server-side signature. The browser's `authorizeCard` helper cannot supply that signature. The mock checkout uses the issuer directly and remains available. Native Stripe `issuing_authorization.request` envelopes still need a Backend 1 contract/adapter change, durable event deduplication, and end-to-end verification before enabling native Stripe Issuing. Real merchant identity should eventually use stable merchant identifiers rather than display names. No shared contract was changed in this pass.
- No deployment settings, external account policies, database credentials, or secrets were changed. The patch must be deployed for the hosted site to receive these protections.
