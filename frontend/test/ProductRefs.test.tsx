import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { ProductRefs, amwayProductUrl } from "../src/app/admin/ProductRefs";
import type { Product } from "../src/app/admin/api";

const PRODUCTS: Product[] = [
  {
    reference: "VIT-D",
    name: "Vitamina D3 2000 UI",
    category: "Nutrición",
    size: "120 cápsulas",
    price: 25.5,
    benefits: "Salud ósea",
    dosage: "1 cápsula/día",
    ingredients: "Vitamina D3",
    disclaimer: "Complemento alimenticio",
  },
];

describe("ProductRefs (nombres + link Amway por código)", () => {
  it("renders the catalog name plus code, linking to the amway.es search by reference", () => {
    render(<ProductRefs references={["VIT-D"]} products={PRODUCTS} />);
    const link = screen.getByRole("link", { name: "Vitamina D3 2000 UI (VIT-D)" });
    expect(link).toHaveAttribute("href", "https://www.amway.es/Productos/c/100000?q=VIT-D");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("falls back to the bare code when the reference is not in the catalog, still linked", () => {
    render(<ProductRefs references={["DESCONOCIDO"]} products={PRODUCTS} />);
    const link = screen.getByRole("link", { name: "DESCONOCIDO" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.amway.es/Productos/c/100000?q=DESCONOCIDO",
    );
  });

  it("renders an em dash when there are no references", () => {
    render(<ProductRefs references={[]} products={PRODUCTS} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("amwayProductUrl encodes the reference", () => {
    expect(amwayProductUrl("A B")).toBe(
      "https://www.amway.es/Productos/c/100000?q=A%20B",
    );
  });
});
