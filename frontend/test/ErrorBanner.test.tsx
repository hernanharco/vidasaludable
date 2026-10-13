import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ErrorBanner, errorMessageFor, toErrorState } from "../src/app/admin/ErrorBanner";
import { AdminError } from "../src/app/admin/api";

/**
 * T4 of ui-optimization (S5a): 7 admin pages rendered a full-page amber box
 * titled "Acceso restringido" for ANY failure, with no retry on 4 of them.
 * The banner must rotule honestly (401/403 = authorization; anything else =
 * a transient server/network failure) and offer recovery.
 */
describe("errorMessageFor", () => {
  it("labels 401 and 403 as an authorization problem", () => {
    expect(errorMessageFor(401).title).toBe("Acceso restringido");
    expect(errorMessageFor(403).title).toBe("Acceso restringido");
  });

  it("never says 'Acceso restringido' for other statuses or unknown errors", () => {
    for (const status of [500, 502, 503, undefined]) {
      expect(errorMessageFor(status).title).not.toBe("Acceso restringido");
      expect(errorMessageFor(status).title.length).toBeGreaterThan(0);
    }
  });
});

describe("toErrorState", () => {
  it("preserves the HTTP status of an AdminError", () => {
    expect(toErrorState(new AdminError(403, "rol_invalido"))).toEqual({
      status: 403,
      detail: "rol_invalido",
    });
  });

  it("degrades a non-AdminError to a detail without status", () => {
    expect(toErrorState(new Error("boom")).status).toBeUndefined();
    expect(toErrorState(new Error("boom")).detail).toBe("boom");
    expect(toErrorState("weird").detail).toBe("Error de red");
  });
});

describe("ErrorBanner", () => {
  it("announces itself with role=alert and renders the honest title", () => {
    render(<ErrorBanner status={500} detail="HTTP 500" />);
    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent("No pudimos cargar los datos");
    expect(banner).toHaveTextContent("HTTP 500");
  });

  it("rotules 403 as Acceso restringido", () => {
    render(<ErrorBanner status={403} />);
    expect(screen.getByRole("alert")).toHaveTextContent("Acceso restringido");
  });

  it("honours a title override (e.g. save failures)", () => {
    render(<ErrorBanner detail="HTTP 500" title="No pudimos guardar los cambios" />);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "No pudimos guardar los cambios",
    );
  });

  it("fires onRetry when the retry button is pressed", async () => {
    const onRetry = vi.fn();
    render(<ErrorBanner status={500} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("renders no retry button without onRetry", () => {
    render(<ErrorBanner status={500} />);
    expect(screen.queryByRole("button", { name: /reintentar/i })).toBeNull();
  });
});
