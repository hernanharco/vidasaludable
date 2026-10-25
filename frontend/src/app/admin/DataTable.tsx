import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../components/ui/utils";

// ─── Shared admin DataTable (S4) ───────────────────────────────────
//
// Replaces the three table dialects that the admin pages used to spell out
// by hand (dialect A: Customers/Conversations/Purchases/Catalog/Guidance/
// Videos; dialect B: Referrers/AssessmentAdmin). It provides:
//   - column definitions (`DataTableColumn<T>`),
//   - accessible sort: `aria-sort` on the `th`, the header content wrapped
//     in a real `<button>` so Enter/Space activate it natively,
//   - client-side pagination (default page size 20) with accessible
//     previous/next buttons and a live page indicator,
//   - an empty state row with a clear message (GuidancePage precedent),
//   - a horizontal scroll wrapper: the table keeps a `min-w-[640px]` so no
//     column is lost or collapses on narrow screens (P1/P2 contract).
//
// Sort and pagination logic is exported as pure functions and unit-tested in
// frontend/test/DataTable.test.tsx (S4c).

export type SortDir = "asc" | "desc";

export type SortValue = string | number | boolean | null | undefined;

export interface DataTableColumn<T> {
  /** Unique column id; also the default sort key. */
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Opt-in: the header becomes a sort button exposing `aria-sort`. */
  sortable?: boolean;
  /** Opt-in: clamps long cell text (`block max-w-[28ch] truncate`) with a
   * `title` tooltip when `render` returns a plain string (S4). */
  truncate?: boolean;
  /** Sort input when it differs from the rendered cell (e.g. formatted dates). */
  sortValue?: (row: T) => SortValue;
  headerClassName?: string;
  cellClassName?: string;
}

export interface DataTableProps<T> {
  columns: DataTableColumn<T>[];
  rows: T[];
  getRowKey: (row: T, index: number) => string;
  /** Shown in the empty-state row when there are no rows to display. */
  emptyMessage: string;
  /** Initial sort. The key may reference a non-column field (rows sort, no header is marked). */
  initialSort?: { key: string; dir: SortDir };
  /** Client-side page size; rows beyond it paginate. Default 20. */
  pageSize?: number;
  /** Extra classes for the outer container (page-specific card/border styling). */
  containerClassName?: string;
  tableClassName?: string;
  /** Extra classes applied to every `th` (e.g. compact nested tables). */
  thClassName?: string;
  /** Extra classes applied to every `td` (e.g. compact nested tables). */
  tdClassName?: string;
  rowClassName?: string;
  /** Renders an extra detail row (colSpan) right after the row — ReferrersPage expand. */
  renderExpandedRow?: (row: T) => ReactNode;
  expandedCellClassName?: string;
  /** Content below the table inside the container (e.g. record counters). */
  footer?: ReactNode;
  /** Opt-in: renders a client-side search input above the table (S3). */
  searchable?: boolean;
  /** Row text extracted for the search filter; required when `searchable`. */
  searchText?: (row: T) => string;
  /** Reports the rows actually rendered (after search, sort AND pagination).
   * A page-scoped consumer (e.g. a select-all checkbox) must derive its
   * "visible" set from this callback, not from the unfiltered `rows` prop —
   * otherwise it silently covers rows the user never sees. Fires only when
   * the rendered key set changes, so callback identity churn cannot loop. */
  onRenderedRowsChange?: (rows: T[]) => void;
}

export const DEFAULT_PAGE_SIZE = 20;

// ─── Pure logic (tested in S4c) ────────────────────────────────────

const COLLATOR = new Intl.Collator("es");

/** Strips diacritics via NFD so "Ácido" and "acido" compare equal. */
const stripDiacritics = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

/**
 * Pure client-side row filter (S3a). Case- and accent-insensitive substring
 * match over `getText(row)`. The query is trimmed; an empty or blank query
 * returns the same `rows` array (identity, order unchanged). Matching rows
 * keep their input order (stable).
 */
export function filterRows<T>(
  rows: T[],
  query: string,
  getText: (row: T) => string,
): T[] {
  const needle = stripDiacritics(query.trim()).toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) =>
    stripDiacritics(getText(row)).toLowerCase().includes(needle),
  );
}

/**
 * Compares two sort values. Numbers compare numerically, booleans as 0/1,
 * everything else as locale strings. null/undefined always sort last,
 * regardless of direction.
 */
export function compareSortValues(a: SortValue, b: SortValue, dir: SortDir): number {
  const aNull = a == null;
  const bNull = b == null;
  if (aNull || bNull) {
    if (aNull && bNull) return 0;
    return aNull ? 1 : -1;
  }
  const factor = dir === "asc" ? 1 : -1;
  if (typeof a === "number" && typeof b === "number") return (a - b) * factor;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return ((a ? 1 : 0) - (b ? 1 : 0)) * factor;
  }
  return COLLATOR.compare(String(a), String(b)) * factor;
}

/**
 * Returns a new array sorted by `key` (or the extracted value). Stable:
 * rows with equal sort values keep their input order in both directions.
 */
export function sortRows<T>(
  rows: readonly T[],
  key: string,
  dir: SortDir,
  getSortValue?: (row: T) => SortValue,
): T[] {
  const extract =
    getSortValue ??
    ((row: T) => (row as Record<string, unknown>)[key] as SortValue);
  return rows
    .map((row, index) => ({ row, index }))
    .sort(
      (x, y) =>
        compareSortValues(extract(x.row), extract(y.row), dir) || x.index - y.index,
    )
    .map(({ row }) => row);
}

/** One page of rows. Out-of-range pages yield an empty slice; pageSize <= 0 disables pagination. */
export function paginateRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): T[] {
  if (pageSize <= 0) return [...rows];
  if (!Number.isFinite(page) || page < 0) return [];
  const start = Math.floor(page) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** Clamps a page index into [0, totalPages - 1]; 0 when there are no pages. */
export function clampPage(page: number, totalPages: number): number {
  if (!Number.isFinite(page) || totalPages <= 0) return 0;
  const last = Math.max(Math.floor(totalPages) - 1, 0);
  return Math.min(Math.max(Math.floor(page), 0), last);
}

/** Total pages for a row count; never fewer than one (the empty-state page). */
export function totalPagesFor(rowCount: number, pageSize: number): number {
  if (pageSize <= 0) return 1;
  return Math.max(1, Math.ceil(Math.max(rowCount, 0) / pageSize));
}

// ─── Component ─────────────────────────────────────────────────────

const ALIGN_CLASS: Record<"left" | "right" | "center", string> = {
  left: "text-left",
  right: "text-right",
  center: "text-center",
};

interface SortState {
  key: string;
  dir: SortDir;
}

export function DataTable<T>({
  columns,
  rows,
  getRowKey,
  emptyMessage,
  initialSort,
  pageSize = DEFAULT_PAGE_SIZE,
  containerClassName,
  tableClassName,
  thClassName,
  tdClassName,
  rowClassName,
  renderExpandedRow,
  expandedCellClassName = "px-4 py-3 bg-stone-50",
  footer,
  searchable = false,
  searchText,
  onRenderedRowsChange,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const [page, setPage] = useState(0);
  const [query, setQuery] = useState("");

  const toggleSort = (column: DataTableColumn<T>) =>
    setSort((prev) =>
      prev?.key === column.key
        ? { key: column.key, dir: prev.dir === "asc" ? "desc" : "asc" }
        : { key: column.key, dir: "asc" },
    );

  const sortColumn = sort ? columns.find((c) => c.key === sort.key) : undefined;
  // A sort key with no visible column (e.g. AssessmentAdmin mappings sorted
  // by symptomId) still orders rows by the raw field; no header is marked.
  const sortedRows = sort
    ? sortRows(rows, sort.key, sort.dir, sortColumn?.sortValue)
    : rows;

  // S3: filter between sorting and pagination; changing the query resets
  // to the first page so a shrinking result set never strands an empty page.
  const filteredRows =
    searchable && searchText
      ? filterRows(sortedRows, query, searchText)
      : sortedRows;

  const totalPages = totalPagesFor(filteredRows.length, pageSize);
  const currentPage = clampPage(page, totalPages);
  const pageRows = paginateRows(filteredRows, currentPage, pageSize);

  // Report the rendered rows by a stable content key: pageRows is a fresh
  // array every render, so depending on its identity would loop when the
  // consumer setState()s from the callback.
  const onRenderedRowsChangeRef = useRef(onRenderedRowsChange);
  onRenderedRowsChangeRef.current = onRenderedRowsChange;
  const renderedKey = pageRows.map((row, i) => getRowKey(row, i)).join("\u0000");
  useEffect(() => {
    onRenderedRowsChangeRef.current?.(pageRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- renderedKey is the content identity of pageRows
  }, [renderedKey]);

  const activeQuery = query.trim();

  return (
    <div className={containerClassName}>
      {searchable && searchText && (
        <div className="px-4 pt-3">
          <label className="block text-sm">
            <span className="text-xs font-medium text-stone-600">Buscar</span>
            <input
              type="search"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setPage(0);
              }}
              placeholder="Buscar…"
              className="mt-1 block w-full max-w-xs border border-stone-300 px-3 py-2 text-sm"
            />
          </label>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className={cn("w-full min-w-[640px] text-sm", tableClassName)}>
          <thead>
            <tr className="border-b border-stone-200 bg-stone-50">
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const ariaSort = !col.sortable
                  ? undefined
                  : active
                    ? sort?.dir === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                return (
                  <th
                    key={col.key}
                    aria-sort={ariaSort}
                    className={cn(
                      "px-4 py-3 font-medium text-stone-600",
                      col.align && ALIGN_CLASS[col.align],
                      thClassName,
                      col.headerClassName,
                    )}
                  >
                    {col.sortable ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className="inline-flex items-center gap-1 cursor-pointer select-none transition-colors hover:text-stone-900"
                      >
                        {col.header}
                        <span aria-hidden="true" className="text-xs text-stone-400">
                          {active ? (sort?.dir === "asc" ? "▲" : "▼") : "⇅"}
                        </span>
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, index) => {
              const key = getRowKey(row, currentPage * pageSize + index);
              return (
                <Fragment key={key}>
                  <tr
                    className={cn(
                      "border-b border-stone-100 hover:bg-stone-50",
                      rowClassName,
                    )}
                  >
                    {columns.map((col) => {
                      const content = col.render(row);
                      return (
                        <td
                          key={col.key}
                          className={cn(
                            "px-4 py-3",
                            col.align && ALIGN_CLASS[col.align],
                            tdClassName,
                            col.cellClassName,
                          )}
                        >
                          {col.truncate ? (
                            <span
                              className="block max-w-[28ch] truncate"
                              title={
                                typeof content === "string" ? content : undefined
                              }
                            >
                              {content}
                            </span>
                          ) : (
                            content
                          )}
                        </td>
                      );
                    })}
                  </tr>
                  {renderExpandedRow && (
                    <tr>
                      <td colSpan={columns.length} className={expandedCellClassName}>
                        {renderExpandedRow(row)}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
            {pageRows.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-stone-400"
                >
                  {searchable && activeQuery
                    ? `Sin resultados para «${activeQuery}»`
                    : emptyMessage}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <nav
          aria-label="Paginación"
          className="flex items-center justify-between gap-3 border-t border-stone-200 px-4 py-2 text-sm text-stone-600"
        >
          <button
            type="button"
            onClick={() => setPage(currentPage - 1)}
            disabled={currentPage <= 0}
            className="px-3 py-1 border border-stone-300 hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Anterior
          </button>
          <span aria-live="polite">
            Página {currentPage + 1} de {totalPages}
          </span>
          <button
            type="button"
            onClick={() => setPage(currentPage + 1)}
            disabled={currentPage >= totalPages - 1}
            className="px-3 py-1 border border-stone-300 hover:bg-stone-100 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Siguiente
          </button>
        </nav>
      )}
      {footer}
    </div>
  );
}
