import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DataTable,
  clampPage,
  compareSortValues,
  paginateRows,
  sortRows,
  totalPagesFor,
  type DataTableColumn,
  type DataTableProps,
} from "../src/app/admin/DataTable";

// ─── Pure logic (S4c: RED→GREEN) ───────────────────────────────────

describe("compareSortValues — numbers vs strings vs null", () => {
  it("compares numbers numerically (2 < 10), not lexicographically", () => {
    expect(compareSortValues(2, 10, "asc")).toBeLessThan(0);
    expect(compareSortValues(10, 2, "asc")).toBeGreaterThan(0);
    expect(compareSortValues(10, 2, "desc")).toBeLessThan(0);
    expect(compareSortValues(2, 2, "asc")).toBe(0);
  });

  it("compares strings with locale-aware ordering", () => {
    expect(compareSortValues("abeja", "zorro", "asc")).toBeLessThan(0);
    expect(compareSortValues("zorro", "abeja", "asc")).toBeGreaterThan(0);
    expect(compareSortValues("zorro", "abeja", "desc")).toBeLessThan(0);
  });

  it("sends null/undefined to the end regardless of direction", () => {
    expect(compareSortValues(null, 5, "asc")).toBeGreaterThan(0);
    expect(compareSortValues(5, null, "asc")).toBeLessThan(0);
    // desc: the value moves to the front, but the null stays last
    expect(compareSortValues(null, 5, "desc")).toBeGreaterThan(0);
    expect(compareSortValues(5, null, "desc")).toBeLessThan(0);
    expect(compareSortValues(undefined, undefined, "asc")).toBe(0);
  });
});

describe("sortRows — stable sort", () => {
  const rows = [
    { id: 3, name: "Beta", score: 7 },
    { id: 1, name: "Alfa", score: null },
    { id:10, name: "beta", score: 2 },
    { id: 2, name: "Alfa", score: 10 },
  ];

  it("orders numbers numerically in both directions", () => {
    expect(sortRows(rows, "id", "asc").map((r) => r.id)).toEqual([1, 2, 3, 10]);
    expect(sortRows(rows, "id", "desc").map((r) => r.id)).toEqual([10, 3, 2, 1]);
  });

  it("orders strings with the es collation and keeps nulls last in both directions", () => {
    const collator = new Intl.Collator("es");
    const byName = sortRows(rows, "name", "asc");
    // Locale-ordered; the two equal "Alfa" rows keep their input order (stable)
    expect(byName.slice(0, 2).map((r) => r.id)).toEqual([1, 2]);
    expect(byName.slice(2).map((r) => r.name)).toEqual(
      ["Beta", "beta"].sort(collator.compare),
    );
    const desc = sortRows(rows, "score", "desc");
    expect(desc[desc.length - 1]?.score).toBeNull();
    const asc = sortRows(rows, "score", "asc");
    expect(asc[asc.length - 1]?.score).toBeNull();
  });

  it("is stable: rows with equal sort values keep their input order", () => {
    // Two "Alfa" rows: original order is id=1 then id=2 — must hold in asc AND desc
    expect(sortRows(rows, "name", "asc").map((r) => r.id).slice(0, 2)).toEqual([1, 2]);
    expect(sortRows(rows, "name", "desc").map((r) => r.id).slice(2)).toEqual([1, 2]);
  });

  it("uses a custom value extractor when provided (nulls still last)", () => {
    const sorted = sortRows(rows, "ignored", "asc", (r) => r.score);
    expect(sorted.map((r) => r.id)).toEqual([10, 3, 2, 1]);
  });

  it("does not mutate the input array", () => {
    const input = [...rows];
    sortRows(rows, "id", "desc");
    expect(rows).toEqual(input);
  });
});

describe("paginateRows — pagination slice", () => {
  const rows = Array.from({ length: 45 }, (_, i) => i + 1); // 1..45

  it("slices full pages from the start index", () => {
    expect(paginateRows(rows, 0, 20)).toEqual(rows.slice(0, 20));
    expect(paginateRows(rows, 1, 20)).toEqual(rows.slice(20, 40));
  });

  it("returns the short final page", () => {
    expect(paginateRows(rows, 2, 20)).toEqual([41, 42, 43, 44, 45]);
  });

  it("returns an empty slice past the last page", () => {
    expect(paginateRows(rows, 3, 20)).toEqual([]);
  });

  it("returns every row when pageSize is 0 or negative (pagination disabled)", () => {
    expect(paginateRows(rows, 0, 0)).toEqual(rows);
    expect(paginateRows(rows, 2, -1)).toEqual(rows);
  });

  it("returns an empty slice for a negative page instead of counting from the end", () => {
    expect(paginateRows(rows, -1, 20)).toEqual([]);
  });
});

describe("clampPage / totalPagesFor — page boundaries", () => {
  it("clamps a page below zero to the first page", () => {
    expect(clampPage(-3, 4)).toBe(0);
  });

  it("clamps a page past the last one to the last page", () => {
    expect(clampPage(9, 4)).toBe(3);
  });

  it("keeps a valid page untouched", () => {
    expect(clampPage(2, 4)).toBe(2);
  });

  it("resolves to page 0 when there are no pages", () => {
    expect(clampPage(5, 0)).toBe(0);
    expect(clampPage(0, 0)).toBe(0);
  });

  it("counts pages with ceil and never fewer than one", () => {
    expect(totalPagesFor(0, 20)).toBe(1);
    expect(totalPagesFor(20, 20)).toBe(1);
    expect(totalPagesFor(21, 20)).toBe(2);
    expect(totalPagesFor(45, 20)).toBe(3);
    expect(totalPagesFor(45, 0)).toBe(1);
  });
});

// ─── Component smoke (S4a) ─────────────────────────────────────────

interface Row {
  id: number;
  name: string;
  score: number | null;
}

const COLUMNS: DataTableColumn<Row>[] = [
  { key: "id", header: "ID", align: "right", sortable: true, render: (r) => r.id },
  { key: "name", header: "Nombre", sortable: true, render: (r) => r.name },
  {
    key: "score",
    header: "Puntaje",
    align: "right",
    sortable: true,
    render: (r) => (r.score == null ? "—" : r.score),
  },
  {
    key: "actions",
    header: "Acciones",
    align: "right",
    render: () => <button type="button">Ver</button>,
  },
];

const ROWS: Row[] = [
  { id: 2, name: "Beta", score: 7 },
  { id: 1, name: "Alfa", score: null },
  { id: 3, name: "Gamma", score: 2 },
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

describe("DataTable — rendering and empty state", () => {
  it("renders every declared column and its cells", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: "ID" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Acciones" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Beta" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Ver" })).toHaveLength(3);
  });

  it("shows the empty-state message when there are no rows", () => {
    renderTable({ rows: [] });
    expect(
      screen.getByRole("cell", { name: "No hay registros todavía." }),
    ).toBeInTheDocument();
  });
});

describe("DataTable — accessible sort", () => {
  it("marks sortable headers with aria-sort and toggles direction on click", async () => {
    const user = userEvent.setup();
    const { container } = renderTable();

    const nameTh = screen.getByRole("columnheader", { name: "Nombre" });
    expect(nameTh).toHaveAttribute("aria-sort", "none");
    // Non-sortable columns carry no aria-sort
    const actionsTh = screen.getByRole("columnheader", { name: "Acciones" });
    expect(actionsTh).not.toHaveAttribute("aria-sort");

    await user.click(within(nameTh).getByRole("button", { name: "Nombre" }));
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );
    let body = container.querySelectorAll("tbody tr");
    expect(body[0]).toHaveTextContent("Alfa");

    await user.click(screen.getByRole("button", { name: "Nombre" }));
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    body = container.querySelectorAll("tbody tr");
    expect(body[0]).toHaveTextContent("Gamma");
  });

  it("honors the initial sort and exposes it via aria-sort", () => {
    const { container } = renderTable({
      initialSort: { key: "id", dir: "desc" },
    });
    expect(screen.getByRole("columnheader", { name: "ID" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    const body = container.querySelectorAll("tbody tr");
    expect(body[0]).toHaveTextContent("3");
  });

  it("activates sorting with Enter and Space on the header button", async () => {
    const user = userEvent.setup();
    renderTable();

    const button = within(
      screen.getByRole("columnheader", { name: "Nombre" }),
    ).getByRole("button", { name: "Nombre" });
    button.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveAttribute(
      "aria-sort",
      "ascending",
    );

    button.focus();
    await user.keyboard(" ");
    expect(screen.getByRole("columnheader", { name: "Nombre" })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
  });
});

describe("DataTable — client-side pagination", () => {
  const many: Row[] = Array.from({ length: 45 }, (_, i) => ({
    id: i + 1,
    name: `Fila ${i + 1}`,
    score: i,
  }));

  it("renders at most pageSize rows and exposes accessible controls", async () => {
    const user = userEvent.setup();
    const { container } = renderTable({ rows: many });

    expect(container.querySelectorAll("tbody tr")).toHaveLength(20);
    expect(screen.getByText("Página 1 de 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("Página 2 de 3")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Fila 21" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anterior" })).toBeEnabled();
  });

  it("hides the pagination controls when everything fits on one page", () => {
    renderTable();
    expect(screen.queryByText(/^Página/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Siguiente" })).not.toBeInTheDocument();
  });

  it("clamps the current page when the row count shrinks", async () => {
    const user = userEvent.setup();
    const { rerender } = renderTable({ rows: many });
    // Walk to page 3 (internal page state = 2)
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    await user.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("Página 3 de 3")).toBeInTheDocument();

    // Only 25 rows left → last page is 2; the stale page 3 must clamp, not blank
    rerender(
      <DataTable<Row>
        columns={COLUMNS}
        rows={many.slice(0, 25)}
        getRowKey={(r) => String(r.id)}
        emptyMessage="No hay registros todavía."
      />,
    );
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Fila 21" })).toBeInTheDocument();
  });
});
