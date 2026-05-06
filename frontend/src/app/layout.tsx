import "./globals.css";
import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/nav/app-sidebar";
import { Providers } from "@/components/providers";
import { MainContent } from "@/components/layouts/main-content";
import { PrefetchOffers } from "@/components/PrefetchOffers";

export const metadata: Metadata = {
  title: "Inferix",
  description: "Your inference control plane, built on Clore.ai.",
  manifest: "/manifest.json",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="dark" disableTransitionOnChange>
          <Providers>
            <PrefetchOffers />
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset>
                <MainContent>{children}</MainContent>
              </SidebarInset>
            </SidebarProvider>
            <Toaster />
          </Providers>
        </ThemeProvider>
      </body>
    </html>
  );
}
