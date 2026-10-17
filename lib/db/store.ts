import type { GroupState } from "@/lib/types";

export interface LedgerStore {
  get(groupId: string): Promise<GroupState | null>;
  put(state: GroupState): Promise<void>;
  findByCardId(cardId: string): Promise<GroupState | null>;
  findByPaymentIntentId(paymentIntentId: string): Promise<GroupState | null>;
  findBySlotId(slotId: string): Promise<GroupState | null>;
  findByZoneId(zoneId: string): Promise<GroupState | null>;
  findByProductId(productId: string): Promise<GroupState | null>;
}

export class LedgerError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "LedgerError";
    this.status = status;
  }
}
