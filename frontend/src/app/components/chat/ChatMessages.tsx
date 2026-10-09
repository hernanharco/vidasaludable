import React from "react";
import { AlertCircle, ClipboardCheck } from "lucide-react";
import { ProductCard } from "./ProductCard";
import { VideoCard } from "./VideoCard";
import type { ChatMessage, ProductCardInfo, VideoCardInfo } from "./types";

export type { ChatMessage };

// Matches a persisted video citation; the captured group is the segment id.
const VIDEO_MARKER = /\[VIDEO:(\d+)\]/;

// Matches a persisted product citation; the captured group is the catalog ref
// (extract convention \[\d{4,6}\], same as the backend's extractProductRefs).
const PRODUCT_REF = /\[(\d{4,6})\]/;

// T4 — Known, always-on marker: the backend ends its first full recommendation
// with `[ASSESSMENT]` on its own line (optionally offering the 95-symptom
// check). Fixed literal, no dynamic payload (unlike VIDEO_MARKER), so there is
// no id whitelist to resolve. The capture group keeps the token position when
// splitting (same interleave pattern as VIDEO_MARKER).
const ASSESSMENT_MARKER = /(\[ASSESSMENT\])/;

interface ChatMessagesProps {
  messages: ChatMessage[];
  sending: boolean;
  chatError: string | null;
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
 * T4 — Agent message body. Splits on the known `[ASSESSMENT]` marker FIRST
 * (same level as the video split, before ProductRefs) so the literal never
 * leaks into the rendered text; each surviving chunk then runs the usual
 * video + product card parsing.
 */
function AgentMessageBody({
  text,
  videos,
  products,
  onOpenAssessment,
}: {
  text: string;
  videos: Map<number, VideoCardInfo>;
  products: Map<string, ProductCardInfo>;
  onOpenAssessment?: () => void;
}) {
  // split with a capture group → [chunk, marker, chunk, marker, ..., chunk]
  const parts = text.split(ASSESSMENT_MARKER);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part ? (
            <VideoAndProductRefs key={i} text={part} videos={videos} products={products} />
          ) : null;
        }
        // Dedupe within a single message (render only): only the FIRST marker
        // renders the card; later repeats render nothing, so the token never
        // shows up as text either. The persisted message keeps every token
        // untouched (append-only conversation contract — mirrors the ProductRefs
        // and VIDEO marker rules).
        return i === 1 ? (
          <AssessmentCard key={i} onOpenAssessment={onOpenAssessment} />
        ) : null;
      })}
    </>
  );
}

export function ChatMessages({
  messages,
  sending,
  chatError,
  scrollRef,
  videos,
  products = new Map<string, ProductCardInfo>(),
  onOpenAssessment,
}: ChatMessagesProps) {
  return (
    <div
      ref={scrollRef}
      className="flex-1 p-4 overflow-y-auto bg-stone-50 flex flex-col gap-3"
    >
      {messages.map((msg, idx) => (
        <div
          key={idx}
          className={`max-w-[80%] p-3 rounded-2xl text-sm ${
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
            />
          ) : (
            msg.text
          )}
        </div>
      ))}
      {sending && (
        <div className="max-w-[80%] p-3 rounded-2xl text-sm bg-white border border-stone-200 text-stone-400 self-start shadow-sm">
          Escribiendo...
        </div>
      )}
      {chatError && (
        <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg p-2 self-stretch">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{chatError}</span>
        </div>
      )}
    </div>
  );
}
