import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./orbit.css";
import "@/components/shared/jarvis-mark.css";
import { Geist, Instrument_Serif } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-display" });

export const metadata: Metadata = {
  title: "Setly — shop together, as a set",
  description: "Tell Setly what your group needs. It asks the right questions, finds a real set from real stores, and lets everyone shape it together.",
};

export const viewport: Viewport = { themeColor: "#f6f3ee" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable, serif.variable)}>
      <body>{children}</body>
    </html>
  );
}
