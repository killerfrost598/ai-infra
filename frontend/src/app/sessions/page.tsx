"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { SessionListItem } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";

export default function SessionsPage() {
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.sessions
      .list(undefined, undefined, 0, 50)
      .then((res) => { setSessions(res.items); setTotal(res.total); })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-zinc-100">SSH Sessions</h1>
          {!loading && (
            <p className="mt-0.5 text-sm text-zinc-500">{total} session{total !== 1 ? "s" : ""}</p>
          )}
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-900 bg-rose-950/40 px-4 py-3 text-sm text-rose-400">{error}</p>
      )}

      {loading && (
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-zinc-700 border-t-zinc-400" />
          Loading…
        </div>
      )}

      {!loading && !error && sessions.length === 0 && (
        <div className="card px-6 py-10 text-center">
          <p className="text-sm text-zinc-500">No sessions yet.</p>
          <p className="mt-1 text-xs text-zinc-600">Start a session from a server detail page.</p>
        </div>
      )}

      {sessions.length > 0 && (
        <div className="space-y-2">
          {sessions.map((s) => (
            <Link
              key={s.id}
              href={`/sessions/${s.id}`}
              className="card flex items-center gap-4 px-4 py-3 hover:border-zinc-700 transition-colors"
            >
              <StatusBadge status={s.status} />

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-zinc-200">
                  {s.label ?? <span className="text-zinc-500 italic">unlabeled</span>}
                </p>
                <p className="mt-0.5 truncate text-xs text-zinc-500">
                  {s.server_hostname ?? s.server_id}
                </p>
              </div>

              <div className="shrink-0 text-right text-xs text-zinc-500 space-y-0.5">
                {s.has_pty_log ? (
                  <span className="inline-flex items-center gap-1 text-indigo-400">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
                    </svg>
                    terminal
                  </span>
                ) : (
                  <p>{s.command_count} cmd{s.command_count !== 1 ? "s" : ""}</p>
                )}
                <p>{new Date(s.started_at).toLocaleString()}</p>
                {s.terminated_at && (
                  <p className="text-zinc-600">ended {new Date(s.terminated_at).toLocaleString()}</p>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
