"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, RotateCcw, Save, Terminal } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useDeleteSetting, useSaveSetting, useSettings } from "@/lib/queries";
import type { DeploymentPlanStep } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layouts/page-header";
import { ErrorState, LoadingState } from "@/components/layouts/page-states";

const SETTING_KEY = "lab_preflight_command_overrides";

interface CommandOverride {
  enabled?: boolean;
  required?: boolean;
  recommended?: boolean;
  command?: string;
  notes?: string;
}

interface CommandRow {
  id: string;
  title: string;
  stage: string;
  command: string;
  defaultCommand: string;
  enabled: boolean;
  defaultEnabled: boolean;
  required: boolean;
  defaultRequired: boolean;
  recommended: boolean;
  defaultRecommended: boolean;
  expected: string;
  notes: string;
  defaultNotes: string;
}

function parseOverrides(raw?: string | null): Record<string, CommandOverride> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, CommandOverride>;
  } catch {
    return {};
  }
}

function rowsFromTemplates(templates: DeploymentPlanStep[], overrides: Record<string, CommandOverride>): CommandRow[] {
  return templates.map((template) => {
    const patch = overrides[template.id] ?? {};
    const defaultCommand = template.command ?? "";
    const defaultNotes = template.notes ?? "";
    return {
      id: template.id,
      title: template.title,
      stage: template.stage,
      command: typeof patch.command === "string" ? patch.command : defaultCommand,
      defaultCommand,
      enabled: patch.enabled !== false,
      defaultEnabled: true,
      required: typeof patch.required === "boolean" ? patch.required : template.required,
      defaultRequired: template.required,
      recommended: typeof patch.recommended === "boolean" ? patch.recommended : template.recommended,
      defaultRecommended: template.recommended,
      expected: template.expected ?? "",
      notes: typeof patch.notes === "string" ? patch.notes : defaultNotes,
      defaultNotes,
    };
  });
}

function buildOverrides(rows: CommandRow[]): Record<string, CommandOverride> {
  const overrides: Record<string, CommandOverride> = {};
  for (const row of rows) {
    const patch: CommandOverride = {};
    if (row.enabled !== row.defaultEnabled) patch.enabled = row.enabled;
    if (row.required !== row.defaultRequired) patch.required = row.required;
    if (row.recommended !== row.defaultRecommended) patch.recommended = row.recommended;
    if (row.command.trim() !== row.defaultCommand.trim()) patch.command = row.command.trim();
    if (row.notes.trim() !== row.defaultNotes.trim()) patch.notes = row.notes.trim();
    if (Object.keys(patch).length > 0) overrides[row.id] = patch;
  }
  return overrides;
}

export default function PreflightSettingsPage() {
  const { data: settingsData, isLoading: settingsLoading, error: settingsError } = useSettings();
  const { data: templates, isLoading: templatesLoading, error: templatesError } = useQuery({
    queryKey: ["lab", "preflight-command-templates"],
    queryFn: () => api.lab.preflightCommandTemplates(),
  });
  const saveSetting = useSaveSetting();
  const deleteSetting = useDeleteSetting();
  const [rows, setRows] = useState<CommandRow[]>([]);

  const rawOverrides = settingsData?.settings.find((setting) => setting.key === SETTING_KEY)?.value ?? "";
  const overrides = useMemo(() => parseOverrides(rawOverrides), [rawOverrides]);

  useEffect(() => {
    if (!templates) return;
    setRows(rowsFromTemplates(templates, overrides));
  }, [templates, overrides]);

  const isLoading = settingsLoading || templatesLoading;
  const error = settingsError ?? templatesError;
  const changedCount = Object.keys(buildOverrides(rows)).length;

  function updateRow(id: string, patch: Partial<CommandRow>) {
    setRows((prev) => prev.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  function resetRow(id: string) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === id
          ? {
              ...row,
              enabled: row.defaultEnabled,
              required: row.defaultRequired,
              recommended: row.defaultRecommended,
              command: row.defaultCommand,
              notes: row.defaultNotes,
            }
          : row,
      ),
    );
  }

  function save() {
    const payload = JSON.stringify(buildOverrides(rows), null, 2);
    saveSetting.mutate(
      { key: SETTING_KEY, value: payload },
      { onSuccess: () => toast.success("Preflight command settings saved") },
    );
  }

  function resetAll() {
    deleteSetting.mutate(SETTING_KEY, {
      onSuccess: () => {
        if (templates) setRows(rowsFromTemplates(templates, {}));
        toast.success("Preflight commands reset");
      },
    });
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Preflight Commands"
        description="Configure the low-risk commands Lab can recommend or auto-run before model launch."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm" className="gap-1.5">
              <Link href="/settings">Settings</Link>
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5" onClick={resetAll} loading={deleteSetting.isPending}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset all
            </Button>
            <Button size="sm" className="gap-1.5" onClick={save} loading={saveSetting.isPending} disabled={rows.length === 0}>
              <Save className="h-3.5 w-3.5" />
              Save
            </Button>
          </div>
        }
      />

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error.message} />}

      {!isLoading && !error && (
        <>
          <Card className="border-amber-500/25 bg-amber-500/10 px-4 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-sm text-muted-foreground">
                These commands execute over an isolated SSH exec channel, not the visible PTY. Use placeholders like{" "}
                <code className="text-foreground/70">{"{venv_id}"}</code>,{" "}
                <code className="text-foreground/70">{"{packages}"}</code>, and{" "}
                <code className="text-foreground/70">{"{remote_port}"}</code> where needed.
              </p>
            </div>
          </Card>

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              {rows.length} command templates
            </p>
            <span className="rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground">
              {changedCount} changed
            </span>
          </div>

          <div className="space-y-4">
            {rows.map((row) => {
              const changed = row.command.trim() !== row.defaultCommand.trim()
                || row.enabled !== row.defaultEnabled
                || row.required !== row.defaultRequired
                || row.recommended !== row.defaultRecommended
                || row.notes.trim() !== row.defaultNotes.trim();

              return (
                <Card key={row.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
                          {row.stage}
                        </span>
                        <p className="font-semibold">{row.title}</p>
                        {changed && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2 py-0.5 text-[10px] text-primary">
                            <Check className="h-3 w-3" />
                            changed
                          </span>
                        )}
                      </div>
                      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{row.expected || row.id}</p>
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5" onClick={() => resetRow(row.id)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Reset
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_220px]">
                    <div>
                      <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                        <Terminal className="h-3.5 w-3.5" />
                        Command
                      </label>
                      <textarea
                        className="input min-h-[108px] w-full resize-y font-mono text-xs leading-relaxed"
                        value={row.command}
                        spellCheck={false}
                        onChange={(event) => updateRow(row.id, { command: event.target.value })}
                      />
                    </div>

                    <div className="space-y-3 rounded-md border border-border bg-muted/20 p-3">
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border"
                          checked={row.enabled}
                          onChange={(event) => updateRow(row.id, { enabled: event.target.checked })}
                        />
                        Enabled
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border"
                          checked={row.required}
                          onChange={(event) => updateRow(row.id, { required: event.target.checked })}
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-border"
                          checked={row.recommended}
                          onChange={(event) => updateRow(row.id, { recommended: event.target.checked })}
                        />
                        Recommend-only gate
                      </label>
                      <textarea
                        className="input min-h-[76px] w-full resize-y text-xs"
                        placeholder="Operator note"
                        value={row.notes}
                        onChange={(event) => updateRow(row.id, { notes: event.target.value })}
                      />
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
