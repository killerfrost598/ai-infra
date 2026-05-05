"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useDeployments, useServers, useCreateDeployment } from "@/lib/queries";
import type { ModelDeployment, Server } from "@/lib/types";
import { StatusBadge } from "@/components/StatusBadge";
import { deploymentSchema, type DeploymentFormValues } from "@/lib/schemas";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/layouts/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/layouts/page-states";

export default function DeploymentsPage() {
  const { data, isLoading, error } = useDeployments();
  const deployments: ModelDeployment[] = data?.items ?? [];
  const total = data?.total ?? 0;

  const [showForm, setShowForm] = useState(false);
  const { data: serversData } = useServers(0, 100);
  const servers: Server[] = serversData?.items ?? [];

  const createDeployment = useCreateDeployment();

  const form = useForm<DeploymentFormValues>({
    resolver: zodResolver(deploymentSchema),
    defaultValues: {
      server_id: "", model_name: "", model_alias: "",
      quantization: "", remote_port: 8000, engine: "VLLM", tp_size: 1,
    },
  });

  function onSubmit(values: DeploymentFormValues) {
    createDeployment.mutate(
      {
        server_id: values.server_id,
        model_name: values.model_name,
        model_alias: values.model_alias || undefined,
        quantization: values.quantization || undefined,
        remote_port: values.remote_port,
        engine: values.engine,
        tp_size: values.tp_size,
      },
      { onSuccess: () => { form.reset(); setShowForm(false); } }
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Deployments"
        description={!isLoading ? `${total} total` : "Deploy vLLM/SGLang/Ollama models onto provisioned servers."}
        actions={(
          <Button onClick={() => setShowForm((s) => !s)}>
            {showForm ? "Cancel" : "New deployment"}
          </Button>
        )}
      />

      {showForm && (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)}>
            <Card className="px-5 py-4 space-y-4">
              <h2 className="text-sm font-semibold">New model deployment</h2>

              <div className="grid grid-cols-2 gap-3">
                <div className="col-span-2">
                  <FormField
                    control={form.control}
                    name="server_id"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="text-xs font-medium text-muted-foreground">Server</FormLabel>
                        <FormControl>
                          <select className="input w-full text-sm" {...field}>
                            <option value="">Select a server…</option>
                            {servers.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.hostname} ({s.gpu_model ?? "no GPU"}) — {s.status}
                              </option>
                            ))}
                          </select>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                <FormField
                  control={form.control}
                  name="model_name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground">Model name / HF repo</FormLabel>
                      <FormControl>
                        <Input placeholder="meta-llama/Llama-3-8b-instruct" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="model_alias"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground">
                        Alias <span className="text-muted-foreground/50">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="llama3-8b" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="engine"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground">Engine</FormLabel>
                      <FormControl>
                        <select className="input w-full text-sm" {...field}>
                          <option value="VLLM">vLLM</option>
                          <option value="SGLANG">SGLang</option>
                          <option value="OLLAMA">Ollama</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="quantization"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground">
                        Quantization <span className="text-muted-foreground/50">(optional)</span>
                      </FormLabel>
                      <FormControl>
                        <Input placeholder="awq, gptq, fp8…" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="remote_port"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground">Remote port</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="tp_size"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-medium text-muted-foreground">Tensor parallel size</FormLabel>
                      <FormControl>
                        <Input
                          type="number"
                          {...field}
                          onChange={(e) => field.onChange(e.target.valueAsNumber)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

              </div>

              <div className="flex justify-end">
                <Button type="submit" loading={createDeployment.isPending}>Create deployment</Button>
              </div>
            </Card>
          </form>
        </Form>
      )}

      {isLoading && <LoadingState />}
      {error && <ErrorState message={error.message} />}
      {!isLoading && !error && deployments.length === 0 && !showForm && (
        <EmptyState
          title="No deployments yet."
          description="Create a deployment from a provisioned server."
        />
      )}

      <div className="space-y-2">
        {deployments.map((d) => (
          <Card key={d.id} className="flex items-start gap-4 px-5 py-4">
            <StatusBadge status={d.status} />
            <div className="flex-1 min-w-0">
              <p className="font-medium">{d.model_name}</p>
              {d.model_alias && <p className="text-xs text-muted-foreground">alias: {d.model_alias}</p>}
              <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground/70">
                <span>{d.engine ?? "VLLM"}</span>
                <span>port {d.remote_port}</span>
                {d.quantization && <span>{d.quantization}</span>}
                {d.stack_matrix_id && <span>stack #{d.stack_matrix_id}</span>}
              </div>
              {d.inference_base_url && (
                <p className="mt-1 text-xs font-mono text-emerald-600 dark:text-emerald-400 truncate">
                  {d.inference_base_url}
                </p>
              )}
            </div>
            <div className="shrink-0 text-right text-xs text-muted-foreground">
              {d.started_at
                ? <p>Started {new Date(d.started_at).toLocaleDateString()}</p>
                : <p>Not started</p>}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
