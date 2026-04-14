import Link from "next/link";

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
    description: "Git-tracked Ansible playbooks for repeatable infrastructure automation.",
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
];

export default function HomePage() {
  return (
    <div className="space-y-10">
      {/* Hero */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-emerald-800 bg-emerald-950/60 px-2.5 py-0.5 text-xs text-emerald-400">
            <span className="mr-1.5 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            System online
          </span>
        </div>
        <h1 className="text-4xl font-bold tracking-tight text-zinc-100">
          AI Inference Platform
        </h1>
        <p className="max-w-xl text-zinc-400">
          One control plane to rent GPU servers, provision them over SSH, deploy vLLM models,
          and route all traffic through a unified OpenAI-compatible gateway.
        </p>
      </div>

      {/* Quick nav cards */}
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="card group flex gap-4 p-5 transition-all hover:border-zinc-700 hover:shadow-lg hover:shadow-black/20"
          >
            <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${s.bg} ${s.color}`}>
              {s.icon}
            </div>
            <div>
              <p className="font-semibold text-zinc-100 group-hover:text-white">{s.label}</p>
              <p className="mt-0.5 text-sm text-zinc-500">{s.description}</p>
            </div>
          </Link>
        ))}
      </div>

      {/* Stack info */}
      <div className="rounded-xl border border-zinc-800/60 bg-zinc-900/30 px-5 py-4">
        <p className="section-label mb-3">Stack</p>
        <div className="grid grid-cols-3 gap-4 text-sm sm:grid-cols-6">
          {[
            ["FastAPI", "API"],
            ["Celery", "Workers"],
            ["PostgreSQL", "Database"],
            ["Redis", "Broker"],
            ["vLLM", "Inference"],
            ["LiteLLM", "Gateway"],
          ].map(([name, role]) => (
            <div key={name}>
              <p className="font-medium text-zinc-200">{name}</p>
              <p className="text-xs text-zinc-500">{role}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
