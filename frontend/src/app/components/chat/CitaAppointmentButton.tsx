import React, { useState } from "react";
import { Calendar, CalendarCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";

/** T4 tamizaje — the prefilled reason of the appointment dialog. */
const CITA_DEFAULT_REASON = "Quiero agendar un tamizaje";

/**
 * T4 tamizaje (T6c extraction — behavior byte-identical) — Button-card
 * rendered for the known `[CITA]` marker (AssessmentCard pattern): a Calendar
 * card opens a small confirm dialog (prefilled reason textarea →
 * confirm/cancel) that hands the trimmed reason to the caller-supplied POST
 * handler. On success the card is REPLACED by a non-interactive "Solicitud
 * enviada" state; on failure the handler has already toasted, so the dialog
 * stays open for a retry.
 *
 * T6c: extracted from ChatMessages.tsx so the assessment results CTA
 * (AssessmentWidget) reuses the SAME dialog instead of duplicating it — the
 * chat still renders it for the `[CITA]` marker through the same props.
 */
export function CitaAppointmentButton({
  onRequestAppointment,
}: {
  onRequestAppointment?: (reason: string) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(CITA_DEFAULT_REASON);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  const handleConfirm = async () => {
    if (!onRequestAppointment || submitting) return;
    const trimmed = reason.trim();
    if (trimmed === "") return;
    setSubmitting(true);
    try {
      const ok = await onRequestAppointment(trimmed);
      if (ok) {
        setConfirmed(true);
        setOpen(false);
      }
      // Failure: the handler toasted (404 → new-conversation hint, 400 →
      // server message, transport → connection error); keep the dialog open.
    } catch {
      // The lifted handler reports its own errors; guard a rejecting one.
    } finally {
      setSubmitting(false);
    }
  };

  if (confirmed) {
    return (
      <div className="mt-1 w-full flex items-center gap-3 rounded-xl border border-stone-300 bg-stone-100 px-3 py-2.5 text-left">
        <CalendarCheck className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-stone-700">Solicitud enviada</span>
          <span className="text-xs text-stone-500">
            Te contactaremos para agendar tu cita
          </span>
        </span>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!onRequestAppointment}
        className="mt-1 w-full flex items-center gap-3 rounded-xl border border-emerald-600 bg-emerald-50 px-3 py-2.5 text-left transition-colors hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 disabled:opacity-60 disabled:cursor-not-allowed"
      >
        <Calendar className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-emerald-800">
            Solicitar cita para tamizaje
          </span>
          <span className="text-xs text-emerald-700">
            Agenda presencial con un especialista
          </span>
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Solicitar cita para tamizaje</DialogTitle>
            <DialogDescription>
              Cuéntanos brevemente el motivo y te contactamos para agendar.
            </DialogDescription>
          </DialogHeader>
          <label className="text-xs font-medium text-stone-600">
            Motivo
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={500}
              rows={3}
              className="mt-1 w-full rounded-lg border border-stone-200 bg-white px-3 py-2 text-sm text-stone-800 focus:outline-none focus:ring-1 focus:ring-emerald-900"
            />
          </label>
          <DialogFooter className="gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => setOpen(false)}
              disabled={submitting}
              className="px-4 py-2 rounded-full text-sm text-stone-600 border border-stone-300 hover:bg-stone-100 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={submitting || reason.trim() === ""}
              className="px-4 py-2 rounded-full text-sm text-white bg-emerald-900 hover:bg-emerald-800 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? "Enviando…" : "Confirmar"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
