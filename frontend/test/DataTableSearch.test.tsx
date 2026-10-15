import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DataTable,
  filterRows,
  type DataTableColumn,
  type DataTableProps,
} from "../src/app/admin/DataTable";

// ─── filterRows — pure logic (S3a: RED→GREEN) ─────────────────────

describe("filterRows — pure search filter", () => {
  const rows = [
    { id: 1, name: "Moderación de carbohidratos" },
    { id: 2, name: "Ácido linoleico" },
    { id: 3, name: "Vitamina B12" },
    { id: 4, name: "niño test" },
  ];
  const getText = (r: (typeof rows)[number]) => r.name;

  it("returns the same rows array (identity) for an empty query", () => {
    expect(filterRows(rows, "", getText)).toBe(rows);
  });

  it("returns the same rows for a blank (whitespace-only) query", () => {
    expect(filterRows(rows, "   \t ", getText)).toBe(rows);
  });

  it("trims the query before matching", () => {
    expect(filterRows(rows, "  b12  ", getText).map((r) => r.id)).toEqual([3]);
  });

  it("matches case-insensitively", () => {
    expect(filterRows(rows, "B12", getText).map((r) => r.id)).toEqual([3]);
    expect(filterRows(rows, "VITAMINA", getText).map((r) => r.id)).toEqual([3]);
  });

  it("matches accents-insensitively in both directions", () => {
    // Query without accents matches accented text
    expect(filterRows(rows, "acido", getText).map((r) => r.id)).toEqual([2]);
    // Query with accents matches unaccented text
    expect(filterRows(rows, "Ácido", getText).map((r) => r.id)).toEqual([2]);
    expect(filterRows(rows, "moderacion", getText).map((r) => r.id)).toEqual([1]);
    // ñ/n equivalence
    expect(filterRows(rows, "nino", getText).map((r) => r.id)).toEqual([4]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(filterRows(rows, "zzz", getText)).toEqual([]);
  });

  it("preserves the input order of matching rows (stable)", () => {
    const matched = filterRows(rows, "a", getText);
    expect(matched.length).toBeGreaterThan(1);
    // Same relative order as the input array
    const inputOrder = rows
      .filter((r) => matched.some((m) => m.id === r.id))
      .map((r) => r.id);
    expect(matched.map((r) => r.id)).toEqual(inputOrder);
  });
});

// ─── DataTable — searchable (S3b) ─────────────────────────────────

interface Row {
  id: number;
  name: string;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "id", header: "ID", sortable: true, render: (r) => r.id },
  { key: "name", header: "Nombre", sortable: true, render: (r) => r.name },
];

const ROWS: Row[] = [
  { id: 1, name: "Espárrago triguero" },
  { id: 2, name: "Brócoli al vapor" },
  { id: 3, name: "Zanahoria baby" },
];

function renderTable(props: Partial<DataTableProps<Row>> = {}) {
  return render(
    <DataTable<Row>
      columns={COLUMNS}
      rows={ROWS}
      getRowKey={(r) => String(r.id)}
      emptyMessage="No hay registros todavía."
      {...props}
    />,
  );
}

describe("DataTable — searchable (S3b)", () => {
  it("renders a labeled type=search input when searchable is set", () => {
    renderTable({ searchable: true, searchText: (r) => r.name });
    const input = screen.getByRole("searchbox", { name: /buscar/i });
    expect(input).toHaveAttribute("type", "search");
  });

  it("renders no search input when searchable is not set", () => {
    renderTable();
    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  });

  it("filters rows case- and accent-insensitively as you type", async () => {
    const user = userEvent.setup();
    renderTable({ searchable: true, searchText: (r) => r.name });
    await user.type(screen.getByRole("searchbox", { name: /buscar/i }), "esparra");
    expect(
      screen.getByRole("cell", { name: "Espárrago triguero" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("cell", { name: "Brócoli al vapor" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("cell", { name: "Zanahoria baby" }),
    ).not.toBeInTheDocument();
  });

  it("shows a query-specific empty state when nothing matches", async () => {
    const user = userEvent.setup();
    renderTable({ searchable: true, searchText: (r) => r.name });
    await user.type(screen.getByRole("searchbox", { name: /buscar/i }), "zzz");
    expect(screen.getByText("Sin resultados para «zzz»")).toBeInTheDocument();
    expect(
      screen.queryByText("No hay registros todavía."),
    ).not.toBeInTheDocument();
  });

  it("keeps the default emptyMessage when there is no active query", () => {
    renderTable({ rows: [], searchable: true, searchText: (r) => r.name });
    expect(screen.getByText("No hay registros todavía.")).toBeInTheDocument();
  });

  it("resets to the first page when the query shrinks the result set", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 45 }, (_, i) => ({
      id: i + 1,
      name: `Fila ${i + 1}`,
    }));
    renderTable({ rows: many, searchable: true, searchText: (r) => r.name });

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("Página 3 de 3")).toBeInTheDocument();

    // 8 matches ("Fila 4", "Fila 40".."Fila 45") → one page; no stranded page
    await user.type(screen.getByRole("searchbox", { name: /buscar/i }), "Fila 4");
    expect(screen.queryByText(/^Página/)).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Fila 41" })).toBeInTheDocument();

    // Clearing the query returns to the first page, not the stale page 3
    await user.clear(screen.getByRole("searchbox", { name: /buscar/i }));
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Fila 1" })).toBeInTheDocument();
  });

  it("applies the search on top of the active sort", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({
      searchable: true,
      searchText: (r) => r.name,
    });
    // Sort by name ascending (es collation): Brócoli, Espárrago, Zanahoria
    await user.click(screen.getByRole("button", { name: "Nombre" }));
    await user.type(screen.getByRole("searchbox", { name: /buscar/i }), "a");
    const firstRow = container.querySelector("tbody tr");
    expect(firstRow).toHaveTextContent("Brócoli al vapor");
    expect(firstRow).not.toHaveTextContent("Zanahoria baby");
  });
});
