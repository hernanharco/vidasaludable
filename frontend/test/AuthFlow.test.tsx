// T2 admin-authcore — RED-phase tests for the frontend login flow.
//
// Harness style follows VideosPage.test.tsx / VideoCards.test.tsx: mock fetch
// at the global level, run the real api client on top of it.
//
// jsdom 30 (this repo) makes `window.location` non-configurable and
// `location.assign` non-writable/non-configurable, so the href-assignment
// assertions go through a tiny seam (`redirectToAuth` in lib/auth.ts) instead
// of a location spy/replace — jsdom cannot observe the raw assignment at all.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router";
import { LoginScreen } from "../src/app/admin/LoginScreen";
import { AuthCallback } from "../src/app/admin/AuthCallback";
import { AdminLayout } from "../src/app/admin/AdminLayout";
import { api } from "../src/app/admin/api";
import { getToken, setToken, clearToken, loginUrl, redirectToAuth } from "../src/app/lib/auth";

const mockFetch = vi.fn();
global.fetch = mockFetch;

function clearTokenCookie() {
  document.cookie = "token=; path=/; max-age=0";
}

function ok(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) });
}

describe("auth helpers (lib/auth)", () => {
  beforeEach(clearTokenCookie);

  it("loginUrl points at authCore with redirect_to = origin + /auth/callback", () => {
    expect(loginUrl()).toBe(
      `${import.meta.env.VITE_AUTHCORE_URL || "https://api-authcore.rincom.es"}/api/v1/auth/google?redirect_to=${encodeURIComponent(`${window.location.origin}/auth/callback`)}`,
    );
  });

  it("setToken writes the token cookie and getToken reads it back", () => {
    setToken("abc");
    expect(document.cookie).toContain("token=abc");
    expect(getToken()).toBe("abc");
  });
});

describe("LoginScreen", () => {
  beforeEach(clearTokenCookie);

  it("renders the Google button; clicking it hands off to the authCore URL", async () => {
    const user = userEvent.setup();
    const assignSpy = vi.fn();
    vi.spyOn(await import("../src/app/lib/auth"), "redirectToAuth").mockImplementation(assignSpy);

    render(<LoginScreen />);
    const button = screen.getByRole("button", { name: /continuar con google/i });
    expect(button).toBeInTheDocument();
    await user.click(button);
    expect(assignSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AuthCallback", () => {
  beforeEach(clearTokenCookie);

  it("?token=abc → cookie token=abc set and navigation to /admin", async () => {
    render(
      <MemoryRouter initialEntries={["/auth/callback?token=abc"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/admin" element={<p>CRM cargado</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await waitFor(() => expect(getToken()).toBe("abc"));
    expect(await screen.findByText("CRM cargado")).toBeInTheDocument();
  });

  it("missing token → error state, no cookie set", async () => {
    render(
      <MemoryRouter initialEntries={["/auth/callback"]}>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback />} />
          <Route path="/admin/login" element={<p>Pantalla de login</p>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/no se recibió ningún token/i)).toBeInTheDocument();
    expect(getToken()).toBeNull();
  });
});

describe("api.request Bearer attachment", () => {
  beforeEach(() => {
    clearTokenCookie();
    mockFetch.mockReset();
    mockFetch.mockImplementation(() => ok(200, { products: [] }));
  });

  it("attaches Authorization: Bearer <token> when the cookie is present", async () => {
    setToken("jwt-token-1");
    await api.listProducts();
    const call = mockFetch.mock.calls.find(([url]) => url === "/api/admin/catalog");
    expect(call).toBeDefined();
    const headers = (call![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt-token-1");
  });

  it("does NOT attach Authorization when no cookie is present", async () => {
    await api.listProducts();
    const call = mockFetch.mock.calls.find(([url]) => url === "/api/admin/catalog");
    expect(call).toBeDefined();
    const headers = (call![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("AdminLayout gate", () => {
  beforeEach(clearTokenCookie);

  it("no token + guarded backend (401) → login screen after exactly one raw probe", async () => {
    // The gate must probe ONCE without a token to tell prod (401 → login)
    // from an open dev backend (200 → enter without ceremony).
    mockFetch.mockImplementation(() => ok(401, { error: "token_requerido" }));
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<p>CRM contenido</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(
      await screen.findByRole("button", { name: /continuar con google/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("CRM contenido")).not.toBeInTheDocument();
    // Raw probe fired exactly once — no Bearer header (no cookie yet)
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    const probeHeaders = (mockFetch.mock.calls[0]![1] as RequestInit | undefined)
      ?.headers as Record<string, string> | undefined;
    expect(probeHeaders?.Authorization).toBeUndefined();
  });

  it("no token + open backend (dev) → CRM enters with no ceremony", async () => {
    // NODE_ENV=development keeps the backend open (feature decision: no
    // dev-token ceremony) — the gate must NOT trap devs on the login screen.
    mockFetch.mockImplementation(() => ok(200, { products: [] }));
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<p>CRM contenido</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("CRM contenido")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continuar con google/i }),
    ).not.toBeInTheDocument();
  });

  it("token cookie present → CRM loads and the request carries the Bearer header", async () => {
    setToken("jwt-gate-1");
    mockFetch.mockImplementation(() => ok(200, { products: [] }));
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<p>CRM contenido</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("CRM contenido")).toBeInTheDocument();
    const call = mockFetch.mock.calls.find(([url]) => url === "/api/admin/catalog");
    expect(call).toBeDefined();
    const headers = (call![1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer jwt-gate-1");
  });

  it("403 from the API → 'Acceso restringido' state, probe does not loop", async () => {
    setToken("jwt-role-403");
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "acceso_restringido" }) }),
    );
    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<p>CRM contenido</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText("Acceso restringido")).toBeInTheDocument();
    // Static message: exactly one probe fired, no retry loop
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByText("CRM contenido")).not.toBeInTheDocument();
  });
});

describe("api.request 401/403 handling", () => {
  beforeEach(() => {
    clearTokenCookie();
    mockFetch.mockReset();
  });

  it("401 token_invalido → token cookie cleared and AdminError 401 thrown", async () => {
    setToken("expired-jwt");
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 401, json: () => Promise.resolve({ error: "token_invalido" }) }),
    );
    await expect(api.listProducts()).rejects.toMatchObject({
      name: "AdminError",
      status: 401,
      message: "token_invalido",
    });
    // Cookie dropped so the next render lands on the login screen
    expect(getToken()).toBeNull();
  });

  it("403 acceso_restringido → AdminError 403 thrown, token cookie kept", async () => {
    setToken("jwt-not-admin");
    mockFetch.mockImplementation(() =>
      Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "acceso_restringido" }) }),
    );
    await expect(api.listProducts()).rejects.toMatchObject({
      name: "AdminError",
      status: 403,
      message: "acceso_restringido",
    });
    // 403 is not a session failure — the cookie must survive (no login loop)
    expect(getToken()).toBe("jwt-not-admin");
  });
});
