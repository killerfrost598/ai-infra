"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Loader2, Shield, Upload } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from "@/components/ui/dialog";
import { api } from "@/lib/api";

interface PublishReportDialogProps {
  runId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PublishReportDialog({ runId, open, onOpenChange }: PublishReportDialogProps) {
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Publish Run Report</DialogTitle>
          <DialogDescription>
            Review the sanitized JSON below before publishing to GitHub.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="p-0 gap-0">
          {/* Sanitizer notice */}
          <div className="flex items-start gap-2.5 border-b border-border bg-emerald-500/5 px-6 py-3 shrink-0">
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
        </DialogBody>

        <DialogFooter className="sm:justify-between">
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
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {!publishedUrl && (
              <Button
                onClick={() => publishMutation.mutate()}
                loading={publishMutation.isPending}
                disabled={previewLoading}
              >
                <Upload className="h-3 w-3" />
                Publish to GitHub
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
