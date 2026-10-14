import { describe, it, expect, beforeEach, vi } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Routes, Route } from "react-router";
import { AdminLayout } from "../src/app/admin/AdminLayout";

/**
 * T4 of ui-optimization (S5b): the mobile drawer had no Escape handler, no
 * focus management and no scroll lock; the toggle carried no aria-expanded.
 */
const mockFetch = vi.fn();
global.fetch = mockFetch;

function ok(status: number, body: unknown) {
  return { ok: status < 400, status, json: async () => body };
}

describe("AdminLayout drawer keyboard behavior", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => ok(200, { products: [] }));
  });

  async function openDrawer() {
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<p>CRM contenido</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByText("CRM contenido");
    const toggle = screen.getByRole("button", {
      name: /abrir menú de navegación/i,
    });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "true"));
    return toggle;
  }

  it("toggle exposes aria-expanded and aria-controls; Escape closes and restores focus", async () => {
    const toggle = await openDrawer();
    expect(toggle).toHaveAttribute("aria-controls");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(toggle).toHaveAttribute("aria-expanded", "false"));
    expect(toggle).toHaveFocus();
  });

  it("locks body scroll while open and unlocks on close", async () => {
    const toggle = await openDrawer();
    expect(document.body.style.overflow).toBe("hidden");

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() =>
      expect(document.body.style.overflow).not.toBe("hidden"),
    );
  });
});
