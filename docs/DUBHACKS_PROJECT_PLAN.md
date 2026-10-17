Setly: DubHacks '26 Project Plan
Oct 17, 2026
 · 
@Someone


Setly is group checkout: a group prompts or pastes a list, gets a base map of everything they need, edits it together, funds one locked Visa card, and gets refunds settled automatically. Title track: Visa. Submit by 10 AM Sunday.

Product scope
The core is seven steps that must work end to end with fake roommates by midnight. Everything else is stretch.

Pitch line: "Claude can tell you what to buy. Setly is how four people actually buy it."

Core (must ship)
Prompt to base map. "Living room for 4 roommates, cozy, under $1,200" returns a base map: zones (living room, kitchen), slots in each zone (sofa, rug, lamp), a real product from a real store in every slot, and the rules the plan must meet. Every slot shows its price and the per-person cost.

Shared group. The organizer shares a link or QR code. Members join by name (no login) and see the same map on their phones.

Edit the map together. Anyone can add or delete slots, swap a slot's product, change a slot's budget, and set who pays for it: shared, per person, or "I already own this." Each slot shows who edited it last. Code rechecks the rules after every edit and flags anything that breaks.

Finalize and split. The organizer locks the map. Shared slots split evenly, per-person slots charge each member, and already-owned slots drop off the bill. Everyone sees their share.

Fund the pool. Each member pays their share in Stripe test mode. A progress bar fills, and the card activates only when the plan is fully funded.

Locked checkout. The card buys at each plan store up to that store's subtotal. One off-plan charge is declined with a reason, shown in a live authorization log.

Automatic settle-up. Return one item: each person who paid for it gets their share back automatically.

How it generalizes
Every group purchase is the same map, so no code is specific to dorms, apartments, or camping.

Level

What it is

Apartment

Camping trip

Zones

Groups on the map

Living room, kitchen

Shelter, sleep, cooking

Slots

One need each

Sofa, rug, microwave

Tent, sleeping bags, stove, fuel

Products

A real item filling a slot, plus alternatives

A sofa from Wayfair

A 6-person tent

Links

Relationships between slots

Rug goes under the coffee table

Stove needs a matching fuel canister

Six rule types. Gemini writes each category's rules in these types, and code checks them:

Budget: a slot or the whole map stays under an amount.

Quantity: one per group, one per person, or a set number.

Compatibility: two linked slots share an attribute (stove and fuel type, sheets and bed size).

Size: an item fits a space or capacity (tent holds the group). Checked only when the product data includes dimensions or capacity.

Timing: everything arrives by a date. Checked only when delivery dates are available.

Required or banned: items a place requires or forbids (no candles in a dorm).

Three ways to pay for a slot: shared (split evenly), per person (each member pays their own), or already owned (drops off the shared cost).

Cheap extras (after core works)
Starter maps: three one-tap examples on the home screen (first apartment, camping trip, group gift) next to the free-text prompt. They show breadth instantly and give reliable demo paths.

Paste a list: a second button on the prompt screen that turns pasted text, links, or a Claude answer into the same base map.

Second category in the demo: "camping trip for 6 friends, under $900" at the end, to answer the scale question with different zones and rules on the same engine.

Stretch (only if ahead at midnight)
Insurance screen: a claim inventory loaded as the plan with "Insurer" as the funder. 20 to 30 seconds in the pitch.

All-or-nothing checkout: authorize every store first, capture only if all succeed.

Price-drop refunds: a simulated price drop after purchase that refunds each person automatically, using the price history table.

Cut (roadmap slide only)
Live voting (editing the map together replaces it), substitution rules, room photos, resale, creator sets, campus profiles, parent-funding as the headline.

Demo flow (3 minutes)
Time

What happens

0:00 to 0:20

Hook: "Who here has fronted money for a group and chased people on Venmo for a month?"

0:20 to 0:45

Type the living-room prompt; the base map appears with zones, slots, real products, and per-person prices

0:45 to 1:15

QR code on screen; judges join as roommates and edit the map: one marks "I already own a rug," one swaps the lamp, and a rule flag appears and clears

1:15 to 1:45

Lock the map; judges chip in $1 each in test mode; the pool bar fills and the card activates

1:45 to 2:15

Checkout across three stores; one off-plan charge is declined with a reason

2:15 to 2:35

Return an item; each person who paid for it gets their refund on screen

2:35 to 2:50

Type the camping prompt: different zones and rules (one sleeping bag per person, stove matches fuel), same flow

2:50 to 3:00

Close: "Every group purchase is zones, slots, and rules. Groups are how people find Setly. Organizations that fund purchases, like insurers, are how it makes money."

Architecture
The browser polls one group-state route. Maps calls Gemini and SerpApi, the backend routes save every slot edit and write the ledger in Tiger Data, and Stripe asks the card-authorization route to approve every charge.

Team roles
Four owners, one folder each, so two people's AI tools never edit the same file. The backend owner takes payments, the database, and the rule checker. Two product-minded people split the frontend: one owns the map, the other owns the group and money screens. The AI owner builds the map pipeline, then leads the pitch once the pipeline works.

Owner

Owns

Folder

Delivers

Backend

Tiger Data schema and queries, slot edit routes, rule checker for the six rule types, Stripe (contributions, Issuing card, authorization endpoint, checkout simulation, refunds), share and refund math, the group state endpoint, lib/types.ts

lib/db, lib/rules, lib/money, lib/payments, app/api (except maps)

Every edit is saved and rechecked, money moves correctly, and every number on screen comes from the ledger

AI and data

Gemini prompt-to-map (zones, slots, links, rules), SerpApi search and caching, filling each slot with a real product, alternatives for swaps, paste-a-list parser, starter map fixtures. After 10 PM: demo script, Devpost write-up, pitch lead

lib/ai, lib/search, app/api/maps, fixtures

A prompt returns a valid base map of real products in under 15 seconds, and the pitch is ready

Frontend: map

Home screen (prompt, starter maps, paste a list), the map view (zones, slot cards, links, rule badges), slot editing (add, delete, budget, quantity), swap sheet, shared visual pieces (slot card, price chip, avatars)

app/page.tsx, app/g/[groupId]/page.tsx, components/map

The map is the centerpiece and feels easy to edit

Frontend: group and money

Join by QR, member list, ownership toggle (shared, per person, already own), "edited by" badges, split and pay screen, pool progress bar, checkout authorization log, settle-up screen, Side Kick, side track forms

app/g/[groupId]/join, split, checkout, settle, components/group, components/checkout

The group flow feels live and every money moment is clear on screen

Frontend screens
Screen

Route

Owner

Key components

Data

Home

/

Map

PromptBox, StarterMapCards, PasteListDialog

POST /api/maps/generate, POST /api/maps/paste

Map

/g/[groupId]

Map

MapView, Zone, SlotCard, Links, RuleBadge, SwapSheet, AddSlot

useGroup polling, PATCH /api/slots/[id], GET /api/slots/[id]/options

Join

/g/[groupId]/join

Group and money

QrPanel (organizer view), JoinForm, MemberList

POST /api/groups/[id]/join

Split and pay

/g/[groupId]/split

Group and money

OwnershipToggle, SplitTable, PayButton, PoolBar

POST /api/groups/[id]/lock, POST /api/pay

Checkout

/g/[groupId]/checkout

Group and money

CardSummary, AuthLog, RunCheckoutButton

POST /api/checkout/run, useGroup polling

Settle-up

/g/[groupId]/settle

Group and money

ReturnItemButton, RefundList

POST /api/returns

The map frontend owns the shared visual pieces; the group and money frontend imports them instead of building its own. Both build against fixtures first, so neither waits on the backend.

Shared rules:

Write lib/types.ts by hand in the first 30 minutes (Group, Member, Zone, Slot, Product, Rule, Contribution, Card, Authorization, Refund). Every AI tool generates code against those types.

Merge only through small pull requests. They make AI-tool mistakes easy to roll back.

Commit after every working step.

At the 6 PM, 10 PM, and midnight checkpoints, everyone stops for 10 minutes and runs the flow together.

Timeline
The four owners work in parallel until midnight, with the AI owner switching to the pitch at 10 PM, when the whole team runs the full flow and decides on stretch goals. After that, everyone polishes, records the backup video, and rehearses.

Tech stack and data model
One Next.js app does everything: pages, API routes, and webhooks. Live updates come from the frontend refreshing group state every second, so there's no second real-time service to set up.

Layer

Choice

Why

App

Next.js (App Router, TypeScript), Tailwind, shadcn/ui

One repo, deploys to Vercel in minutes

Live updates

Polling GET /api/groups/[id] every 1 second (SWR refreshInterval)

Good enough for a demo with 4 to 6 phones

LLM

Gemini API, Flash tier, with JSON schema output

Fast, structured answers; eligible for MLH Best Use of Gemini

Database

Tiger Data (managed Postgres), queried with Drizzle or plain pg

The money ledger is relational; price history fits its time-series tables; eligible for MLH Best Use of Tiger Data

Product search

SerpApi Google Shopping engine

Real products and prices across stores from one query. 250 free searches a month, so cache everything

Payments

Stripe test mode: payments for contributions, Issuing for the virtual card, Refunds API

Real authorization and refund events judges can inspect

Hosting

Vercel plus a GoDaddy domain

Public URL for the QR code; domain enters the GoDaddy prize

Tables in Tiger Data
Table

Key columns

Notes

groups

id, name, prompt, budget_cents, status, created_at

status moves: editing, funding, active, purchased, settled

members

id, group_id, name, is_organizer

Join by name, no login

zones

id, group_id, name, sort_order

Groups on the map (living room, cooking)

slots

id, zone_id, need, quantity_rule, quantity, budget_cents, pay_type, owner_member_id, chosen_product_id, updated_by, updated_at

quantity_rule: per_group, per_person, fixed. pay_type: shared, per_person, already_owned

products

id, slot_id, title, store, price_cents, url, image_url, attributes_json

The chosen product plus alternatives for each slot; attributes hold fuel type, bed size, dimensions, capacity

links

id, from_slot_id, to_slot_id, label

Relationships drawn on the map

rules

id, group_id, type, slot_ids, params_json, status

type is one of the six rule types; status is ok, warning, or broken, set by code

contributions

id, group_id, member_id, amount_cents, stripe_payment_intent_id, status

One row per member's share

cards

id, group_id, stripe_card_id, last4, limit_cents, status

Created only when fully funded

store_limits

card_id, store, limit_cents, spent_cents

The card's rules, derived from the locked map

authorizations

id, card_id, merchant, amount_cents, approved, reason, created_at

Powers the live authorization log

refunds

id, group_id, product_id, member_id, amount_cents, stripe_refund_id

One row per person per returned item

price_points

product_id, price_cents, observed_at

Time-series table (hypertable) for price history

search_cache

query, results_json, fetched_at

Saves SerpApi searches

Store all money as integer cents, never floats.

API routes and core logic
The AI picks products; plain code does every money calculation and every card decision. That split is the answer to "what did you build that's yours?"

Route

Owner

Does

POST /api/groups

Backend

Creates the group and the organizer

POST /api/maps/generate

AI and data

Sends the prompt to Gemini, gets zones, slots, links, and rules as JSON, searches each slot on SerpApi (cached), and fills each slot with a real product plus alternatives. Code drops invalid product IDs

POST /api/maps/paste

AI and data

Gemini turns pasted text or links into slots, then the same filling runs

GET /api/slots/[id]/options

AI and data

Returns alternatives for one slot from the cached search

GET /api/groups/[id]

Backend

Everything the screens need in one response, including rule statuses; polled every second

POST /api/groups/[id]/join

Backend

Adds a member by name

POST /api/slots

Backend

Adds a slot to a zone

PATCH /api/slots/[id]

Backend

Edits a slot (product, budget, quantity, pay type, owner), records who edited it, then reruns the rule checker

DELETE /api/slots/[id]

Backend

Removes a slot and reruns the rule checker

POST /api/groups/[id]/lock

Backend

Locks the map and computes each member's share

POST /api/pay

Backend

Creates a test payment for one member's share

POST /api/webhooks/stripe

Backend

Marks contributions paid; when fully funded, creates the Issuing card and its store limits

POST /api/issuing/authorize

Backend

Real-time authorization: approve only plan stores within their remaining limit, log the decision and the reason

POST /api/checkout/run

Backend

Demo button: uses Stripe test helpers to create a charge per store plus one off-plan merchant, then captures the approved ones

POST /api/returns

Backend

Refunds the returned item's card transaction, then refunds each payer's share of it

Share math
A shared slot's price divides evenly among all members. Leftover cents go one each to the first members in join order, so shares always add up to the exact total.

A per-person slot charges each member for their own item.

An already-owned slot costs nothing and is labeled with the owner's name.

Each member's share is the sum of their parts. Show the breakdown per slot on the split screen.

Card rules
The card activates only when the sum of paid contributions equals the plan total.

Each plan store gets a limit equal to that store's subtotal. A charge is approved only if the merchant matches a plan store and the amount fits within what's left.

Every decision, approved or declined, is written to authorizations with a reason ("Best Buy is not in this plan"). The checkout screen shows this log live.

Stripe's real-time authorization gives your server about 2 seconds to answer. Keep this route to one database read and one write.

Refund math
A refund for an item goes back to the people who paid for that item, in proportion to what each paid for it. A returned shared rug splits across everyone; a returned personal lamp goes only to its owner.

Each person's amount becomes a partial refund on their original test payment, so every refund shows up in Stripe's test dashboard.

Gemini prompting rules
Always request JSON with a schema. Validate it in code and retry once if it fails.

The model may only return product IDs from the search results it was given. It never writes prices; prices come from the search data.

Side tracks checklist
Rules: exactly one title track (Visa), at most 3 sponsored side tracks, unlimited non-sponsored side tracks. Frontend: group and money owns the submission forms.

Title track

Visa: Reimagine Shopping. Read the VISA Judging Rubric (linked from the title tracks page) before writing code, and map each rubric line to a demo moment.

Sponsored side tracks (max 3)

SideShift: Best Startup Idea. Strongest startup concept, with a distribution angle. Pitch groups as the way users find Setly.


Cloudforce Side Kick (UW's Purple). A small agent built in Purple. Post the result early Saturday and tag @Cloudforce and @University of Washington on LinkedIn for the bonus.


Third slot: open. Photon (a messaging agent in group chats) only if someone has spare hours after midnight; otherwise leave it empty.

Non-sponsored side tracks (enter all)

DubHacks NEXT. Clear target user, revenue answer, evidence of iteration over the weekend.


MLH Commit Fellowship. Opt in at submission and fill out the supplemental form.


MLH Best Use of Gemini API. Gemini powers prompt-to-plan, set assembly, and paste-a-list.


MLH Best Use of Tiger Data. Tiger Data is the database, including the price history time-series table.


MLH Best Domain Name from GoDaddy Registry. Register the domain and point it at Vercel.


MLH DEV Writing Challenge. Publish a write-up on DEV after the event.


Best Freshman Beginner's Project. Only if every teammate is a freshman. Confirm with an organizer first.

Risks and fallbacks
The two biggest risks are Stripe Issuing access and live API calls during judging. Both have fallbacks decided now, so nobody debates them at 3 AM.

Risk

Fallback

Decision point

Stripe Issuing won't turn on in test mode

A mock issuer behind the same interface, with identical approve and decline logic. Say so in the pitch

Give it 90 minutes, by about 2 PM

SerpApi runs out of free searches or is slow

Cache every search in search_cache. Warm the demo prompts and starter maps Saturday night. Upgrade to the $25 plan if needed

Watch the quota at 6 PM

Gemini returns bad JSON, invented products, or rules outside the six types

Schema output, code validation, one retry, then fall back to the cached starter map

Built into the route

Two people edit the same slot at once

Last edit wins per slot, and the slot shows who edited it and when

Built into PATCH /api/slots/[id]

Product data lacks dimensions or delivery dates

Size and timing rules show as "not checked" instead of passing or failing

Built into the rule checker

Real-time authorization misses Stripe's 2-second window

Keep the route to one read and one write; warm the deployment before judging

Test at 10 PM

Judges' phones can't join (wifi, QR scan)

Three teammate phones pre-joined as roommates

Rehearse at 8 AM

Polling feels laggy with many phones

Raise the interval to 2 seconds; it still reads as live

Test at midnight

Live demo breaks during judging

Switch to the recorded backup video after 5 seconds, without apologizing

Video done by 8 AM

The team debates the idea again

The idea is locked. New ideas go on the roadmap slide

Now

Pitch and judge Q&A
The pitch has two ideas only: the group shops together, and the group's money can only buy what it agreed on. The demo flow in Product scope is the script.

Devpost tagline: "Claude can tell you what to buy. Setly is how four people actually buy it."

Question

Answer

Why not just use Claude?

Claude gives one person a list. Setly gives a group one shared map everyone edits, rules that code rechecks after every edit, one funded card that can only buy the plan, and refunds that settle themselves. Already asked Claude? Paste its list into Setly.

Isn't this Cash App Pools plus a Privacy card?

Pools hand one person a balance to spend on anything. A locked card doesn't know who paid for what. Setly links the map, the people, and the money, which is why refunds settle themselves.

Does the card know the items?

No. Card networks see stores and amounts. Setly matches items to products before purchase, and the card enforces the plan's stores, amounts, and total. Item-level mandates like Google's AP2 are where agent payments are heading.

How does this scale?

Every group purchase is zones, slots, and rules. Gemini writes any category's rules in six fixed types and code checks them, so a new category needs no new code. The camping prompt shows it live.

How does it make money?

Groups are how people find Setly. Organizations that fund purchases, like insurers replacing belongings after a fire, are how it makes money. Interchange and affiliate revenue are thin on their own.

What about holding pooled money in production?

It requires a licensed partner for money transmission. The demo runs entirely in Stripe test mode.

What's the AI doing?

Turning a sentence or a pasted list into a map of zones, slots, links, and rules, and filling it with real products. Every price, rule check, and money decision comes from code, not the model.

Did you talk to users?

Get one real quote Saturday from someone at the event who fronted money for a group trip or apartment.

