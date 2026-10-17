"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { livingRoomFixture } from "@/lib/fixtures/living-room";
import type { Slot } from "@/lib/types";

type View = "plan" | "personal" | "checkout";
type Modal = "add" | "join" | "signin" | "want" | null;
type InventoryItem = { id: string; name: string; note: string; emoji: string };
type Recommendation = { id: string; name: string; store: string; priceCents: number; match: number; description: string; emoji: string };

const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const allSlots = livingRoomFixture.zones.flatMap((zone) => zone.slots);
const currentMember = livingRoomFixture.members[0];

const starterInventory: InventoryItem[] = [
  { id: "mine-throw", name: "Chunky knit throw", note: "My bedroom · bought last fall", emoji: "▤" },
  { id: "mine-books", name: "Bookshelf", note: "My room · 5 shelves", emoji: "▥" },
  { id: "mine-speaker", name: "Bluetooth speaker", note: "Portable · mine", emoji: "◖" },
];

const recommendations: Recommendation[] = [
  { id: "rec-table", name: "Round oak side table", store: "Target", priceCents: 6499, match: 96, description: "Warm oak finish ties in with the sofa.", emoji: "◯" },
  { id: "rec-planter", name: "Ceramic floor planter", store: "IKEA", priceCents: 2499, match: 91, description: "Adds a soft green accent without pushing the room over budget.", emoji: "♧" },
  { id: "rec-cushions", name: "Textured cushion set", store: "Wayfair", priceCents: 3899, match: 88, description: "A cozy add-on that fits the group’s shared living-room plan.", emoji: "▦" },
];

function productFor(slot: Slot) {
  return slot.products.find((product) => product.id === slot.chosenProductId) ?? slot.products[0];
}

export default function SetlyApp({ initialView }: { initialView: View }) {
  const router = useRouter();
  const [view, setView] = useState<View>(initialView);
  const [modal, setModal] = useState<Modal>(null);
  const [slots, setSlots] = useState<Slot[]>(allSlots);
  const [inventory, setInventory] = useState<InventoryItem[]>(starterInventory);
  const [newNeed, setNewNeed] = useState("");
  const [newWant, setNewWant] = useState("");
  const [wants, setWants] = useState([
    { id: "want-1", member: "Jules", text: "cozy, neutral tones" },
    { id: "want-2", member: "Sam", text: "plants + natural textures" },
  ]);
  const [joinCode, setJoinCode] = useState("");
  const [joined, setJoined] = useState(false);
  const [signedIn, setSignedIn] = useState(false);
  const [accountType, setAccountType] = useState<"roommate" | "organization">("roommate");
  const [purchased, setPurchased] = useState(false);
  const [remainingCard, setRemainingCard] = useState(120000);
  const [toast, setToast] = useState("");

  const subtotal = useMemo(() => slots.reduce((sum, slot) => sum + (productFor(slot)?.priceCents ?? 0) * slot.quantity, 0), [slots]);
  const shares = livingRoomFixture.members.map((member, index) => ({
    member,
    amountCents: Math.floor(subtotal / livingRoomFixture.members.length) + (index < subtotal % livingRoomFixture.members.length ? 1 : 0),
  }));
  const perPerson = Math.ceil(subtotal / livingRoomFixture.members.length);

  function announce(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  function addNeed(name: string) {
    const clean = name.trim();
    if (!clean) return;
    if (view === "personal") {
      setInventory((current) => [...current, { id: `mine-${Date.now()}`, name: clean, note: "Added just for you · private", emoji: "✳" }]);
      setNewNeed("");
      setModal(null);
      announce(`${clean} added to your private inventory`);
      return;
    }
    const id = `need-${Date.now()}`;
    const nextSlot: Slot = {
      id,
      zoneId: "zone-living-room",
      need: clean,
      quantityRule: "per_group",
      quantity: 1,
      budgetCents: null,
      payType: "shared",
      ownerMemberId: null,
      chosenProductId: null,
      updatedBy: currentMember.id,
      updatedAt: new Date().toISOString(),
      products: [],
    };
    setSlots((current) => [...current, nextSlot]);
    setNewNeed("");
    setModal(null);
    setView("plan");
    announce(`${clean} added to the shared web`);
  }

  function addWant(text: string) {
    const clean = text.trim();
    if (!clean) return;
    setWants((current) => [...current, { id: `want-${Date.now()}`, member: signedIn ? "Ani" : "You", text: clean }]);
    setNewWant("");
    setModal(null);
    announce("Your thought was shared with the group");
  }

  function addRecommendation(rec: Recommendation) {
    const id = `slot-${rec.id}`;
    if (slots.some((slot) => slot.id === id)) {
      announce(`${rec.name} is already in the plan`);
      return;
    }
    const next: Slot = {
      id,
      zoneId: "zone-living-room",
      need: rec.name,
      quantityRule: "per_group",
      quantity: 1,
      budgetCents: rec.priceCents,
      payType: "shared",
      ownerMemberId: null,
      chosenProductId: id,
      updatedBy: currentMember.id,
      updatedAt: new Date().toISOString(),
      products: [{ id, slotId: id, title: rec.name, store: rec.store, priceCents: rec.priceCents, url: "#", imageUrl: null, attributes: {} }],
    };
    setSlots((current) => [...current, next]);
    announce(`${rec.name} added to the shared plan`);
  }

  function moveToPersonal(slot: Slot) {
    const item = productFor(slot);
    setInventory((current) => [...current, { id: `mine-${slot.id}`, name: slot.need, note: item ? `${item.store} · ${money(item.priceCents)}` : "Added just for you", emoji: "✳" }]);
    setSlots((current) => current.filter((item) => item.id !== slot.id));
    announce(`${slot.need} moved to your private inventory`);
  }

  function checkout() {
    const amount = Math.min(subtotal, remainingCard);
    setRemainingCard((current) => current - amount);
    setPurchased(true);
    announce(`Plan checkout approved · ${money(amount)}`);
  }

  return (
    <div className="app-shell">
      <header className="app-topbar">
        <Link href="/" className="app-brand" onClick={() => setView("plan")}>
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>setly<span className="brand-dot">.</span>
        </Link>
        <div className="topbar-group"><span className="live-dot" /> <span>{livingRoomFixture.group.name}</span><button className="text-action" onClick={() => setModal("join")}>Join a group</button></div>
        <div className="topbar-actions"><button className="funding-chip" onClick={() => router.push("/checkout")}><span className="wallet-icon">▣</span><span><small>GROUP CARD</small><strong>{money(remainingCard)} left</strong></span><span className="active-tag">ACTIVE</span></button><button className="profile-button" onClick={() => setModal("signin")}><span className="profile-avatar">{signedIn ? "A" : "?"}</span><span>{signedIn ? (accountType === "roommate" ? "Ani" : "Northstar") : "Sign in"}</span><span className="chevron">⌄</span></button></div>
      </header>

      <div className="app-layout">
        <aside className="left-rail">
          <div className="rail-label">YOUR SPACE</div>
          <button className={`rail-link ${view === "plan" ? "selected" : ""}`} onClick={() => setView("plan")}><span className="rail-icon">⌘</span><span>Group plan</span><span className="rail-count">{slots.length}</span></button>
          <button className={`rail-link ${view === "personal" ? "selected" : ""}`} onClick={() => setView("personal")}><span className="rail-icon">♙</span><span>My inventory</span><span className="private-dot" title="Private to you">●</span></button>
          <Link href="/checkout" className={`rail-link ${view === "checkout" ? "selected" : ""}`} onClick={() => setView("checkout")}><span className="rail-icon">▣</span><span>Checkout</span><span className="rail-count">{slots.length}</span></Link>

          <div className="rail-divider" />
          <div className="rail-label">GROUP MEMBERS <button aria-label="Invite member" onClick={() => setModal("join")}>+</button></div>
          <div className="member-list">{livingRoomFixture.members.map((member, index) => <div className="member-row" key={member.id}><span className={`member-avatar m${index}`}>{member.name[0]}</span><span>{member.name}{member.isOrganizer ? <small> · organizer</small> : null}</span><i className="member-online" /></div>)}</div>
          {joined && <div className="joined-notice">You joined this group <span>✓</span></div>}

          <div className="rail-bottom-card"><span className="privacy-lock">⌑</span><strong>Personal stays personal</strong><p>Your inventory is only visible to you until you choose to share something.</p><button onClick={() => setView("personal")}>View my inventory <span>→</span></button></div>
          <button className="help-link" onClick={() => announce("Setly keeps group plans and personal inventory separate.")}>? <span>How Setly works</span></button>
        </aside>

        <main className="main-stage">
          {view === "plan" && <>
            <div className="page-heading"><div><div className="crumb">YOUR GROUP <span>/</span> SHARED PLAN</div><h1>The living room <span className="heading-pencil">✳</span></h1><p>Build the space together. Everyone can add ideas; your personal inventory stays yours.</p></div><button className="invite-button" onClick={() => setModal("join")}><span>↗</span> Invite people</button></div>
            <section className="map-toolbar"><div className="map-view-title"><span className="map-spark">✳</span><span><strong>Room web</strong><small>4 needs · shared with everyone</small></span></div><div className="map-toolbar-actions"><button onClick={() => setView("personal")}>◉ <span>My view</span></button><button className="add-need-button" onClick={() => setModal("add")}>＋ Add a need</button></div></section>
            <section className="web-canvas" aria-label="Interactive shared item web">
              <div className="canvas-grid" />
              <svg className="web-lines" viewBox="0 0 800 430" preserveAspectRatio="none" aria-hidden="true"><path d="M400 208 C330 150 280 105 175 95"/><path d="M400 208 C322 245 266 310 182 322"/><path d="M400 208 C470 150 520 100 630 96"/><path d="M400 208 C485 254 536 308 632 322"/><path d="M400 208 C400 148 400 110 400 65"/><path d="M400 208 C400 280 400 338 400 380"/></svg>
              <div className="web-core"><span>THE PLAN</span><strong>Living<br />together</strong><small>{slots.length} ideas · {money(subtotal)}</small></div>
              {slots.map((slot, index) => {
                const item = productFor(slot);
                return <article key={slot.id} className={`web-node node-${index % 8}`}>
                  <button className="node-remove" aria-label={`Remove ${slot.need}`} onClick={() => { setSlots((current) => current.filter((candidate) => candidate.id !== slot.id)); announce(`${slot.need} removed from the plan`); }}>×</button>
                  <div className={`node-art art-${index % 5}`}>{item ? ["▱", "▤", "♧", "◒", "✳"][index % 5] : "＋"}</div>
                  <div className="node-copy"><strong>{slot.need}</strong><span>{item ? money(item.priceCents) : "Find a match"}</span></div>
                  <div className="node-foot"><span>{slot.payType === "shared" ? "Shared" : slot.payType}</span><button onClick={() => moveToPersonal(slot)} title="Move to your private inventory">↗</button></div>
                </article>;
              })}
              <button className="canvas-add" onClick={() => setModal("add")}><span>＋</span><strong>Add something</strong><small>Every good plan starts with an idea</small></button>
              <div className="canvas-caption"><span className="caption-live" /> GROUP WEB <span>·</span> LOCAL DEMO</div>
            </section>
            <div className="under-canvas-row"><div className="rule-summary"><span className="rule-checkmark">✓</span><span><strong>Looking good</strong><small>Plan is within the $1,200 budget</small></span></div><div className="cost-summary"><span>Per person</span><strong>{money(perPerson)}</strong><span className="cost-members">÷ 4</span></div></div>
            <section className="wants-card"><div className="wants-mark">✎</div><div className="wants-copy"><strong>What would make this feel like home?</strong><p>{wants.map((want) => `${want.member}: ${want.text}`).join(" · ")}</p></div><button onClick={() => setModal("want")}>Add a thought <span>→</span></button></section>
          </>}

          {view === "personal" && <>
            <div className="page-heading"><div><div className="crumb">YOUR SPACE <span>/</span> PRIVATE</div><h1>My inventory <span className="heading-lock">⌑</span></h1><p>Things you already own, and ideas you’re keeping for yourself.</p></div><span className="private-pill">⌑ PRIVATE TO YOU</span></div>
            <div className="private-banner"><span>⌑</span><div><strong>This is your space.</strong><p>Only you can see what’s here. Add something to the group plan only when you decide to share it.</p></div></div>
            <div className="inventory-toolbar"><div><strong>{inventory.length} things</strong><span> · Only visible to Ani</span></div><button onClick={() => setModal("add")}>＋ Add to my inventory</button></div>
            <div className="inventory-grid">{inventory.map((item, index) => <article className="inventory-card" key={item.id}><div className={`inventory-art inv-art-${index % 4}`}>{item.emoji}</div><div className="inventory-info"><strong>{item.name}</strong><span>{item.note}</span></div><button onClick={() => { setInventory((current) => current.filter((entry) => entry.id !== item.id)); announce(`${item.name} removed from your inventory`); }}>···</button><button className="share-inventory" onClick={() => { const slot: Slot = { id: `shared-${item.id}`, zoneId: "zone-living-room", need: item.name, quantityRule: "per_group", quantity: 1, budgetCents: 0, payType: "already_owned", ownerMemberId: currentMember.id, chosenProductId: null, updatedBy: currentMember.id, updatedAt: new Date().toISOString(), products: [] }; setSlots((current) => [...current, slot]); setView("plan"); announce(`${item.name} shared with the group`); }}>Share with group <span>→</span></button></article>)}</div>
            <button className="add-inventory-large" onClick={() => setModal("add")}><span>＋</span><strong>Add something you own</strong><small>Keep it private, or share it with the group later</small></button>
          </>}

          {view === "checkout" && <>
            <div className="page-heading"><div><div className="crumb">YOUR GROUP <span>/</span> CHECKOUT</div><h1>Ready when you are.</h1><p>One card, stores from your plan, and a clear record of every decision.</p></div><span className="checkout-status"><i /> {purchased ? "CHECKOUT COMPLETE" : "CARD ACTIVE"}</span></div>
            <div className="checkout-grid">
              <div className="checkout-main-card">
                <div className="checkout-card-heading"><div><span className="card-overline">SETLY GROUP CARD</span><h2>Living room plan</h2></div><span className="card-chip">▦</span></div>
                <div className="balance-row"><span>Available balance</span><strong>{money(remainingCard)}</strong></div>
                <div className="balance-track"><i style={{ width: `${Math.max(0, Math.min(100, remainingCard / 1200))}%` }} /></div>
                <div className="card-foot"><span>•••• 4821</span><span>Fully funded by 4 roommates ✓</span></div>
              </div>
              <div className="funding-card"><div className="section-label">EVERYONE’S IN</div><h3>Group contributions</h3><p>Each person added their share to activate the card.</p>{shares.map(({ member, amountCents }, index) => <div className="contribution-row" key={member.id}><span className={`member-avatar m${index}`}>{member.name[0]}</span><span>{member.name}{member.isOrganizer && <small> · organizer</small>}</span><strong>{money(amountCents)}</strong><i>✓</i></div>)}<div className="funding-total"><span>Plan total</span><strong>{money(subtotal)}</strong></div></div>
              <div className="checkout-items-card"><div className="checkout-section-heading"><div><span className="section-label">ON THE PLAN</span><h3>Items for checkout <span>{slots.length}</span></h3></div><button onClick={() => setView("plan")}>Edit plan <span>↗</span></button></div>
                {slots.filter((slot) => productFor(slot)).map((slot) => { const product = productFor(slot); return <div className="checkout-item" key={slot.id}><div className="checkout-item-art">{slot.need.slice(0, 1)}</div><div className="checkout-item-info"><strong>{product?.title ?? slot.need}</strong><span>{product?.store ?? "Already owned"} · plan-approved</span></div><strong>{slot.payType === "already_owned" ? "Owned" : money((product?.priceCents ?? 0) * slot.quantity)}</strong></div>; })}
                {purchased && <div className="purchase-confirmation"><span>✓</span><div><strong>Plan checkout complete</strong><small>Approved purchases were recorded in the authorization log.</small></div></div>}
                <div className="checkout-total"><span>Plan subtotal</span><strong>{money(subtotal)}</strong></div>
                <button className="run-checkout" disabled={purchased} onClick={checkout}>{purchased ? "Checkout complete ✓" : <>Check out with group card <span>→</span></>}</button>
                <p className="checkout-disclaimer">Demo mode · Checkout is simulated. The group card can only be used at stores in this plan.</p>
              </div>
              <aside className="auth-log-card"><div className="section-label">DEMO AUTHORIZATION LOG</div><h3>On-plan protection</h3><p>Every card decision comes from the shared plan.</p><div className="auth-entry approved"><span>✓</span><div><strong>{purchased ? "Wayfair" : "Ready for Wayfair"}</strong><small>{purchased ? `${money(slots.find((s) => s.need === "Sofa")?.products[0]?.priceCents ?? 0)} · approved just now` : "Sofa · within plan subtotal"}</small></div><b>APPROVED</b></div><div className="auth-entry declined"><span>×</span><div><strong>Off-plan store</strong><small>Not part of the living room plan</small></div><b>DECLINED</b></div><div className="auth-note">The plan sets a spending limit for every included store.</div></aside>
            </div>
          </>}
        </main>

        <aside className="recommendation-rail">
          <div className="recommend-heading"><div><span className="rec-overline">GOOD FITS FOR YOUR PLAN</span><h2>For your room</h2></div><button aria-label="More recommendations" onClick={() => announce("More recommendations are coming soon.")}>···</button></div>
          <div className="rec-match-banner"><span className="rec-star">✳</span><span><strong>Picked for your group</strong><small>Matches your cozy, shared-space brief</small></span></div>
          <div className="card-balance-mini"><div className="mini-card-icon">▣</div><div><span>GROUP CARD BALANCE</span><strong>{money(remainingCard)} <small>remaining</small></strong></div><span className="mini-card-arrow">↗</span></div>
          <div className="recommend-list">{recommendations.map((rec, index) => <article className="recommend-card" key={rec.id}><div className={`rec-product rec-product-${index}`}>{rec.emoji}<span className="match-badge">{rec.match}% match</span></div><div className="rec-product-main"><strong>{rec.name}</strong><span>{rec.store} · {money(rec.priceCents)}</span><p>{remainingCard >= rec.priceCents ? `${rec.description} Would leave ${money(remainingCard - rec.priceCents)} on the card.` : "Outside the remaining group card balance."}</p></div><button className="rec-add" disabled={remainingCard < rec.priceCents} onClick={() => addRecommendation(rec)}>{slots.some((slot) => slot.id === `slot-${rec.id}`) ? "Added ✓" : "+ Add to plan"}</button></article>)}</div>
          <button className="share-rec-button" onClick={() => setModal("add")}>＋ Add your own idea</button>
          <div className="rec-divider" />
          <div className="wants-rail-heading"><span>✎</span><div><strong>What you want matters.</strong><small>Tell the group what feels right to you.</small></div></div>
          <button className="add-want-button" onClick={() => setModal("want")}>Add a want or recommendation <span>→</span></button>
          <div className="insurance-note"><span className="shield-icon">◈</span><div><strong>{accountType === "organization" ? "Organization view" : "Funding for a group?"}</strong><p>{accountType === "organization" ? "You’re viewing the same group tools as a funder." : "Insurers and sponsors can fund a group from their own account."}</p><button onClick={() => { setAccountType(accountType === "roommate" ? "organization" : "roommate"); announce(accountType === "roommate" ? "Switched to organization sign-in preview" : "Switched to roommate view"); }}>{accountType === "roommate" ? "Preview funder sign-in →" : "Return to roommate view →"}</button></div></div>
        </aside>
      </div>

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><section className="dialog" role="dialog" aria-modal="true">
        <button className="dialog-close" aria-label="Close" onClick={() => setModal(null)}>×</button>
        {modal === "add" && <><span className="dialog-kicker">ADD TO YOUR SPACE</span><h2>What’s on your mind?</h2><p>Add a need, an item you own, or an idea for the room.</p><label htmlFor="new-need">Item or thought</label><input id="new-need" autoFocus value={newNeed} onChange={(event) => setNewNeed(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addNeed(newNeed); }} placeholder="e.g. a coffee table, warm lighting…"/><div className="dialog-privacy"><span>⌑</span> Add to <strong>{view === "personal" ? "your private inventory" : "the shared group plan"}</strong></div><button className="dialog-primary" onClick={() => addNeed(newNeed)}>Add to {view === "personal" ? "my inventory" : "the plan"} <span>→</span></button></>}
        {modal === "join" && <><span className="dialog-kicker">FIND YOUR PEOPLE</span><h2>Join a group</h2><p>Enter the invite code from your group organizer.</p><label htmlFor="join-code">Group invite code</label><input id="join-code" autoFocus value={joinCode} onChange={(event) => setJoinCode(event.target.value)} placeholder="e.g. LIVING-ROOM"/><button className="dialog-primary" onClick={() => { if (!joinCode.trim()) { announce("Enter an invite code to continue."); return; } setJoined(true); setModal(null); announce("You’re in! Welcome to the group."); }}>Join group <span>→</span></button><small className="dialog-footnote">No account needed to join as a roommate. You can create one anytime.</small></>}
        {modal === "want" && <><span className="dialog-kicker">A NOTE FOR THE GROUP</span><h2>What do you want?</h2><p>Share a style, must-have, or request. Your group can keep the idea in mind while shaping the plan.</p><label htmlFor="new-want">Your thought</label><input id="new-want" autoFocus value={newWant} onChange={(event) => setNewWant(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addWant(newWant); }} placeholder="e.g. plants, warm lighting, easy to clean…"/><button className="dialog-primary" onClick={() => addWant(newWant)}>Share with the group <span>→</span></button></>}
        {modal === "signin" && <><span className="dialog-kicker">WELCOME TO SETLY</span><h2>{signedIn ? "Your Setly account" : "Sign in to Setly"}</h2><p>{signedIn ? "Switch the account view to see how group funding works." : "Keep your personal inventory private and pick up where your group left off."}</p><div className="account-choice"><button className={accountType === "roommate" ? "choice-active" : ""} onClick={() => setAccountType("roommate")}><span>♙</span><strong>Roommate</strong><small>Join or organize a group</small></button><button className={accountType === "organization" ? "choice-active" : ""} onClick={() => setAccountType("organization")}><span>◈</span><strong>Organization</strong><small>Fund a group purchase</small></button></div><label htmlFor="signin-email">Email address</label><input id="signin-email" type="email" placeholder="you@example.com"/><button className="dialog-primary" onClick={() => { setSignedIn(true); setModal(null); announce(`Signed in as ${accountType === "roommate" ? "Ani" : "Northstar"} · demo mode`); }}>{signedIn ? "Switch account view" : "Continue with email"} <span>→</span></button><small className="dialog-footnote">Demo sign-in only. Accounts and payments aren’t connected yet.</small></>}
      </section></div>}
      {toast && <div className="toast-message"><span>✓</span> {toast}</div>}
    </div>
  );
}
