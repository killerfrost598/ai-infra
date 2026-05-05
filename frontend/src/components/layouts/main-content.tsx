"use client";

import { usePathname } from "next/navigation";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

type LayoutMode = "standard" | "wide" | "full";

const WIDE_ROUTES = [
  "/clore",
  "/servers",
  "/task-runs",
  "/benchmarks",
  "/models",
  "/find",
  "/compat",
];

const PAGE_LABELS: Record<string, string> = {
  "": "Overview",
  servers: "Servers",
  deployments: "Deployments",
  playbooks: "Playbooks",
  clore: "Clore",
  find: "GPU Finder",
  models: "Models",
  benchmarks: "Benchmarks",
  lab: "Lab",
  compat: "Compat",
  docs: "Docs",
  settings: "Settings",
  "task-runs": "Task Runs",
};

function getLayoutMode(pathname: string): LayoutMode {
  if (pathname === "/lab") return "full";
  if (WIDE_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return "wide";
  }
  return "standard";
}

function getPageLabel(pathname: string): string {
  const firstSegment = pathname.split("/").filter(Boolean)[0] ?? "";
  return PAGE_LABELS[firstSegment] ?? "Overview";
}

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const mode = getLayoutMode(pathname);

  if (mode === "full") {
    return <main className="h-full w-full">{children}</main>;
  }

  return (
    <main className="w-full">
      <div className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border/70 bg-background/95 px-3 backdrop-blur md:hidden">
        <SidebarTrigger className="size-8" />
        <span className="text-sm font-medium">{getPageLabel(pathname)}</span>
      </div>
      <div
        className={cn(
          "w-full px-4 py-6 sm:px-6 md:py-8 lg:px-8",
          mode === "wide" ? "mx-auto max-w-screen-2xl" : "mx-auto max-w-5xl"
        )}
      >
        {children}
      </div>
    </main>
  );
}
