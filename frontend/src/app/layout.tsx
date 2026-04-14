import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "AI Inference Platform",
  description: "Management suite for GPU rentals, model deployments, and unified inference gateway.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-zinc-950 text-zinc-100">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="ml-56 flex-1">
            <main className="mx-auto max-w-5xl px-8 py-8">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
