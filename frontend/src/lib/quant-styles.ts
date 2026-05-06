export const FORMAT_STYLE: Record<string, string> = {
  gguf:    "bg-white text-amber-800 dark:bg-zinc-900 dark:text-amber-300 border-amber-300/50 dark:border-amber-700/40",
  awq:     "bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-300 border-violet-300/50 dark:border-violet-700/40",
  gptq:    "bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-300 border-sky-300/50 dark:border-sky-700/40",
  fp8:     "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300 border-emerald-300/50 dark:border-emerald-700/40",
  bnb:     "bg-pink-100 text-pink-800 dark:bg-pink-900/40 dark:text-pink-300 border-pink-300/50 dark:border-pink-700/40",
  fp16:    "bg-slate-100 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300 border-slate-300/50 dark:border-slate-600/40",
  int8:    "bg-teal-100 text-teal-800 dark:bg-teal-900/40 dark:text-teal-300 border-teal-300/50 dark:border-teal-700/40",
  int4:    "bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300 border-orange-300/50 dark:border-orange-700/40",
  fp4:     "bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-300 border-rose-300/50 dark:border-rose-700/40",
  mlx:     "bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-300 border-indigo-300/50 dark:border-indigo-700/40",
  unknown: "bg-muted text-muted-foreground border-border/50",
};

export function quantStyle(format: string | null | undefined): string {
  return FORMAT_STYLE[format ?? ""] ?? FORMAT_STYLE.unknown;
}
