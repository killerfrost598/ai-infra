import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CacheStatusBarProps {
  fetchedAt: string;
  totalRaw: number;
  totalFiltered: number;
  appliedFilters: Record<string, number | string | null>;
  isRefreshing: boolean;
  onRefresh: () => void;
}

export function CacheStatusBar({
  fetchedAt,
  totalRaw,
  totalFiltered,
  appliedFilters,
  isRefreshing,
  onRefresh,
}: CacheStatusBarProps) {
  const time = new Date(fetchedAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  const hasFilters = Object.keys(appliedFilters).length > 0;
  const removedCount = totalRaw - totalFiltered;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-4 py-2 text-xs text-muted-foreground">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span>
          <span className="font-medium text-foreground">{totalFiltered}</span>
          {hasFilters && (
            <span className="text-muted-foreground/70"> of {totalRaw}</span>
          )}{" "}
          servers
        </span>
        {hasFilters && removedCount > 0 && (
          <span className="text-muted-foreground/60">
            {removedCount} removed by global quality bar
          </span>
        )}
        {hasFilters && (
          <span className="text-muted-foreground/50">
            filters:{" "}
            {Object.entries(appliedFilters)
              .map(([k, v]) => `${k.replace("min_", "")}≥${v}`)
              .join(", ")}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-muted-foreground/50">Updated {time}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 gap-1 px-2 text-xs"
          disabled={isRefreshing}
          onClick={onRefresh}
        >
          <RefreshCw className={`size-3 ${isRefreshing ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>
    </div>
  );
}
