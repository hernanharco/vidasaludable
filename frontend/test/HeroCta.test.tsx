import { describe, it, expect } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { Hero } from "../src/app/components/Hero";

/**
 * S1 (odd/tasks/chat-intake-ux.md) — the hero CTA must open the dedicated
 * chat route instead of the in-page booking anchor.
 */
describe("Hero CTA", () => {
  it("links 'Comienza tu plan preventivo' to the chat URL", () => {
    render(<Hero />);
    const link = screen.getByRole("link", { name: /Comienza tu plan preventivo/ });
    expect(link).toHaveAttribute("href", "https://vidasaludable.rincom.es/chat");
  });

  it("keeps the CTA label and the arrow affordance", () => {
    render(<Hero />);
    const link = screen.getByRole("link", { name: /Comienza tu plan preventivo/ });
    expect(link).toHaveTextContent("Comienza tu plan preventivo");
    expect(link.querySelector("svg")).not.toBeNull();
  });
});
