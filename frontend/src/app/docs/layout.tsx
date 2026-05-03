import type { ReactNode } from "react";
import { DocsNav } from "./_components/DocsNav";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Docs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          VRAM planning, engine selection, and launch configuration guides.
        </p>
      </div>
      <DocsNav />
      {children}
    </div>
  );
}
