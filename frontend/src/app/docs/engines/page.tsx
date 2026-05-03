"use client";

import { useState } from "react";
import Link from "next/link";

// ── Types ─────────────────────────────────────────────────────────────────────

type Engine = "vllm" | "sglang" | "ollama";

// ── Static data ───────────────────────────────────────────────────────────────

const ENGINE_BADGE: Record<Engine, string> = {
  vllm:   "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sglang: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  ollama: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

const FEATURES = [
  {
    name: "Continuous batching",
    engines: ["vllm", "sglang"] as Engine[],
    highlight: true,
    body: "New requests join the batch mid-generation. At 50 concurrent users the difference is 50× throughput vs 1×. Ollama runs one request start-to-finish then starts the next.",
  },
  {
    name: "PagedAttention",
    engines: ["vllm", "sglang"] as Engine[],
    highlight: true,
    body: "KV-cache in 16-token pages allocated on-demand and freed immediately on completion. Static allocators (Ollama) pre-reserve the full context window — 90%+ wasted. PagedAttention cuts waste to under 4%.",
  },
  {
    name: "RadixAttention (prefix cache)",
    engines: ["sglang"] as Engine[],
    highlight: true,
    body: "SGLang's trie-based prefix cache. Shared system prompts, RAG chunks, and tool schemas computed once and reused. On chatbot/RAG workloads: 75–95% cache hit rates, 3–6× effective throughput gain.",
  },
  {
    name: "Tensor parallel (multi-GPU)",
    engines: ["vllm", "sglang"] as Engine[],
    highlight: false,
    body: "Models too large for one GPU split across multiple at the layer level. --tensor-parallel-size 2 (vLLM) / --tp-size 2 (SGLang). Required for 70B BF16 across 2× 40GB GPUs.",
  },
  {
    name: "Speculative decoding",
    engines: ["sglang", "vllm"] as Engine[],
    highlight: false,
    body: "A small draft model proposes N tokens; the main model verifies in one pass. Typical 1.5–2.5× output speed on chat/code. SGLang has deeper integration with MTP heads (Qwen3, DeepSeek).",
  },
  {
    name: "Reasoning parser",
    engines: ["vllm", "sglang"] as Engine[],
    highlight: false,
    body: "Qwen3, DeepSeek-R1 emit <think>...</think> blocks before the answer. --reasoning-parser qwen3 / deepseek-r1 strips the CoT into a separate API field. Without it, raw thinking text leaks into your app.",
  },
  {
    name: "Structured output / grammar",
    engines: ["sglang"] as Engine[],
    highlight: false,
    body: "SGLang compiles JSON schema and grammar automata once and caches them via RadixAttention. 1000 tool-call requests pay the compile cost once. Ollama supports basic JSON mode but does not cache grammars.",
  },
  {
    name: "Zero-config local deployment",
    engines: ["ollama"] as Engine[],
    highlight: false,
    body: "Single command: ollama run qwen3:8b. No Python environment, no GPU memory tuning. Perfect for solo dev, exploration, and machines with limited VRAM. Hot-swap models in seconds.",
  },
];

const DECISION_ROWS = [
  { scenario: "Single developer, local experimentation",    ollama: { good: true,  text: "Perfect — 1 command, zero config" },         vllm: { good: false, text: "Overkill — 60s cold start, Python env needed" } },
  { scenario: "1–4 concurrent users",                       ollama: { good: true,  text: "Fine at low load" },                          vllm: { good: true,  text: "Works but overhead not worth it" } },
  { scenario: "5–50+ concurrent users",                     ollama: { good: false, text: "Users 2–50 wait; GPU idle" },                  vllm: { good: true,  text: "All served in parallel, GPU fully utilised" } },
  { scenario: "Production API (public or internal)",        ollama: { good: false, text: "No scheduler, no priority, no preemption" },   vllm: { good: true,  text: "Built for this — SLA-grade serving" } },
  { scenario: "RAG / chatbot with shared context",          ollama: { good: false, text: "Recomputes system prompt every request" },     vllm: { good: true,  text: "SGLang caches it — 75–95% compute saved" } },
  { scenario: "Models that change frequently",              ollama: { good: true,  text: "Hot-swap in seconds via ollama pull" },        vllm: { good: null,  text: "vLLM / SGLang ~60s reload" } },
  { scenario: "Non-NVIDIA hardware (AMD, Apple M-series)",  ollama: { good: true,  text: "Native support — just works" },               vllm: { good: null,  text: "vLLM: AMD supported; SGLang: limited AMD" } },
  { scenario: "Long-context 100K+ token documents",         ollama: { good: false, text: "Blocks server for all other users" },          vllm: { good: true,  text: "Chunked prefill isolates the impact" } },
  { scenario: "Agent loops / tool calling at scale",        ollama: { good: null,  text: "Works but each tool call is sequential" },    vllm: { good: true,  text: "SGLang grammar cache + batch tool calls" } },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EnginesPage() {
  return (
    <div className="space-y-10 pb-12">
      {/* Intro */}
      <section className="space-y-3">
        <SectionHeading>The concurrency problem</SectionHeading>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-2xl">
          Ollama processes one request at a time. Every other user waits in a queue while the GPU
          sits mostly idle. vLLM and SGLang use <strong className="text-foreground">continuous
          batching</strong> — new requests join the current batch mid-generation. The GPU never
          idles between tokens.
        </p>
        <ConcurrencyDemo />
      </section>

      {/* Features */}
      <section className="space-y-4">
        <SectionHeading>What vLLM and SGLang have that Ollama doesn't</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2">
          {FEATURES.map((f) => (
            <div
              key={f.name}
              className={`rounded-lg border p-4 space-y-2 ${
                f.highlight ? "border-indigo-500/40 bg-indigo-500/5" : "border-border bg-card"
              }`}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">{f.name}</span>
                {f.engines.map((e) => (
                  <span key={e} className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ENGINE_BADGE[e]}`}>
                    {e}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Decision table */}
      <section className="space-y-4">
        <SectionHeading>When to use each engine</SectionHeading>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground min-w-[200px]">Scenario</th>
                <th className="pb-2 pr-4 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground min-w-[160px]">Ollama</th>
                <th className="pb-2 text-left text-[10px] font-medium uppercase tracking-wider text-muted-foreground min-w-[220px]">vLLM / SGLang</th>
              </tr>
            </thead>
            <tbody>
              {DECISION_ROWS.map((row) => (
                <tr key={row.scenario} className="border-b border-border/50">
                  <td className="py-2.5 pr-4 text-foreground/80">{row.scenario}</td>
                  <td className={`py-2.5 pr-4 ${
                    row.ollama.good === true ? "text-emerald-600 dark:text-emerald-400" :
                    row.ollama.good === false ? "text-rose-600 dark:text-rose-400" :
                    "text-yellow-600 dark:text-yellow-400"
                  }`}>{row.ollama.text}</td>
                  <td className={`py-2.5 ${
                    row.vllm.good === true ? "text-emerald-600 dark:text-emerald-400" :
                    row.vllm.good === false ? "text-rose-600 dark:text-rose-400" :
                    "text-yellow-600 dark:text-yellow-400"
                  }`}>{row.vllm.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Deploy CTAs */}
      <section className="space-y-3">
        <SectionHeading>Deploy on a rented GPU</SectionHeading>
        <p className="text-sm text-muted-foreground">
          Browse the Clore marketplace, click any GPU card to open the Model Advisor, and pick the
          engine that fits your workload. Recommended flags are pre-populated.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <EngineCta engine="vllm"   description="Continuous batching + PagedAttention. Best for 4+ concurrent users." />
          <EngineCta engine="sglang" description="RadixAttention + continuous batching. Best for agents, RAG, and high-throughput APIs." />
          <EngineCta engine="ollama" description="Zero-config deployment. Best for solo dev and low-concurrency experimentation." />
        </div>
      </section>
    </div>
  );
}

// ── Concurrency demo ──────────────────────────────────────────────────────────

function ConcurrencyDemo() {
  const [users, setUsers] = useState(6);
  const gpuUtil = Math.min(99, 70 + users * 3);

  return (
    <div className="rounded-xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-4 flex-wrap">
        <label className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Concurrent users
        </label>
        <input
          type="range"
          min={1}
          max={16}
          step={1}
          value={users}
          onChange={(e) => setUsers(Number(e.target.value))}
          className="w-40 accent-indigo-600"
        />
        <span className="text-sm font-semibold w-4">{users}</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {/* Ollama side */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">Ollama</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ENGINE_BADGE.ollama}`}>
              sequential
            </span>
          </div>
          <div className="space-y-1">
            {Array.from({ length: users }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 text-right text-[10px] text-muted-foreground">User {i + 1}</span>
                <div className="flex-1 h-5 rounded bg-muted/40 overflow-hidden">
                  {i === 0 ? (
                    <div className="h-full w-3/5 rounded bg-emerald-500/80 flex items-center px-2">
                      <span className="text-[9px] text-white font-medium">generating</span>
                    </div>
                  ) : (
                    <div className="h-full w-11/12 rounded bg-rose-500/30 border border-rose-500/40 flex items-center px-2">
                      <span className="text-[9px] text-rose-400">waiting…</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <StatPill label="Serving" value="1" bad />
            <StatPill label="Waiting" value={String(users - 1)} bad />
            <StatPill label="GPU util" value={`${Math.round(100 / users)}%`} bad />
          </div>
        </div>

        {/* vLLM/SGLang side */}
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">vLLM / SGLang</span>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ENGINE_BADGE.vllm}`}>
              continuous batch
            </span>
          </div>
          <div className="space-y-1">
            {Array.from({ length: users }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-12 text-right text-[10px] text-muted-foreground">User {i + 1}</span>
                <div className="flex-1 h-5 rounded bg-muted/40 overflow-hidden">
                  <div
                    className="h-full rounded bg-emerald-500/80 flex items-center px-2"
                    style={{ width: `${Math.max(20, Math.round(100 / users) - 4)}%` }}
                  >
                    <span className="text-[9px] text-white font-medium">in batch</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 pt-1">
            <StatPill label="Serving" value={String(users)} good />
            <StatPill label="Waiting" value="0" good />
            <StatPill label="GPU util" value={`${gpuUtil}%`} good />
          </div>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed">
        {users === 1
          ? "With 1 user, Ollama and vLLM are identical — nothing to batch. This is why Ollama is fine for solo dev."
          : `With ${users} users, Ollama processes 1 and leaves ${users - 1} waiting (GPU at ${Math.round(100 / users)}% utilisation). vLLM batches all ${users} into one forward pass — same compute, ${users}× the throughput.`}
      </p>
    </div>
  );
}

function StatPill({ label, value, good, bad }: { label: string; value: string; good?: boolean; bad?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2 text-center">
      <p className="text-[9px] text-muted-foreground mb-0.5">{label}</p>
      <p className={`text-sm font-semibold ${good ? "text-emerald-600 dark:text-emerald-400" : bad ? "text-rose-500" : ""}`}>
        {value}
      </p>
    </div>
  );
}

// ── Engine deploy CTA ─────────────────────────────────────────────────────────

function EngineCta({ engine, description }: { engine: Engine; description: string }) {
  const label = engine === "vllm" ? "Deploy with vLLM" : engine === "sglang" ? "Deploy with SGLang" : "Deploy with Ollama";
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase ${ENGINE_BADGE[engine]}`}>
          {engine}
        </span>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
      <Link
        href="/find"
        className="block w-full rounded-lg bg-muted px-3 py-2 text-center text-xs font-medium text-foreground transition-colors hover:bg-muted/70"
      >
        {label} →
      </Link>
    </div>
  );
}

function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold">{children}</h2>;
}
