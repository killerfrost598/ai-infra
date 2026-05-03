"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/docs",                  label: "Overview",          exact: true },
  { href: "/docs/vram-calculator",  label: "VRAM Calculator"               },
  { href: "/docs/engines",          label: "Engine Guide"                  },
  { href: "/docs/settings",         label: "Settings Reference"            },
];

export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-wrap gap-1 border-b border-border pb-0">
      {LINKS.map(({ href, label, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-t-md border-b-2 px-4 py-2 text-sm transition-colors ${
              active
                ? "border-indigo-500 text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
