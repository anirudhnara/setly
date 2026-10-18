"use client";

import { useState, type CSSProperties, type FormEvent } from "react";
import { AlertTriangle, Check, Clock, ExternalLink, Loader2, ShoppingBag, Truck, X } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import type { CheckoutLaneName, ShippingAddress, StoreOrder } from "@/lib/types";

const LANE_LABEL: Record<CheckoutLaneName, string> = {
  protocol: "1-click · agentic checkout",
  zinc: "1-click · via Zinc",
  guided: "Guided · buy with the card",
};

/** Status shown as an icon plus words, never color alone. */
function statusOf(order: StoreOrder) {
  switch (order.status) {
    case "pending":
    case "quoting":
      return { tone: "", icon: <Clock aria-hidden="true" />, label: order.status === "quoting" ? "Getting a quote" : "Sending order" };
    case "placing":
      return order.lane === "guided"
        ? { tone: "", icon: <ShoppingBag aria-hidden="true" />, label: "Waiting for a buyer" }
        : { tone: "", icon: <Loader2 aria-hidden="true" className="spin" />, label: "Placing" };
    case "needs_approval":
      return { tone: "warn", icon: <AlertTriangle aria-hidden="true" />, label: "Needs approval" };
    case "placed":
      return { tone: "ok", icon: <Check aria-hidden="true" />, label: "Placed" };
    case "failed":
      return { tone: "bad", icon: <X aria-hidden="true" />, label: "Failed" };
    case "canceled":
      return { tone: "bad", icon: <X aria-hidden="true" />, label: "Canceled" };
  }
}

/** The amount that matters right now: what was charged, what was quoted, or the most it may charge. */
function amountOf(order: StoreOrder) {
  if (order.finalTotalCents !== null) return { cents: order.finalTotalCents, note: "charged" };
  if (order.status === "needs_approval" && order.quotedCents !== null) return { cents: order.quotedCents, note: "quoted" };
  if (order.status === "failed" || order.status === "canceled") return { cents: order.capCents, note: "refunded at settle" };
  return { cents: order.capCents, note: "up to" };
}

export function StoreOrderList({
  orders,
  busy,
  onApprove,
  onBought,
}: {
  orders: StoreOrder[];
  busy: string | null;
  onApprove: (order: StoreOrder, approve: boolean) => void;
  onBought: (order: StoreOrder) => void;
}) {
  return (
    <ul className="store-orders">
      {orders.map((order, index) => {
        const status = statusOf(order);
        const amount = amountOf(order);
        const link = order.lane === "guided" && order.externalId && /^https?:\/\//.test(order.externalId) ? order.externalId : null;
        return (
          <li key={order.id} className={`store-order ${status.tone}`} style={{ "--i": index } as CSSProperties}>
            <div className="store-order-head">
              <span className="store-order-name">
                <strong>{order.store}</strong>
                <small>{LANE_LABEL[order.lane]}</small>
              </span>
              <span className="store-order-amount">
                <b>{formatCents(amount.cents)}</b>
                <small>{amount.note}</small>
              </span>
              <span className={`pill ${status.tone}`}>{status.icon} {status.label}</span>
            </div>

            {order.status === "needs_approval" ? (
              <div className="store-order-ask">
                <p>
                  {order.quotedCents !== null
                    ? <>Quoted {formatCents(order.quotedCents)}, over the {formatCents(order.capCents)} cap by {formatCents(order.quotedCents - order.capCents)}. Approving uses buffer the other stores didn&rsquo;t need, so nobody pays more.</>
                    : <>The total came back over the {formatCents(order.capCents)} cap. Approving lets it use buffer the other stores didn&rsquo;t need.</>}
                </p>
                <div className="store-order-actions">
                  <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => onApprove(order, true)}>
                    {busy === `approve:${order.id}` ? "Approving…" : "Approve"}
                  </button>
                  <button type="button" className="btn btn-ghost" disabled={busy !== null} onClick={() => onApprove(order, false)}>
                    {busy === `decline:${order.id}` ? "Declining…" : "Decline"}
                  </button>
                </div>
              </div>
            ) : null}

            {order.lane === "guided" && order.status === "placing" ? (
              <div className="store-order-ask">
                <p>Setly can&rsquo;t check out here itself. Anyone in the group can buy these items with the group card, up to {formatCents(order.capCents)}.</p>
                <div className="store-order-actions">
                  {link ? (
                    <a className="btn btn-ghost" href={link} target="_blank" rel="noreferrer">
                      Open {order.store} <ExternalLink aria-hidden="true" />
                    </a>
                  ) : null}
                  <button type="button" className="btn btn-accent" disabled={busy !== null} onClick={() => onBought(order)}>
                    {busy === `bought:${order.id}` ? "Charging card…" : "We bought it"}
                  </button>
                </div>
              </div>
            ) : null}

            {order.error && order.status !== "needs_approval" ? <p className="store-order-note">{order.error}</p> : null}
            {order.tracking.length > 0 ? (
              <p className="store-order-note">
                <Truck aria-hidden="true" /> {order.tracking.map((entry) => `${entry.carrier} ${entry.number}`).join(", ")}
              </p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

const DEMO_ADDRESS: ShippingAddress = {
  firstName: "",
  lastName: "",
  line1: "4000 15th Ave NE",
  line2: null,
  city: "Seattle",
  state: "WA",
  postalCode: "98105",
  phone: "206-555-0100",
};

export function AddressForm({ name, busy, onSubmit }: { name: string; busy: boolean; onSubmit: (address: ShippingAddress) => void }) {
  const [first, ...rest] = name.trim().split(/\s+/);
  const [address, setAddress] = useState<ShippingAddress>({ ...DEMO_ADDRESS, firstName: first ?? "", lastName: rest.join(" ") || "Group" });
  const field = (key: keyof ShippingAddress, label: string, options: { autoComplete: string; inputMode?: "numeric" | "tel"; maxLength?: number }) => (
    <label className={`address-field ${key}`}>
      <span>{label}</span>
      <input
        value={address[key] ?? ""}
        required={key !== "line2"}
        autoComplete={options.autoComplete}
        inputMode={options.inputMode}
        maxLength={options.maxLength ?? 60}
        onChange={(event) => setAddress((current) => ({ ...current, [key]: key === "line2" ? event.target.value || null : event.target.value }))}
      />
    </label>
  );

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(address);
  }

  return (
    <form className="address-form" onSubmit={submit}>
      <span className="orbit-label">Ship everything to</span>
      <div className="address-grid">
        {field("firstName", "First name", { autoComplete: "given-name" })}
        {field("lastName", "Last name", { autoComplete: "family-name" })}
        {field("line1", "Street address", { autoComplete: "address-line1" })}
        {field("line2", "Apt, suite (optional)", { autoComplete: "address-line2" })}
        {field("city", "City", { autoComplete: "address-level2" })}
        {field("state", "State", { autoComplete: "address-level1", maxLength: 2 })}
        {field("postalCode", "ZIP", { autoComplete: "postal-code", inputMode: "numeric", maxLength: 10 })}
        {field("phone", "Phone", { autoComplete: "tel", inputMode: "tel", maxLength: 20 })}
      </div>
      <button type="submit" className="btn btn-accent wide-btn" disabled={busy}>
        <ShoppingBag aria-hidden="true" /> {busy ? "Buying from every store…" : "Check out everything"}
      </button>
    </form>
  );
}
