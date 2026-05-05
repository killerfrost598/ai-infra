"use client";

import Link from "next/link";
import { type ColumnDef } from "@tanstack/react-table";
import { useTaskRuns } from "@/lib/queries";
import type { TaskRun } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { DataTable } from "@/components/ui/data-table";
import { PageHeader } from "@/components/layouts/page-header";
import { ErrorState, LoadingState } from "@/components/layouts/page-states";

const ACTIVE = new Set(["PENDING", "RUNNING"]);

const TASK_LABELS: Record<string, string> = {
  "servers.provision": "Server Provision",
  "servers.terminate": "Server Terminate",
  "deployments.deploy": "Model Deploy",
  "ssh.execute_command": "SSH Command",
  "playbooks.run": "Playbook Run",
  "health.ping": "Health Check",
};

const columns: ColumnDef<TaskRun>[] = [
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ getValue }) => <StatusBadge status={getValue() as string} />,
  },
  {
    accessorKey: "task_type",
    header: "Task",
    cell: ({ row }) => (
      <Link href={`/task-runs/${row.original.id}`} className="block hover:text-foreground transition-colors">
        <span className="font-medium">
          {TASK_LABELS[row.original.task_type] ?? row.original.task_type}
        </span>
        {row.original.metadata_json?.command != null && (
          <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground/60">
            $ {String(row.original.metadata_json.command)}
          </span>
        )}
        {row.original.error_summary && (
          <span className="mt-0.5 block truncate text-xs text-destructive">{row.original.error_summary}</span>
        )}
      </Link>
    ),
  },
  {
    accessorKey: "started_at",
    header: "Started",
    cell: ({ getValue }) => {
      const v = getValue() as string | null;
      return v ? (
        <span className="text-xs text-muted-foreground whitespace-nowrap">{new Date(v).toLocaleString()}</span>
      ) : (
        <span className="text-xs text-muted-foreground/60">queued</span>
      );
    },
  },
  {
    accessorKey: "duration_seconds",
    header: "Duration",
    cell: ({ getValue }) => {
      const v = getValue() as number | null;
      return v != null
        ? <span className="text-xs text-muted-foreground whitespace-nowrap">{v}s</span>
        : <span className="text-muted-foreground/30">—</span>;
    },
  },
  {
    id: "open",
    header: "",
    cell: ({ row }) => (
      <Link href={`/task-runs/${row.original.id}`} className="text-xs text-muted-foreground hover:text-foreground transition-colors whitespace-nowrap">
        Open →
      </Link>
    ),
  },
];

export default function TaskRunsPage() {
  const { data, isLoading, error } = useTaskRuns(undefined, 50);
  const runs: TaskRun[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const activeCount = runs.filter((r) => ACTIVE.has(r.status)).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Task Runs"
        description={!isLoading ? `${total} total` : "Track asynchronous task progress and inspect execution output."}
        actions={activeCount > 0 ? (
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-800 bg-amber-950/50 px-2.5 py-0.5 text-xs text-amber-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
            {activeCount} active
          </span>
        ) : undefined}
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error.message} />}

      {!isLoading && (
        <DataTable
          columns={columns}
          data={runs}
          emptyMessage="No task runs yet. Task runs are created automatically when you register servers or run SSH commands."
        />
      )}
    </div>
  );
}
