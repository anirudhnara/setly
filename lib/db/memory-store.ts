import { loadGroupState } from "@/lib/fixtures/sample";
import type { Group, GroupState } from "@/lib/types";
import type { LedgerStore } from "@/lib/db/store";

class MemoryLedger implements LedgerStore {
  private groups = new Map<string, GroupState>();
  private seeded = false;

  reset(seedFixture: boolean) {
    this.groups.clear();
    this.seeded = true;
    if (seedFixture) this.seedFixture();
  }

  async get(groupId: string) {
    this.ensureSeed();
    return this.clone(this.groups.get(groupId));
  }

  async put(state: GroupState) {
    this.ensureSeed();
    this.groups.set(state.group.id, structuredClone(state));
  }

  async findByCardId(cardId: string) {
    return this.find((state) => state.card?.id === cardId);
  }

  async findByPaymentIntentId(paymentIntentId: string) {
    return this.find((state) => state.contributions.some((contribution) => contribution.stripePaymentIntentId === paymentIntentId));
  }

  async findBySlotId(slotId: string) {
    return this.find((state) => state.map.slots.some((slot) => slot.id === slotId));
  }

  async findByZoneId(zoneId: string) {
    return this.find((state) => state.map.zones.some((zone) => zone.id === zoneId));
  }

  async findByProductId(productId: string) {
    return this.find((state) => state.map.products.some((product) => product.id === productId));
  }

  async listForUser(userId: string) {
    this.ensureSeed();
    const matches: Group[] = [];
    for (const state of this.groups.values()) {
      if (state.members.some((member) => member.userId === userId)) matches.push(structuredClone(state.group));
    }
    matches.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return matches;
  }

  private find(predicate: (state: GroupState) => boolean) {
    this.ensureSeed();
    for (const state of this.groups.values()) {
      if (predicate(state)) return this.clone(state);
    }
    return Promise.resolve(null);
  }

  private ensureSeed() {
    if (this.seeded) return;
    this.seeded = true;
    this.seedFixture();
  }

  private seedFixture() {
    const state = structuredClone(loadGroupState());
    this.groups.set(state.group.id, state);
  }

  private clone(state: GroupState | undefined) {
    return Promise.resolve(state ? structuredClone(state) : null);
  }
}

export const memoryLedger = new MemoryLedger();

let forceMemory = false;

export function useMemoryLedgerForTests() {
  forceMemory = true;
  memoryLedger.reset(true);
}

export function ledgerUsesMemory() {
  return forceMemory || !process.env.DATABASE_URL;
}

export async function getLedgerStore(): Promise<LedgerStore> {
  if (ledgerUsesMemory()) return memoryLedger;
  const { drizzleLedger } = await import("@/lib/db/drizzle-store");
  return drizzleLedger;
}
