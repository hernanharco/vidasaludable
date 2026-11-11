import React, { useState } from "react";
import { Calendar, CalendarCheck, ClipboardCheck } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { ProductCard } from "./ProductCard";
import { VideoCard } from "./VideoCard";
import type { ChatMessage, ProductCardInfo, VideoCardInfo } from "./types";

export type { ChatMessage };

// Matches a persisted video citation; the captured group is the segment id.
const VIDEO_MARKER = /\[VIDEO:(\d+)\]/;

// Matches a persisted product citation; the captured group is the catalog ref
// (extract convention \[\d{4,6}\], same as the backend's extractProductRefs).
const PRODUCT_REF = /\[(\d{4,6})\]/;

// T4 — Known, always-on markers the backend emits literally in its replies:
// `[ASSESSMENT]` (prevention-wizard card) and, from tamizaje-images T4,
// `[CITA]` (appointment-request card). Fixed literals, no dynamic payload
// (unlike VIDEO_MARKER), so there is no id whitelist to resolve. ONE split on
// both keeps the per-message dedupe contract — the FIRST occurrence of EACH
// marker renders its card — and the capture group keeps the token position
// when splitting (same interleave pattern as VIDEO_MARKER).
const KNOWN_MARKER = /(\[ASSESSMENT\]|\[CITA\])/;
const ASSESSMENT_TOKEN = "[ASSESSMENT]";

interface ChatMessagesProps {
  messages: ChatMessage[];
  sending: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Boot-fetched map of ENABLED segment ids → card data. */
  videos: Map<number, VideoCardInfo>;
  /**
   * T6 — Boot-fetched map of catalog references → card data. Optional: the
   * chat works without it (a failed products fetch degrades to an empty map,
   * same best-effort contract as the videos map).
   */
  products?: Map<string, ProductCardInfo>;
  /**
   * T4 — Opens the prevention wizard when the `[ASSESSMENT]` button-card is
   * clicked. Optional: without a handler the card still renders, but disabled
   * (backward compatibility for other call sites/tests).
   */
  onOpenAssessment?: () => void;
  /**
   * T4 tamizaje — confirms a `[CITA]` request: called with the trimmed
   * reason, POSTs /assistant/appointments (the lift lives in ChatSession)
   * and resolves `true` on success so the card flips to its confirmed state.
   * Optional: without a handler the card still renders, but disabled.
   */
  onRequestAppointment?: (reason: string) => Promise<boolean>;
}

/**
 * T4 — Button-card rendered for the known `[ASSESSMENT]` marker. Emerald,
 * action-styled, opens the prevention wizard through the parent handler.
 */
function AssessmentCard({ onOpenAssessment }: { onOpenAssessment?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpenAssessment}
      disabled={!onOpenAssessment}
      className="mt-1 w-full flex items-center gap-3 rounded-xl border border-emerald-600 bg-emerald-50 px-3 py-2.5 text-left transition-colors hover:bg-emerald-100 focus:outline-none focus:ring-2 focus:ring-emerald-600/40 disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <ClipboardCheck className="w-5 h-5 shrink-0 text-emerald-700" aria-hidden="true" />
      <span className="flex flex-col">
        <span className="text-sm font-semibold text-emerald-800">
          Chequeo completo de síntomas
        </span>
        <span className="text-xs text-emerald-700">95 preguntas · resultados personalizados</span>
      </span>
    </button>
  );
}

/** T4 tamizaje — the prefilled reason of the appointment dialog. */
const CITA_DEFAULT_REASON = "Quiero agendar un tamizaje";

/**
 * T4 tamizaje — Button-card rendered for the known `[CITA]` marker
 * (AssessmentCard pattern): a Calendar card opens a small confirm dialog
 * (prefilled reason textarea → confirm/cancel) that hands the trimmed
 * reason to the lifted POST handler. On success the card is REPLACED by a
 * non-interactive "Solicitud enviada" state; on failure the handler has
 * already toasted, so the dialog stays open for a retry.
 */
function CitaCard({
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

/**
 * T6 — Agent text chunk: renders known `[REF]` citations as ProductCards and
 * keeps unknown refs as literal `[12345]` text (backward compatible — unlike
 * video markers, where unknown ids are stripped). `[VIDEO:id]` contains
 * letters, so PRODUCT_REF never matches it; videos are split out first.
 * Repeated refs within ONE message render a single card (first occurrence
 * wins); later occurrences stay as literal `[ref]` text.
 */
function ProductRefs({
  text,
  products,
}: {
  text: string;
  products: Map<string, ProductCardInfo>;
}) {
  // Dedupe within a single message (render only): the FIRST occurrence of a
  // known ref renders the card; later occurrences keep the literal `[ref]`
  // text. The persisted message keeps every token untouched (append-only
  // conversation contract — mirrors the VIDEO marker rule).
  const seen = new Set<string>();
  // split with a capture group → [chunk, ref, chunk, ref, ..., chunk]
  const parts = text.split(PRODUCT_REF);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part ? <React.Fragment key={i}>{part}</React.Fragment> : null;
        }
        const product = products.get(part);
        if (product && !seen.has(part)) {
          seen.add(part);
          return <ProductCard key={i} product={product} />;
        }
        // Unknown ref, or a repeat of one already rendered above: keep the
        // literal token in the text (backward compatible / append-only).
        return <React.Fragment key={i}>[{part}]</React.Fragment>;
      })}
    </>
  );
}

/**
 * Video + product refs for one agent text chunk: splits on `[VIDEO:<id>]`
 * markers first. Known ids render a VideoCard between the surrounding text
 * chunks; unknown ids render nothing (the marker token is stripped). Each
 * surviving text chunk then goes through ProductRefs, so video and product
 * cards coexist in one message.
 */
function VideoAndProductRefs({
  text,
  videos,
  products,
}: {
  text: string;
  videos: Map<number, VideoCardInfo>;
  products: Map<string, ProductCardInfo>;
}) {
  // split with a capture group → [chunk, id, chunk, id, ..., chunk]
  const parts = text.split(VIDEO_MARKER);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part ? (
            <ProductRefs key={i} text={part} products={products} />
          ) : null;
        }
        const video = videos.get(Number(part));
        return video ? <VideoCard key={i} video={video} /> : null;
      })}
    </>
  );
}

/**
 * Agent message body. Splits on the known `[ASSESSMENT]` / `[CITA]` markers
 * FIRST (same level as the video split, before ProductRefs) so the literals
 * never leak into the rendered text; each surviving chunk then runs the
 * usual video + product card parsing. Per-message dedupe: only the FIRST
 * occurrence of EACH marker renders its card — later repeats render nothing,
 * while the persisted message keeps every token untouched (append-only
 * conversation contract — mirrors the ProductRefs and VIDEO marker rules).
 */
function AgentMessageBody({
  text,
  videos,
  products,
  onOpenAssessment,
  onRequestAppointment,
}: {
  text: string;
  videos: Map<number, VideoCardInfo>;
  products: Map<string, ProductCardInfo>;
  onOpenAssessment?: () => void;
  onRequestAppointment?: (reason: string) => Promise<boolean>;
}) {
  // split with a capture group → [chunk, marker, chunk, marker, ..., chunk]
  const parts = text.split(KNOWN_MARKER);
  let assessmentShown = false;
  let citaShown = false;
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part ? (
            <VideoAndProductRefs key={i} text={part} videos={videos} products={products} />
          ) : null;
        }
        if (part === ASSESSMENT_TOKEN) {
          if (assessmentShown) return null;
          assessmentShown = true;
          return <AssessmentCard key={i} onOpenAssessment={onOpenAssessment} />;
        }
        // [CITA] — first occurrence renders the appointment card.
        if (citaShown) return null;
        citaShown = true;
        return <CitaCard key={i} onRequestAppointment={onRequestAppointment} />;
      })}
    </>
  );
}

export function ChatMessages({
  messages,
  sending,
  scrollRef,
  videos,
  products = new Map<string, ProductCardInfo>(),
  onOpenAssessment,
  onRequestAppointment,
}: ChatMessagesProps) {
  return (
    <div
      ref={scrollRef}
      role="log"
      aria-live="polite"
      className="flex-1 p-4 overflow-y-auto bg-stone-50 flex flex-col gap-3"
    >
      {messages.map((msg, idx) => (
        <div
          key={idx}
          className={`max-w-[80%] p-3 rounded-2xl text-sm break-words ${
            msg.sender === "user"
              ? "bg-emerald-900 text-white rounded-br-none self-end"
              : "bg-white border border-stone-200 text-stone-700 rounded-bl-none self-start shadow-sm whitespace-pre-wrap"
          }`}
        >
          {msg.sender === "agent" ? (
            <AgentMessageBody
              text={msg.text}
              videos={videos}
              products={products}
              onOpenAssessment={onOpenAssessment}
              onRequestAppointment={onRequestAppointment}
            />
          ) : (
            msg.text
          )}
        </div>
      ))}
      {sending && (
        <div
          role="status"
          className="max-w-[80%] p-3 rounded-2xl text-sm bg-white border border-stone-200 text-stone-400 self-start shadow-sm"
        >
          Escribiendo...
        </div>
      )}
    </div>
  );
}
