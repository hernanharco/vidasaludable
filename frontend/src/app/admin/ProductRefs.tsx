import type { Product } from "./api";

/**
 * Product references rendered for the advisor: catalog NAME plus code,
 * linking each one to the amway.es search by reference —
 * `https://www.amway.es/Productos/c/100000?q=<ref>` lands on the exact
 * product (verified: code 110178 → 1 result). Zero maintenance: works for
 * every reference, including rows predating the catalog join.
 */

export function amwayProductUrl(reference: string): string {
  return `https://www.amway.es/Productos/c/100000?q=${encodeURIComponent(reference)}`;
}

export function ProductRefs({
  references,
  products,
}: {
  references: string[];
  products: Product[];
}) {
  if (references.length === 0) return <span>—</span>;
  return (
    <span>
      {references.map((ref, i) => {
        const name = products.find((p) => p.reference === ref)?.name;
        return (
          <span key={ref}>
            {i > 0 && ", "}
            <a
              href={amwayProductUrl(ref)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-800 hover:underline"
            >
              {name ? `${name} (${ref})` : ref}
            </a>
          </span>
        );
      })}
    </span>
  );
}
