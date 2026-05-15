import Link from "next/link";
import { ArrowRight, Gauge, Server, Wallet } from "lucide-react";
import type { CloreBalance, CloreRental } from "@/lib/types";
import { fmtCloreRate } from "@/lib/clore-billing";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface CloreAccountSummaryProps {
  balance: CloreBalance | undefined;
  rentals: CloreRental[];
  registeredCount?: number;
  onRentClick?: () => void;
}

export function CloreAccountSummary({
  balance,
  rentals,
  registeredCount,
  onRentClick,
}: CloreAccountSummaryProps) {
  const dailyBurnByCurrency = new Map<string | null, number>();
  for (const rental of rentals) {
    if (rental.price_per_day == null) continue;
    const key = rental.currency ?? null;
    dailyBurnByCurrency.set(key, (dailyBurnByCurrency.get(key) ?? 0) + rental.price_per_day);
  }

  const burnEntries = Array.from(dailyBurnByCurrency.entries()).filter(([, total]) => total > 0);
  const activeCount = rentals.length;
  const unregisteredCount = registeredCount == null ? 0 : Math.max(0, activeCount - registeredCount);

  const rentButton = onRentClick ? (
    <Button size="sm" onClick={onRentClick}>
      Rent GPU
      <ArrowRight className="size-3.5" />
    </Button>
  ) : (
    <Button asChild size="sm">
      <Link href="/clore?tab=marketplace">
        Rent GPU
        <ArrowRight className="size-3.5" />
      </Link>
    </Button>
  );

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-4 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Clore Account</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Wallets, active rental count, and current billing from Clore.ai.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {rentButton}
        </div>
      </div>

      <div className="grid border-t border-border sm:grid-cols-2 lg:grid-cols-4">
        {(balance?.balances.length ? balance.balances : []).map((b) => (
          <SummaryTile
            key={b.currency}
            icon={<Wallet className="size-3.5" />}
            label={`${b.currency} Balance`}
            value={b.amount.toFixed(4)}
          />
        ))}
        {burnEntries.map(([currency, total]) => (
          <SummaryTile
            key={currency ?? "unknown"}
            icon={<Gauge className="size-3.5" />}
            label="Daily Burn"
            value={fmtCloreRate(total, currency)}
            tone="amber"
          />
        ))}
        <SummaryTile
          icon={<Server className="size-3.5" />}
          label="Active Rentals"
          value={String(activeCount)}
          sub={registeredCount == null ? undefined : `${registeredCount} registered`}
        />
        {registeredCount != null && unregisteredCount > 0 && (
          <SummaryTile
            icon={<Server className="size-3.5" />}
            label="Needs Registration"
            value={String(unregisteredCount)}
            tone="amber"
          />
        )}
      </div>
    </Card>
  );
}

function SummaryTile({
  icon,
  label,
  value,
  sub,
  tone = "default",
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "amber";
}) {
  return (
    <div className="min-h-[82px] border-t border-border px-5 py-3 first:border-t-0 sm:border-l sm:border-t-0 sm:first:border-l-0 lg:first:border-l-0">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`mt-2 text-lg font-semibold tabular-nums ${tone === "amber" ? "text-amber-600 dark:text-amber-400" : ""}`}>
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
