import * as React from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog";

export interface ConfirmActionDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Admin confirmation modal (replaces native window.confirm). Radix's
 * AlertDialog already traps focus, locks scroll, closes on Escape/backdrop and
 * restores focus on close; the overlay click also routes to `onCancel`.
 */
export function ConfirmActionDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  // Radix closes the dialog from Action/Cancel clicks too (onOpenChange(false));
  // without this guard a confirm would also fire onCancel.
  const confirmedRef = React.useRef(false);

  return (
    <AlertDialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) return;
        if (confirmedRef.current) {
          confirmedRef.current = false;
          return;
        }
        onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && (
            <AlertDialogDescription>{description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40"
            onClick={() => {
              confirmedRef.current = true;
              onConfirm();
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
