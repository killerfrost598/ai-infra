"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Download, FileJson, MessageSquarePlus, RefreshCcw, Send, Square } from "lucide-react";
import { api } from "@/lib/api";
import { useInferenceRoutes } from "@/lib/queries";
import type { InferenceProxyRoute } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/layouts/page-states";
import { PageHeader } from "@/components/layouts/page-header";
import { cn } from "@/lib/utils";

type ChatRole = "system" | "user" | "assistant";

interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

interface SessionMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  tokensPerSecond: number | null;
  ttftMs: number | null;
  costUsd: number | null;
}

interface Conversation {
  id: string;
  title: string;
  routeSlug: string;
  modelName: string;
  messages: ChatMessage[];
  metrics: SessionMetrics;
  createdAt: string;
  updatedAt: string;
}

const STORAGE_KEY = "inferix:chat:conversations:v1";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function initialConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function blankMetrics(): SessionMetrics {
  return {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    tokensPerSecond: null,
    ttftMs: null,
    costUsd: null,
  };
}

function makeConversation(route: InferenceProxyRoute): Conversation {
  const now = new Date().toISOString();
  return {
    id: newId(),
    title: "New chat",
    routeSlug: route.route_slug,
    modelName: route.model_name,
    messages: [],
    metrics: blankMetrics(),
    createdAt: now,
    updatedAt: now,
  };
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  return trimmed ? Math.max(1, Math.round(trimmed.length / 4)) : 0;
}

function contextWindow(route: InferenceProxyRoute | undefined): number | null {
  const profile = route?.profile_json;
  if (!profile) return null;
  const raw = profile.max_model_len ?? profile.context_length ?? profile.contextWindow;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function markdownForConversation(conversation: Conversation): string {
  return [
    `# ${conversation.title}`,
    "",
    `Model: ${conversation.modelName}`,
    `Route: ${conversation.routeSlug}`,
    "",
    ...conversation.messages.flatMap((message) => [
      `## ${message.role}`,
      "",
      message.content,
      "",
    ]),
  ].join("\n");
}

function saveBlob(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ChatPage() {
  const { data, isLoading, error } = useInferenceRoutes();
  const routes = useMemo(() => data?.routes ?? [], [data?.routes]);
  const [conversations, setConversations] = useState<Conversation[]>(initialConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const active = useMemo(
    () => conversations.find((conversation) => conversation.id === activeId) ?? conversations[0],
    [activeId, conversations],
  );
  const selectedRoute = useMemo(
    () => routes.find((route) => route.route_slug === active?.routeSlug) ?? routes[0],
    [active?.routeSlug, routes],
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
  }, [conversations]);

  useEffect(() => {
    if (!routes.length) return;
    if (conversations.length === 0) {
      const conversation = makeConversation(routes[0]);
      setConversations([conversation]);
      setActiveId(conversation.id);
    } else if (!activeId) {
      setActiveId(conversations[0].id);
    }
  }, [activeId, conversations, routes]);

  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
  }, [active?.messages, streaming]);

  function updateConversation(id: string, updater: (conversation: Conversation) => Conversation) {
    setConversations((prev) => prev.map((conversation) => conversation.id === id ? updater(conversation) : conversation));
  }

  function startNewConversation(route = selectedRoute) {
    if (!route) return;
    const conversation = makeConversation(route);
    setConversations((prev) => [conversation, ...prev]);
    setActiveId(conversation.id);
  }

  function changeRoute(routeSlug: string) {
    if (!active) return;
    const route = routes.find((item) => item.route_slug === routeSlug);
    updateConversation(active.id, (conversation) => ({
      ...conversation,
      routeSlug,
      modelName: route?.model_name ?? conversation.modelName,
      updatedAt: new Date().toISOString(),
    }));
  }

  async function sendMessages(baseMessages: ChatMessage[]) {
    if (!active || !selectedRoute || streaming) return;
    const assistantId = newId();
    const startedAt = performance.now();
    const abort = new AbortController();
    abortRef.current = abort;
    setStreaming(true);

    updateConversation(active.id, (conversation) => ({
      ...conversation,
      messages: [...baseMessages, { id: assistantId, role: "assistant", content: "", createdAt: new Date().toISOString() }],
      updatedAt: new Date().toISOString(),
    }));

    let assistantText = "";
    let firstTokenAt: number | null = null;
    let usage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null = null;

    try {
      const response = await fetch(api.inference.proxyUrl(selectedRoute.route_slug, "chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: abort.signal,
        body: JSON.stringify({
          model: selectedRoute.model_name,
          messages: baseMessages.map(({ role, content }) => ({ role, content })),
          stream: true,
          stream_options: { include_usage: true },
          temperature: 0.7,
        }),
      });
      if (!response.ok || !response.body) {
        throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split("\n\n");
        buffer = events.pop() ?? "";
        for (const event of events) {
          const line = event.split("\n").find((item) => item.startsWith("data:"));
          if (!line) continue;
          const payload = line.replace(/^data:\s*/, "");
          if (payload === "[DONE]") continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.usage) usage = parsed.usage;
            const delta = parsed.choices?.[0]?.delta?.content;
            if (typeof delta === "string" && delta.length > 0) {
              if (firstTokenAt === null) firstTokenAt = performance.now();
              assistantText += delta;
              updateConversation(active.id, (conversation) => ({
                ...conversation,
                messages: conversation.messages.map((message) =>
                  message.id === assistantId ? { ...message, content: assistantText } : message,
                ),
                updatedAt: new Date().toISOString(),
              }));
            }
          } catch {
            continue;
          }
        }
      }

      const elapsedSeconds = Math.max(0.001, (performance.now() - startedAt) / 1000);
      const inputTokens = usage?.prompt_tokens ?? baseMessages.reduce((sum, message) => sum + estimateTokens(message.content), 0);
      const outputTokens = usage?.completion_tokens ?? estimateTokens(assistantText);
      const totalTokens = usage?.total_tokens ?? inputTokens + outputTokens;
      const ttftMs = firstTokenAt === null ? null : Math.round(firstTokenAt - startedAt);
      const costUsd = selectedRoute.hourly_cost_usd == null ? null : (elapsedSeconds / 3600) * selectedRoute.hourly_cost_usd;

      updateConversation(active.id, (conversation) => ({
        ...conversation,
        title: conversation.title === "New chat"
          ? (baseMessages.find((message) => message.role === "user")?.content.slice(0, 48) || "New chat")
          : conversation.title,
        metrics: {
          inputTokens: conversation.metrics.inputTokens + inputTokens,
          outputTokens: conversation.metrics.outputTokens + outputTokens,
          totalTokens: conversation.metrics.totalTokens + totalTokens,
          tokensPerSecond: outputTokens > 0 ? Number((outputTokens / elapsedSeconds).toFixed(2)) : conversation.metrics.tokensPerSecond,
          ttftMs,
          costUsd: costUsd == null
            ? conversation.metrics.costUsd
            : Number(((conversation.metrics.costUsd ?? 0) + costUsd).toFixed(6)),
        },
        updatedAt: new Date().toISOString(),
      }));
    } catch (err) {
      if (!abort.signal.aborted) {
        updateConversation(active.id, (conversation) => ({
          ...conversation,
          messages: conversation.messages.map((message) =>
            message.id === assistantId
              ? { ...message, content: err instanceof Error ? err.message : "Request failed" }
              : message,
          ),
        }));
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!active || !input.trim()) return;
    const userMessage: ChatMessage = {
      id: newId(),
      role: "user",
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };
    const baseMessages = [...active.messages, userMessage];
    setInput("");
    updateConversation(active.id, (conversation) => ({
      ...conversation,
      messages: baseMessages,
      updatedAt: new Date().toISOString(),
    }));
    void sendMessages(baseMessages);
  }

  function stopStreaming() {
    abortRef.current?.abort();
    setStreaming(false);
  }

  function regenerate() {
    if (!active || streaming) return;
    const trimmed = active.messages.at(-1)?.role === "assistant" ? active.messages.slice(0, -1) : active.messages;
    if (!trimmed.some((message) => message.role === "user")) return;
    updateConversation(active.id, (conversation) => ({ ...conversation, messages: trimmed }));
    void sendMessages(trimmed);
  }

  function exportJson() {
    if (!active) return;
    saveBlob(`${active.title || "chat"}.json`, JSON.stringify(active, null, 2), "application/json");
  }

  function exportMarkdown() {
    if (!active) return;
    saveBlob(`${active.title || "chat"}.md`, markdownForConversation(active), "text/markdown");
  }

  const maxContext = contextWindow(selectedRoute);
  const contextUsed = active?.metrics.totalTokens ?? 0;
  const contextPct = maxContext ? Math.min(100, Math.round((contextUsed / maxContext) * 100)) : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Chat"
        description="Talk to running models through the Inferix proxy."
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => startNewConversation()} disabled={!selectedRoute}>
              <MessageSquarePlus className="size-3.5" />
              New
            </Button>
            <Button variant="outline" size="sm" onClick={exportJson} disabled={!active}>
              <FileJson className="size-3.5" />
              JSON
            </Button>
            <Button variant="outline" size="sm" onClick={exportMarkdown} disabled={!active}>
              <Download className="size-3.5" />
              Markdown
            </Button>
          </div>
        )}
      />

      {error && <ErrorState message={error.message} />}
      {isLoading && <LoadingState text="Loading running models..." />}
      {!isLoading && !error && routes.length === 0 && (
        <EmptyState title="No running models" description="Start a model from Lab to create a proxy route." />
      )}

      {routes.length > 0 && active && (
        <div className="grid min-h-[calc(100vh-12rem)] gap-4 xl:grid-cols-[220px_minmax(0,1fr)_280px]">
          <Card className="overflow-hidden">
            <div className="border-b border-border px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Conversations</p>
            </div>
            <div className="max-h-[calc(100vh-15rem)] overflow-y-auto p-2">
              {conversations.map((conversation) => (
                <button
                  key={conversation.id}
                  onClick={() => setActiveId(conversation.id)}
                  className={cn(
                    "mb-1 w-full rounded-md px-3 py-2 text-left text-sm transition-colors",
                    conversation.id === active.id ? "bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  <span className="line-clamp-2">{conversation.title}</span>
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">{conversation.modelName}</span>
                </button>
              ))}
            </div>
          </Card>

          <Card className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
              <Bot className="size-4 text-muted-foreground" />
              <select
                value={selectedRoute?.route_slug ?? ""}
                onChange={(event) => changeRoute(event.target.value)}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm"
                disabled={streaming}
              >
                {routes.map((route) => (
                  <option key={route.id} value={route.route_slug}>
                    {route.model_name} · {route.route_slug}
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={regenerate} disabled={streaming || active.messages.length === 0}>
                <RefreshCcw className="size-3.5" />
                Regenerate
              </Button>
            </div>

            <div ref={scrollerRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-5">
              {active.messages.length === 0 && (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">
                  Start a conversation with {selectedRoute?.model_name}.
                </div>
              )}
              {active.messages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    "max-w-[84%] rounded-lg px-4 py-3 text-sm leading-relaxed",
                    message.role === "user"
                      ? "ml-auto bg-primary text-primary-foreground"
                      : "bg-muted text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap">{message.content}</p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="border-t border-border p-3">
              <div className="flex gap-2">
                <textarea
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      event.currentTarget.form?.requestSubmit();
                    }
                  }}
                  placeholder="Message"
                  className="input min-h-[48px] flex-1 resize-none text-sm"
                  disabled={streaming}
                />
                {streaming ? (
                  <Button type="button" onClick={stopStreaming} className="h-12">
                    <Square className="size-3.5" />
                    Stop
                  </Button>
                ) : (
                  <Button type="submit" className="h-12" disabled={!input.trim()}>
                    <Send className="size-3.5" />
                    Send
                  </Button>
                )}
              </div>
            </form>
          </Card>

          <Card className="h-fit px-4 py-4">
            <p className="text-sm font-semibold">Live Performance</p>
            <div className="mt-4 space-y-3">
              <Metric label="Tokens/sec" value={active.metrics.tokensPerSecond?.toFixed(2) ?? "-"} />
              <Metric label="TTFT" value={active.metrics.ttftMs == null ? "-" : `${active.metrics.ttftMs} ms`} />
              <Metric label="Input tokens" value={String(active.metrics.inputTokens)} />
              <Metric label="Output tokens" value={String(active.metrics.outputTokens)} />
              <Metric label="Cost" value={active.metrics.costUsd == null ? "-" : `$${active.metrics.costUsd.toFixed(6)}`} />
            </div>
            <div className="mt-5">
              <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                <span>Context</span>
                <span>{maxContext ? `${contextUsed}/${maxContext}` : `${contextUsed}`}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${contextPct}%` }} />
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 pb-2 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-sm font-medium">{value}</span>
    </div>
  );
}
