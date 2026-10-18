import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { ledgerUsesMemory } from "@/lib/db/memory-store";
import { users } from "@/lib/db/schema";
import type { User } from "@/lib/types";
import type { VerifiedFirebaseUser } from "@/lib/auth/verify-token";

const memoryUsers = new Map<string, User>();

export function resetUsersForTests() {
  memoryUsers.clear();
}

function displayName(identity: VerifiedFirebaseUser, email: string) {
  const fromToken = identity.name?.trim();
  if (fromToken) return fromToken;
  const local = email.split("@")[0]?.trim();
  return local && local.length > 0 ? local : "Member";
}

function toUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    firebaseUid: row.firebaseUid,
    email: row.email,
    name: row.name,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : new Date(row.createdAt).toISOString(),
  };
}

export async function upsertFirebaseUser(identity: VerifiedFirebaseUser & { email: string }): Promise<User> {
  if (ledgerUsesMemory()) {
    const existing = [...memoryUsers.values()].find((user) => user.firebaseUid === identity.uid);
    if (existing) {
      existing.email = identity.email;
      return structuredClone(existing);
    }
    const created: User = {
      id: `usr_${nanoid(8)}`,
      firebaseUid: identity.uid,
      email: identity.email,
      name: displayName(identity, identity.email),
      createdAt: new Date().toISOString(),
    };
    memoryUsers.set(created.id, created);
    return structuredClone(created);
  }

  const { getDb } = await import("@/lib/db/client");
  const db = getDb();
  const name = displayName(identity, identity.email);
  await db
    .insert(users)
    .values({
      id: `usr_${nanoid(8)}`,
      firebaseUid: identity.uid,
      email: identity.email,
      name,
      createdAt: new Date(),
    })
    .onConflictDoNothing({ target: users.firebaseUid });
  const [row] = await db.select().from(users).where(eq(users.firebaseUid, identity.uid)).limit(1);
  if (!row) throw new Error("User upsert failed");
  if (row.email !== identity.email) {
    await db.update(users).set({ email: identity.email }).where(eq(users.id, row.id));
    row.email = identity.email;
  }
  return toUser(row);
}
