const config: Record<string, { dot: string; text: string; label?: string; pulse?: boolean }> = {
  NEW:          { dot: "bg-zinc-500",    text: "text-zinc-400" },
  PROVISIONING: { dot: "bg-amber-400",   text: "text-amber-400", pulse: true },
  READY:        { dot: "bg-emerald-400", text: "text-emerald-400" },
  FAILED:       { dot: "bg-rose-500",    text: "text-rose-400" },
  TERMINATED:   { dot: "bg-zinc-600",    text: "text-zinc-500" },
  PENDING:      { dot: "bg-zinc-500",    text: "text-zinc-400" },
  DEPLOYING:    { dot: "bg-amber-400",   text: "text-amber-400", pulse: true },
  RUNNING:      { dot: "bg-emerald-400", text: "text-emerald-400", pulse: true },
  STOPPED:      { dot: "bg-zinc-600",    text: "text-zinc-500" },
  SUCCESS:      { dot: "bg-emerald-400", text: "text-emerald-400" },
  PARTIAL:      { dot: "bg-amber-400",   text: "text-amber-400" },
};

export function StatusBadge({ status }: { status: string }) {
  const c = config[status] ?? { dot: "bg-zinc-500", text: "text-zinc-400" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${c.dot} ${c.pulse ? "animate-pulse" : ""}`}
      />
      {status}
    </span>
  );
}
