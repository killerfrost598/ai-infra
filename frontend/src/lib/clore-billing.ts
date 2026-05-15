import type { CloreRental } from "./types";

export function cloreCurrencyUnit(currency: string | null): string {
  if (!currency) return "";
  const c = currency.toLowerCase();
  if (c.includes("usd")) return "$";
  if (c.includes("clore")) return "CLORE ";
  if (c.includes("bitcoin") || c === "btc") return "BTC ";
  return `${currency} `;
}

export function fmtCloreAmount(amount: number | null, currency: string | null, precision = 4): string {
  if (amount == null) return "";
  const unit = cloreCurrencyUnit(currency);
  if (unit === "$") return `$${amount.toFixed(2)}`;
  return `${unit}${amount.toFixed(precision)}`.trim();
}

export function fmtCloreRate(pricePerDay: number | null, currency: string | null): string {
  const amount = fmtCloreAmount(pricePerDay, currency);
  return amount ? `${amount}/day` : "";
}

export function fmtCloreCost(totalCost: number | null, currency: string | null): string {
  const amount = fmtCloreAmount(totalCost, currency);
  return amount ? `${amount} spent` : "";
}

export function cloreBillingLabels(rental: CloreRental): {
  rate: string;
  cost: string;
  creationFee: string;
} {
  return {
    rate: fmtCloreRate(rental.price_per_day, rental.currency),
    cost: fmtCloreCost(rental.total_cost, rental.currency),
    creationFee: fmtCloreAmount(rental.creation_fee, rental.currency),
  };
}
