import Link from "next/link";
import { Calculator, Cpu, SlidersHorizontal } from "lucide-react";

const CARDS = [
  {
    href: "/docs/vram-calculator",
    icon: Calculator,
    title: "VRAM Calculator",
    description:
      "Interactive breakdown of model weights, KV-cache, and framework overhead. Pick any model + GPU and see exactly what fits and at which quantization.",
    cta: "Open calculator →",
  },
  {
    href: "/docs/engines",
    icon: Cpu,
    title: "Engine Guide",
    description:
      "vLLM, SGLang, and Ollama compared. Interactive concurrency demo, feature table, and a decision guide for chat, agents, RAG, and long-context workloads.",
    cta: "Compare engines →",
  },
  {
    href: "/docs/settings",
    icon: SlidersHorizontal,
    title: "Settings Reference",
    description:
      "Every important launch flag for vLLM and SGLang — what it does, why it matters, and when to reach for it. Includes GPU-specific guidance.",
    cta: "Browse flags →",
  },
];

export default function DocsIndexPage() {
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {CARDS.map(({ href, icon: Icon, title, description, cta }) => (
        <Link
          key={href}
          href={href}
          className="group flex flex-col gap-4 rounded-xl border border-border bg-card p-6 transition-colors hover:border-indigo-500/50 hover:bg-muted/30"
        >
          <div className="flex size-10 items-center justify-center rounded-lg bg-indigo-600/10 text-indigo-500">
            <Icon className="size-5" />
          </div>
          <div className="flex-1 space-y-2">
            <h2 className="font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
          </div>
          <span className="text-sm text-indigo-400 group-hover:text-indigo-300 transition-colors">
            {cta}
          </span>
        </Link>
      ))}
    </div>
  );
}
