"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

type EngineFilter = "all" | "vllm" | "sglang";

interface Flag {
  engine: "vllm" | "sglang" | "both";
  name: string;
  what: string;
  why: string;
  gpuNote?: string;
  highlight?: boolean;
}

const FLAGS: Flag[] = [
  // ── vLLM ──────────────────────────────────────────────────────────────────
  {
    engine: "vllm",
    name: "--quantization fp8 / awq / gptq",
    what: "Controls how model weights are stored in VRAM",
    why: "fp8 halves BF16 memory and is lossless on H100/H200/RTX 4090 (FP8 tensor cores). AWQ and GPTQ are software quants that run on any GPU — roughly same compression as FP8 but slightly more quality loss. The single biggest lever for making oversized models fit.",
    gpuNote: "fp8 requires Hopper (H100/H200) or Ada (RTX 4090). Use awq or gptq on older hardware.",
    highlight: true,
  },
  {
    engine: "vllm",
    name: "--gpu-memory-utilization 0.90",
    what: "Fraction of VRAM reserved for vLLM (default 0.90)",
    why: "vLLM pre-allocates this fraction at startup for both weights and KV-cache. On a 24 GB GPU: 0.90 × 24 = 21.6 GB available. Lower to 0.85 if you get OOM at startup. Raise to 0.93–0.95 to fit more concurrent KV-cache slots.",
    highlight: true,
  },
  {
    engine: "vllm",
    name: "--max-model-len 32768",
    what: "Maximum sequence length (prompt + output tokens)",
    why: "Caps how long each request's KV-cache can grow. Lower = smaller KV-cache per slot = more concurrent users on the same VRAM. A 27B model supports 262K natively, but serving at 262K on 24 GB is impossible. Set to the longest context you actually need — 8K–32K is typical for production APIs.",
    highlight: true,
  },
  {
    engine: "vllm",
    name: "--tensor-parallel-size 2",
    what: "Splits model across N GPUs (tensor parallel)",
    why: "When weights exceed one GPU's VRAM, split them. TP=2 means each GPU holds half the layers. Required for 70B BF16 on 2× 40 GB, or 235B FP8 on 2× H100. Communication overhead is minimal on NVLink; significant over PCIe. Start with TP only — add pipeline-parallel only if TP=8 still doesn't fit.",
    gpuNote: "NVLink strongly preferred for TP ≥ 2. PCIe works but adds 15–30% latency per hop.",
  },
  {
    engine: "vllm",
    name: "--enable-prefix-caching",
    what: "Cache KV-cache for repeated prompt prefixes",
    why: "When multiple requests share the same system prompt, vLLM computes it once and reuses the KV-cache. Essential for chatbot and RAG deployments. Disabled by default — enable explicitly. On shared-prefix workloads this can cut compute 30–50%.",
  },
  {
    engine: "vllm",
    name: "--enforce-eager",
    what: "Disables CUDA graph capture (slower but less memory)",
    why: "vLLM pre-captures CUDA graphs at startup, speeding up decoding but using extra VRAM during capture. On tight 24 GB cards running a 20 GB model, CUDA graph capture can OOM at startup. --enforce-eager disables it: ~10% slower throughput, but stable on constrained hardware.",
    gpuNote: "Safe to remove this flag on GPUs with ≥ 40 GB VRAM. On 24 GB, keep it when the model leaves < 4 GB headroom.",
  },
  {
    engine: "vllm",
    name: "--enable-chunked-prefill",
    what: "Splits long prefill into smaller chunks",
    why: "A 50K-token document causes a massive activation memory spike if processed at once. Chunked prefill breaks it into pieces (e.g. 4096 tokens each), dramatically reducing peak VRAM. Essential when serving long-context models on consumer GPUs. Allows interleaving prefill and decode for better GPU utilisation.",
    gpuNote: "Always enable on 24 GB GPUs when serving models with > 16K context.",
  },
  {
    engine: "vllm",
    name: "--max-num-seqs 256",
    what: "Maximum concurrent sequences in flight",
    why: "vLLM's continuous batching can process up to this many requests simultaneously. Higher = more concurrency but each sequence needs its own KV-cache slot. The practical limit is (available VRAM − model weights) ÷ KV-cache-per-slot. PagedAttention eliminates fragmentation so unused pages are reclaimed immediately.",
  },
  {
    engine: "vllm",
    name: "--reasoning-parser qwen3 / deepseek-r1",
    what: "Strips <think>…</think> CoT blocks from API responses",
    why: "Thinking models (Qwen3, DeepSeek-R1) emit a reasoning block before the final answer. Without this flag, the raw CoT text leaks into your API response. The parser moves it to a separate field in the response JSON. Critical when serving these models to applications that don't want raw chain-of-thought in the output.",
    highlight: true,
  },

  // ── SGLang ────────────────────────────────────────────────────────────────
  {
    engine: "sglang",
    name: "--mem-fraction-static 0.80",
    what: "Fraction of VRAM for model weights (default 0.80)",
    why: "SGLang reserves this fraction for static allocations (weights, framework buffers). The remaining 20% becomes the dynamic KV-cache pool. Lower = more KV-cache (more concurrent requests). Equivalent to vLLM's --gpu-memory-utilization but controls the static/dynamic split differently.",
    highlight: true,
  },
  {
    engine: "sglang",
    name: "--context-length 32768",
    what: "Maximum context window per request",
    why: "Same purpose as vLLM's --max-model-len. Setting this lower than the model's native maximum shrinks the KV-cache pool and allows more concurrent sequences. The context-length flag is your primary tool to control total KV-cache budget on constrained hardware.",
    highlight: true,
  },
  {
    engine: "sglang",
    name: "--tp-size 2",
    what: "Tensor parallel — split model across N GPUs",
    why: "Same concept as vLLM's --tensor-parallel-size. Pairs with --dp-size (data parallel) for multi-node. For single-node multi-GPU, tp-size alone is sufficient.",
    gpuNote: "Same NVLink preference as vLLM TP. PCIe adds latency.",
  },
  {
    engine: "sglang",
    name: "--chunked-prefill-size 4096",
    what: "Tokens processed per prefill chunk",
    why: "SGLang's version of chunked prefill. Smaller values reduce peak VRAM during long-context requests but increase forward passes needed. 4096 is a good default for 24–48 GB GPUs. For 80 GB+ GPUs increase to 8192–16384 for better throughput on long documents.",
    gpuNote: "Lower to 2048 on 24 GB GPUs running models with < 6 GB headroom.",
  },
  {
    engine: "sglang",
    name: "--reasoning-parser qwen3 / deepseek-r1",
    what: "Strips <think>…</think> CoT blocks from API responses",
    why: "Same as vLLM's flag. SGLang also caches the reasoning prefix via RadixAttention — if every request starts with the same system prompt + think-mode instruction, the KV tensors are computed once.",
    highlight: true,
  },
  {
    engine: "sglang",
    name: "--tool-call-parser qwen2_5 / qwen3_coder",
    what: "Parses structured tool-call JSON from model output",
    why: "Agentic models emit tool calls as formatted JSON inside their output. The parser formats them as proper OpenAI-compatible tool_calls objects. SGLang caches the tool schema prefix via RadixAttention — if every agent call starts with the same tool definitions, they are computed once across all sessions.",
  },
  {
    engine: "sglang",
    name: "--speculative-algo NEXTN",
    what: "Speculative decoding — draft tokens ahead",
    why: "A small draft model (or the model's own MTP head on Qwen3/DeepSeek) generates N candidate tokens, then the main model verifies in a single forward pass. Typical speedup: 1.5–2.5× on output-heavy workloads. --speculative-num-steps 3 means the draft proposes 3 tokens per verification round.",
  },

  // ── Both ──────────────────────────────────────────────────────────────────
  {
    engine: "both",
    name: "--dtype bfloat16 / float16",
    what: "Compute dtype for activations (separate from weight precision)",
    why: "This is the precision used during computation (forward pass math), not weight storage. BF16 is the safe default for most modern GPUs — same range as FP32, half the memory bandwidth for activations. Float16 can cause numerical instability on some large models. Set once and forget.",
  },
  {
    engine: "both",
    name: "--max-num-batched-tokens 8192",
    what: "Max tokens processed in a single forward pass",
    why: "Controls the peak activation memory spike. One forward pass of 8192 tokens requires more activation memory than 8192 individual 1-token steps — all intermediate attention matrices exist simultaneously. Lower if you get random OOM mid-request. Chunked prefill is the cleaner solution.",
  },
  {
    engine: "both",
    name: "--served-model-name my-model",
    what: "Names the model in the OpenAI-compatible API",
    why: "Both vLLM and SGLang expose an OpenAI-compatible REST API. This flag sets the model name returned in the API so your application code doesn't change when you switch engines. Your app calls /v1/chat/completions with model: 'my-model' regardless of whether vLLM or SGLang is behind it.",
  },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SettingsPage() {
  const [filter, setFilter] = useState<EngineFilter>("all");

  const visible = FLAGS.filter((f) => {
    if (filter === "all") return true;
    if (filter === "vllm") return f.engine === "vllm" || f.engine === "both";
    return f.engine === "sglang" || f.engine === "both";
  });

  return (
    <div className="space-y-6 pb-12">
      <p className="text-sm text-muted-foreground max-w-2xl">
        Key launch flags for vLLM and SGLang. Sorted by impact — highlighted flags are the ones
        that matter most on constrained hardware.
      </p>

      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-border bg-muted/40 p-0.5 w-fit">
        {(["all", "vllm", "sglang"] as EngineFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-md px-4 py-1.5 text-xs capitalize transition-colors ${
              filter === f
                ? "bg-background text-foreground font-medium shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {f === "all" ? "All engines" : f}
          </button>
        ))}
      </div>

      {/* Flag list */}
      <div className="space-y-3">
        {visible.map((flag) => (
          <FlagCard key={`${flag.engine}-${flag.name}`} flag={flag} />
        ))}
      </div>
    </div>
  );
}

// ── Flag card ─────────────────────────────────────────────────────────────────

const ENGINE_BADGE: Record<string, string> = {
  vllm: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300",
  sglang: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-300",
  both: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
};

function FlagCard({ flag }: { flag: Flag }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    const flagName = flag.name.split(" ")[0];
    navigator.clipboard?.writeText(flagName).catch(() => {
      const ta = document.createElement("textarea");
      ta.value = flagName;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    });
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className={`rounded-xl border p-4 space-y-2.5 ${flag.highlight ? "border-indigo-500/40 bg-indigo-500/5" : "border-border bg-card"}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="font-mono text-xs font-semibold text-indigo-400">{flag.name}</code>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${ENGINE_BADGE[flag.engine]}`}>
              {flag.engine}
            </span>
          </div>
          <p className="text-xs font-medium text-foreground/80">{flag.what}</p>
        </div>
        <button
          onClick={handleCopy}
          title="Copy flag name"
          className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {copied ? <Check className="size-3 text-emerald-500" /> : <Copy className="size-3" />}
        </button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{flag.why}</p>

      {flag.gpuNote && (
        <div className="flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2">
          <span className="text-amber-500 text-xs mt-0.5">⚠</span>
          <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">{flag.gpuNote}</p>
        </div>
      )}
    </div>
  );
}
