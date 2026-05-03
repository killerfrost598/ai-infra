"use client";

import { useCloreOffers } from "@/lib/queries";

export function PrefetchOffers() {
  useCloreOffers();
  return null;
}
