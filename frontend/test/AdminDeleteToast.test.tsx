import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { toast } from "sonner";
import { CustomersPage } from "../src/app/admin/CustomersPage";
import type { Customer } from "../src/app/admin/api";

/**
 * S7b (odd/tasks/ui-s6.md) — confirming a delete through ConfirmActionDialog
 * fires `toast.success` with a short entity-specific Spanish message. sonner
 * is mocked: the call is the contract under test, not the portal UI.
 */
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
  Toaster: () => null,
}));

// Real api client over a mocked fetch (ReferrersPage.test.tsx pattern).
const mockFetch = vi.fn();
global.fetch = mockFetch;

const CUSTOMER: Customer = {
  id: 3,
  name: "Cliente Prueba",
  email: "cliente@example.com",
  phone: "+34 600 000 000",
  referrerPhone: null,
  referrerId: null,
  consentVersion: 1,
  consentTimestamp: "2026-10-10T00:00:00Z",
  registeredAt: "2026-10-10T00:00:00Z",
  createdAt: "2026-10-10T00:00:00Z",
};

function ok(body: unknown) {
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
}

function fail(status: number, error: string) {
  return Promise.resolve({ ok: false, status, json: () => Promise.resolve({ error }) });
}

function mockApi({ deleteStatus = 200 }: { deleteStatus?: number } = {}) {
  mockFetch.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/admin/customers") return ok({ customers: [CUSTOMER] });
    if (url === "/api/admin/customers/3" && init?.method === "DELETE") {
      return deleteStatus === 200 ? ok(null) : fail(deleteStatus, "no_eliminado");
    }
    return fail(404, `unmocked ${url}`);
  });
}

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("button", { name: "Eliminar" }));
  const dialog = await screen.findByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Eliminar" }));
}

describe("Admin delete toasts (S7b)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fires toast.success('Cliente eliminado') when the delete is confirmed", async () => {
    mockApi();
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>,
    );

    await confirmDelete(user);

    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Cliente eliminado"),
    );
  });

  it("does not toast success when the delete request fails", async () => {
    mockApi({ deleteStatus: 500 });
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <CustomersPage />
      </MemoryRouter>,
    );

    await confirmDelete(user);

    // The error banner is the failure feedback; the success toast must stay silent.
    const banner = await screen.findByRole("alert");
    expect(banner).toHaveTextContent("Respuesta del backend: no_eliminado");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
