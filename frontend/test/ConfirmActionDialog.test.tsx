import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfirmActionDialog } from "../src/app/admin/ConfirmActionDialog";

describe("ConfirmActionDialog", () => {
  const base = {
    open: true,
    title: "¿Eliminar a Hernan Arango Cortes?",
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders the title and description inside an alertdialog", () => {
    render(
      <ConfirmActionDialog
        {...base}
        description="Esta acción no se puede deshacer."
      />,
    );
    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();
    expect(
      screen.getByRole("alertdialog", { name: /¿Eliminar a Hernan Arango Cortes\?/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("Esta acción no se puede deshacer.")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<ConfirmActionDialog {...base} open={false} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("calls onConfirm when the confirm button is clicked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmActionDialog {...base} onConfirm={onConfirm} confirmLabel="Eliminar" />);
    await user.click(screen.getByRole("button", { name: "Eliminar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the cancel button is clicked", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ConfirmActionDialog {...base} onCancel={onCancel} cancelLabel="Volver" />);
    await user.click(screen.getByRole("button", { name: "Volver" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel on Escape and never calls onConfirm", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmActionDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("does not call onCancel after a confirmed action closes the dialog", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmActionDialog {...base} onConfirm={onConfirm} onCancel={onCancel} />);
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
