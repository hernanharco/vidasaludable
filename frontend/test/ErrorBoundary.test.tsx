import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary } from "../src/app/components/chat/ErrorBoundary";

/**
 * intake-health-data S6 (odd/tasks/intake-health-data.md) — there was no
 * ErrorBoundary anywhere in the frontend, so ANY render error left the chat
 * as a blank screen ("algunos usuarios después de llenar el formulario se
 * queda la pantalla en blanco"). The boundary catches the error and renders
 * an actionable fallback instead of nothing.
 */

// React logs caught errors via console.error; silence the noise in test output.
let recoverSpy: ReturnType<typeof vi.fn>;

function Boom({ explode }: { explode: boolean }): React.ReactElement {
  if (explode) throw new Error("boom de render");
  return <p>contenido sano</p>;
}

describe("ErrorBoundary", () => {
  beforeEach(() => {
    // React logs caught errors via console.error; silence the noise.
    vi.spyOn(console, "error").mockImplementation(() => {});
    recoverSpy = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders its children when no error occurs", () => {
    render(
      <ErrorBoundary onRecover={recoverSpy}>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    expect(screen.getByText("contenido sano")).toBeInTheDocument();
    expect(screen.queryByText(/algo salió mal/i)).not.toBeInTheDocument();
  });

  it("renders the actionable fallback (never a blank screen) when a child throws", () => {
    render(
      <ErrorBoundary onRecover={recoverSpy}>
        <Boom explode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/algo salió mal/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("recovers on retry: the fallback's button re-renders the children", () => {
    const { rerender } = render(
      <ErrorBoundary onRecover={recoverSpy}>
        <Boom explode={true} />
      </ErrorBoundary>,
    );
    // The underlying cause clears (e.g. transient state), retry re-mounts.
    rerender(
      <ErrorBoundary onRecover={recoverSpy}>
        <Boom explode={false} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));
    expect(recoverSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("contenido sano")).toBeInTheDocument();
    expect(screen.queryByText(/algo salió mal/i)).not.toBeInTheDocument();
  });

  it("shows a manual reload link as a second escape hatch", () => {
    render(
      <ErrorBoundary onRecover={recoverSpy}>
        <Boom explode={true} />
      </ErrorBoundary>,
    );
    expect(screen.getByRole("button", { name: /recargar la página/i })).toBeInTheDocument();
  });
});
