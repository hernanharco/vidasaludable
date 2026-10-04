import React from "react";
import { Pill } from "lucide-react";
import type { ProductCardInfo } from "./types";

/**
 * es-ES currency format for display only (task contract): the API keeps the
 * raw number; this is the only place that turns it into "29,71 €".
 */
const priceFormatter = new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR",
});

/** Benefits are truncated at ~180 chars + "…" to keep the chat compact. */
const BENEFITS_MAX = 180;

/**
 * Compact info card for a catalog product, mirroring VideoCard's
 * stone/emerald look but WITHOUT a link — the app has no store, the card
 * exists purely to make the recommendation visible instead of literal
 * bracket text. Rendered inside agent bubbles wherever a persisted `[REF]`
 * citation resolves to a known catalog product; unknown refs keep their
 * literal `[12345]` text and render no card. Carries a muted disclaimer line
 * whenever the API serves one (content honesty: show what exists).
 */
export function ProductCard({ product }: { product: ProductCardInfo }) {
  const benefits =
    product.benefits.length > BENEFITS_MAX
      ? `${product.benefits.slice(0, BENEFITS_MAX).trimEnd()}…`
      : product.benefits;
  // Disclaimer (feature doc Decisions): render only when non-empty after
  // trim — old rows / curation gaps must not break the card.
  const disclaimer = typeof product.disclaimer === "string" ? product.disclaimer.trim() : "";
  return (
    <div className="mt-2 mb-1 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-left">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-900 text-white">
        <Pill className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-stone-800">{product.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-stone-500">
          {product.category ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
              {product.category}
            </span>
          ) : null}
          <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-700">
            [{product.reference}]
          </span>
          <span className="font-semibold text-stone-800">{priceFormatter.format(product.price)}</span>
        </span>
        {benefits ? (
          <span className="mt-1 block text-[11px] leading-relaxed text-stone-600">{benefits}</span>
        ) : null}
        {disclaimer ? (
          <span className="mt-0.5 block text-[10px] leading-snug text-stone-400">{disclaimer}</span>
        ) : null}
      </span>
    </div>
  );
}
