import type { Metadata } from "next";
import { Console } from "@/components/console/console";
import "@/components/console/console.css";

export const metadata: Metadata = { title: "New set — Setly" };

export default function HomeConsolePage() {
  return <Console />;
}
