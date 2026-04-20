import Link from "next/link";
import { Card } from "@/components/ui/card";

const sections = [
  {
    href: "/servers",
    label: "Servers",
    description: "Register and provision GPU machines via SSH or Clore.ai rental.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="2" width="20" height="8" rx="2" />
        <rect x="2" y="14" width="20" height="8" rx="2" />
        <line x1="6" y1="6" x2="6.01" y2="6" />
        <line x1="6" y1="18" x2="6.01" y2="18" />
      </svg>
    ),
    color: "text-indigo-400",
    bg: "bg-indigo-500/10",
  },
  {
    href: "/deployments",
    label: "Deployments",
    description: "Launch vLLM containers on provisioned servers and track their lifecycle.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2L2 7l10 5 10-5-10-5z" />
        <path d="M2 17l10 5 10-5" />
        <path d="M2 12l10 5 10-5" />
      </svg>
    ),
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
  },
  {
    href: "/playbooks",
    label: "Playbooks",
    description: "Git-tracked shell playbooks for repeatable infrastructure automation.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
    color: "text-amber-400",
    bg: "bg-amber-500/10",
  },
  {
    href: "/task-runs",
    label: "Task Runs",
    description: "Inspect async job history, SSH command output, and error traces.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
    color: "text-violet-400",
    bg: "bg-violet-500/10",
  },
  {
    href: "/lab",
    label: "Lab",
    description: "Split-pane terminal + command history + playbook builder in one view.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v11m0 0H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-4m-6 0h6" />
      </svg>
    ),
    color: "text-sky-400",
    bg: "bg-sky-500/10",
  },
  {
    href: "/benchmarks",
    label: "Benchmarks",
    description: "Record and query GPU inference benchmarks by model and quantization.",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <line x1="18" y1="20" x2="18" y2="10" />
        <line x1="12" y1="20" x2="12" y2="4" />
        <line x1="6" y1="20" x2="6" y2="14" />
        <line x1="2" y1="20" x2="22" y2="20" />
      </svg>
    ),
    color: "text-rose-400",
    bg: "bg-rose-500/10",
  },
];

export default function DocsPage() {
  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-emerald-800 bg-emerald-950/60 px-2.5 py-0.5 text-xs text-emerald-400">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            System online
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight">AI Inference Platform</h1>
        <p className="max-w-xl text-muted-foreground">
          Single-operator GPU ops platform. Rent Clore.ai servers, provision them over SSH,
          deploy vLLM models, and track inference benchmarks.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link key={s.href} href={s.href}>
            <Card className="group flex gap-4 p-5 cursor-pointer transition-all hover:border-muted-foreground/30 hover:shadow-lg hover:shadow-black/20">
              <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.bg} ${s.color}`}>
                {s.icon}
              </div>
              <div>
                <p className="font-semibold group-hover:text-foreground">{s.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{s.description}</p>
              </div>
            </Card>
          </Link>
        ))}
      </div>

      <Card className="px-5 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Stack</p>
        <div className="grid grid-cols-3 gap-4 text-sm sm:grid-cols-5">
          {[
            ["FastAPI", "API"],
            ["Celery", "Workers"],
            ["PostgreSQL", "Database"],
            ["Redis", "Broker"],
            ["vLLM", "Inference"],
          ].map(([name, role]) => (
            <div key={name}>
              <p className="font-medium">{name}</p>
              <p className="text-xs text-muted-foreground">{role}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="px-5 py-4">
        <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-muted-foreground">Architecture decisions</p>
        <div className="space-y-2 text-sm text-muted-foreground">
          {[
            ["ADR-001", "Single-user app — internal ops tool, no auth middleware"],
            ["ADR-002", "Celery for async tasks; sync handlers for interactive SSH sessions"],
            ["ADR-003", "Sentinel pattern for SSH output capture (PROMPT_COMMAND injection)"],
            ["ADR-006", "Partial clore-ai SDK bypass — my_orders/create_order via raw httpx"],
            ["ADR-007", "LiteLLM removed — vLLM speaks OpenAI natively; saved ~400 MB RAM"],
            ["ADR-010", "shadcn/ui + Tailwind v4 rewrite with TanStack Query"],
          ].map(([id, desc]) => (
            <div key={id} className="flex gap-3">
              <span className="shrink-0 font-mono text-xs text-muted-foreground/50 mt-0.5">{id}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
