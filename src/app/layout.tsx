import "./globals.css";
import type { Metadata } from "next";
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: "Pangzi · A-share Research",
  description:
    "A-share stock screening, scoring, and backtesting research tool (decision-support only).",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="bg-surface text-ink antialiased min-h-screen">
        <Nav />
        <main className="mx-auto max-w-[1600px] px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
