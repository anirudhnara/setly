"use client";

import useSWR from "swr";
import { getCurrentUser } from "@/lib/client";
import type { GroupState, Member } from "@/lib/types";

/** The signed-in user, and their member row in a group when they have one. */
export function useMe(state?: GroupState | null) {
  const { data, isLoading } = useSWR("/api/me", () => getCurrentUser(), { revalidateOnFocus: false });
  const user = data?.user ?? null;
  const member: Member | null = user && state ? (state.members.find((item) => item.userId === user.id) ?? null) : null;
  return { user, member, loading: isLoading };
}
