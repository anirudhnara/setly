"use client";

import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ArrowRight, Undo2 } from "lucide-react";
import { formatCents } from "@/components/shared/format";
import { Avatar, GroupHeader } from "@/components/shared/group-header";
import { GroupLoading, GroupMissing } from "@/components/group/group-states";
import { ProductImage } from "@/components/shared/product-image";
import { usePlan } from "@/components/shared/use-plan";
import { returnItem } from "@/lib/client";
import type { Refund } from "@/lib/types";

export function SettleView({ groupId }: { groupId: string }) {
  const plan = usePlan(groupId);
  const [pendingId, setPendingId] = useState("");
  const [fault, setFault] = useState("");
  const [note, setNote] = useState("");

  async function refund(productId: string) {
    setPendingId(productId);
    setFault("");
    setNote("");
    try {
      const result = await returnItem({ groupId, productId });
      await plan.mutate();
      const total = result.refunds.reduce((sum, item) => sum + item.amountCents, 0);
      setNote(result.refunds.length ? `Returned. ${formatCents(total)} goes back to the people who paid for it.` : "Nothing to refund on that item.");
    } catch (error) {
      setFault(error instanceof Error ? error.message : "Return didn’t go through.");
    } finally {
      setPendingId("");
    }
  }

  if (!plan.mounted || (plan.isLoading && !plan.data)) return <GroupLoading />;
  const data = plan.data;
  if (!data) return <GroupMissing />;

  const purchased = data.authorizations.some((entry) => entry.approved);
  const returned = new Set(data.refunds.map((item) => item.productId));
  const items = data.map.slots
    .map((slot) => ({ slot, product: data.map.products.find((product) => product.id === slot.chosenProductId) ?? null }))
    .filter((item) => item.product && item.slot.payType !== "already_owned");
  const refundedTotal = data.refunds.reduce((sum, item) => sum + item.amountCents, 0);

  return (
    <div className="group-page">
      <GroupHeader
        state={data}
        step="returns"
        title="Returns, handled"
        lede="Send something back and Setly refunds the people who paid for it, in proportion to what each one paid. No spreadsheets, no Venmo requests."
      />

      {!purchased ? (
        <section className="g-card callout">
          <Undo2 aria-hidden="true" />
          <div><strong>Nothing bought yet.</strong><p className="muted">Returns open after the group card checks out.</p></div>
          <Link className="btn btn-accent" href={`/g/${groupId}/checkout`}>Go to payment <ArrowRight aria-hidden="true" /></Link>
        </section>
      ) : null}

      <div className="group-grid">
        <section className="g-card">
          <span className="orbit-label">Bought with the group card</span>
          <ul className="return-list">
            {items.map(({ slot, product }, index) => {
              if (!product) return null;
              const done = returned.has(product.id);
              return (
                <li key={product.id} className={done ? "returned" : ""} style={{ "--i": index } as CSSProperties}>
                  <ProductImage product={product} need={slot.need} className="line-image big" />
                  <span><small>{slot.need} · {product.store}</small><strong>{product.title}</strong></span>
                  <b>{formatCents(product.priceCents)}</b>
                  <button type="button" className="btn btn-ghost" disabled={!purchased || done || pendingId === product.id} onClick={() => void refund(product.id)}>
                    {done ? "Returned" : pendingId === product.id ? "Returning…" : <><Undo2 aria-hidden="true" /> Return</>}
                  </button>
                </li>
              );
            })}
          </ul>
          {note ? <p className="notice" role="status">{note}</p> : null}
          {fault ? <p className="fault" role="alert">{fault}</p> : null}
        </section>

        <aside className="g-card action-card">
          <span className="orbit-label">Refunded</span>
          <strong className="big-number">{formatCents(refundedTotal)}</strong>
          {data.refunds.length ? (
            <ul className="payers">
              {data.refunds.map((item, index) => {
                const person = data.members.find((member) => member.id === item.memberId);
                const product = data.map.products.find((entry) => entry.id === item.productId);
                return (
                  <li key={item.id} style={{ "--i": index } as CSSProperties}>
                    <Avatar name={person?.name ?? "?"} tone={index} />
                    <span>{person?.name ?? "Member"}<small>{product?.title ?? refundLabel(item.reason, data.storeOrders.find((order) => order.id === item.storeOrderId)?.store)}</small></span>
                    <b>+{formatCents(item.amountCents)}</b>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">Refunds show up here, split back to each payer automatically.</p>
          )}
        </aside>
      </div>
    </div>
  );
}

/** What a refund without a product was for. */
function refundLabel(reason: Refund["reason"], store: string | undefined) {
  const at = store ? ` at ${store}` : "";
  if (reason === "leftover_buffer") return `Unused buffer${at}`;
  if (reason === "zinc_held") return `Unused hold${at}`;
  if (reason === "store_failed") return `Order canceled${at}`;
  return "Item";
}
