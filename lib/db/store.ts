import type { Group, GroupState } from "@/lib/types";

/** The group row loaded inside a mutation. Assign `state` to insert a group that was missing. */
export interface GroupDraft {
  state: GroupState | null;
}

export interface LedgerStore {
  get(groupId: string): Promise<GroupState | null>;
  put(state: GroupState): Promise<void>;
  /**
   * Runs `fn` alone for this group. Memory queues one call at a time.
   * Postgres holds `SELECT ... FOR UPDATE` and writes in that same transaction.
   * A nested `mutate` for the same group must reuse this draft instead of locking again.
   */
  mutate<T>(groupId: string, fn: (draft: GroupDraft) => Promise<T>): Promise<T>;
  findByCardId(cardId: string): Promise<GroupState | null>;
  findByPaymentIntentId(paymentIntentId: string): Promise<GroupState | null>;
  findBySlotId(slotId: string): Promise<GroupState | null>;
  findByZoneId(zoneId: string): Promise<GroupState | null>;
  findByProductId(productId: string): Promise<GroupState | null>;
  listForUser(userId: string): Promise<Group[]>;
}

export class LedgerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LedgerError";
    this.status = status;
  }
}
