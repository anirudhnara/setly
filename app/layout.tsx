import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Setly — group plans, made real",
  description: "Plan, fund, and buy together with one shared group map.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
