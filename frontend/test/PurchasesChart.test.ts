import { describe, it, expect } from "vitest";
import { truncateTick } from "../src/app/admin/dashboard/PurchasesChart";

/**
 * T6 of mobile-ui-p2 (S9): XAxis ticks overlap at 360px because
 * `interval={0}` + `angle={-12}` renders full product names. The formatter
 * keeps labels at a readable width; the Tooltip still shows the full name.
 */
describe("truncateTick", () => {
  it("keeps labels of 12 characters or less untouched", () => {
    expect(truncateTick("Vitamina D")).toBe("Vitamina D");
    expect(truncateTick("Complejo B12")).toBe("Complejo B12"); // 12 chars
  });

  it("truncates longer labels to 11 characters plus an ellipsis", () => {
    expect(truncateTick("Complejo de vitaminas del grupo B")).toBe(
      "Complejo de…"
    );
    expect(truncateTick("1234567890123")).toBe("12345678901…"); // 13 chars
  });

  it("never returns a label longer than 12 characters", () => {
    for (const name of ["x".repeat(13), "y".repeat(50), "Vitamina D3 1000 UI"]) {
      expect(truncateTick(name).length).toBeLessThanOrEqual(12);
    }
  });
});
