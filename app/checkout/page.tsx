"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { readLastGroup } from "@/components/shared/session";

/** Old prototype URL: send people to their latest group's payment page, or to start a set. */
export default function CheckoutRedirect() {
  const router = useRouter();
  useEffect(() => {
    const groupId = readLastGroup();
    router.replace(groupId ? `/g/${groupId}/checkout` : "/home");
  }, [router]);
  return <main className="sign-in-shell"><p className="sign-in-status">Taking you to checkout…</p></main>;
}
