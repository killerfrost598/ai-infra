"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Shield, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";

interface PublishReportDialogProps {
  runId: string;
  onClose: () => void;
}

export function PublishReportDialog({ runId, onClose }: PublishReportDialogProps) {
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);

  const { data: preview, isLoading: previewLoading } = useQuery({
    queryKey: ["run-report-preview", runId],
    queryFn: () => api.runReports.preview(runId),
    staleTime: Infinity,
  });

  const publishMutation = useMutation({
    mutationFn: () => api.runReports.publish(runId),
    onSuccess: (result) => {
      setPublishedUrl(result.url);
      toast.success("Published to GitHub");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold">Publish Run Report</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Review the sanitized JSON below before publishing to GitHub.
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 text-xs">
            Close
          </Button>
        </div>

        {/* Sanitizer notice */}
        <div className="shrink-0 flex items-start gap-2.5 border-b border-border bg-emerald-500/5 px-5 py-3">
          <Shield className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <p className="text-xs text-emerald-700 dark:text-emerald-400">
            IPs, hostnames, file paths under <code>/root/</code>, API keys, and Clore order IDs have been
            stripped. Review carefully before publishing.
          </p>
        </div>

        {/* Preview */}
        <div className="min-h-0 flex-1 overflow-y-auto bg-muted/30 p-4">
          {previewLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Building preview...
            </div>
          ) : (
            <pre className="overflow-x-auto text-[11px] leading-relaxed text-foreground/80">
              {JSON.stringify(preview ?? {}, null, 2)}
            </pre>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 flex items-center justify-between border-t border-border px-5 py-4">
          {publishedUrl ? (
            <a
              href={publishedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-sm text-primary hover:underline"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              View on GitHub
            </a>
          ) : (
            <p className="text-xs text-muted-foreground">
              Requires <code>github_token</code> and <code>github_repo</code> in Settings.
            </p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onClose} className="h-8 text-xs">
              Cancel
            </Button>
            {!publishedUrl && (
              <Button
                size="sm"
                className="h-8 gap-1.5 text-xs"
                onClick={() => publishMutation.mutate()}
                disabled={publishMutation.isPending || previewLoading}
              >
                {publishMutation.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Upload className="h-3 w-3" />
                )}
                Publish to GitHub
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
