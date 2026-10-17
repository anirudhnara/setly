import type { Metadata } from "next";
import { Console } from "@/components/console/console";

export const metadata: Metadata = { title: "Setly" };

export default function HomeConsolePage() {
  return <Console />;
}
