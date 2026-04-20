"use client";

import { usePathname } from "next/navigation";

export function MainContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLabPage = pathname === "/lab";

  return (
    <main className={isLabPage ? "h-full w-full" : "mx-auto w-full max-w-5xl px-8 py-8"}>
      {children}
    </main>
  );
}
