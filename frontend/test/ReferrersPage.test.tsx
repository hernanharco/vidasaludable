import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ReferrersPage } from "../src/app/admin/ReferrersPage";
import type { ReferrerWithStats } from "../src/app/admin/api";

// Real api client over a mocked fetch (CustomerDetail harness style).
const mockFetch = vi.fn();
global.fetch = mockFetch;

const REFERRERS: ReferrerWithStats[] = [
  {
    id: 7,
    code: "1996432239",
    name: "Hernan Arango Cortes",
    phone: null,
    email: null,
    active: 1,
    createdAt: "2026-10-01T00:00:00Z",
    customerCount: 1,
    customers: [
      {
        id: 3,
        name: "Cliente Ficha",
        email: "cliente@example.com",
        phone: "+34 600 000 000",
        registeredAt: "2026-10-10T00:00:00Z",
      },
    ],
  },
];

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ReferrersPage />
    </MemoryRouter>,
  );
}

describe("ReferrersPage (ver ficha del cliente)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/admin/referrers") return ok({ referrers: REFERRERS });
      return Promise.resolve({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: `unmocked ${url}` }),
      });
    });
  });

  it("links each nested customer in the desktop table to its ficha", async () => {
    renderPage();

    const links = await screen.findAllByRole("link", { name: "Ver ficha" });
    expect(links[0]).toHaveAttribute("href", "/admin/customers/3");
  });

  it("also links the customer in the expanded mobile card", async () => {
    renderPage();
    await screen.findByText("Cliente Ficha");

    // Desktop nested table already renders one link; expanding the mobile
    // card adds the same action there.
    expect(screen.getAllByRole("link", { name: "Ver ficha" })).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: /👥 1 cliente/ }));
    const links = screen.getAllByRole("link", { name: "Ver ficha" });
    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toHaveAttribute("href", "/admin/customers/3");
    }
  });
});
