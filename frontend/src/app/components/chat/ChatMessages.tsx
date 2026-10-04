import React from "react";
import { AlertCircle } from "lucide-react";
import { ProductCard } from "./ProductCard";
import { VideoCard } from "./VideoCard";
import type { ChatMessage, ProductCardInfo, VideoCardInfo } from "./types";

export type { ChatMessage };

// Matches a persisted video citation; the captured group is the segment id.
const VIDEO_MARKER = /\[VIDEO:(\d+)\]/;

// Matches a persisted product citation; the captured group is the catalog ref
// (extract convention \[\d{4,6}\], same as the backend's extractProductRefs).
const PRODUCT_REF = /\[(\d{4,6})\]/;

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
 * Agent message body: splits on `[VIDEO:<id>]` markers first. Known ids render
 * a VideoCard between the surrounding text chunks; unknown ids render nothing
 * (the marker token is stripped). Each surviving text chunk then goes through
 * ProductRefs, so video and product cards coexist in one message.
 */
function AgentMessageBody({
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

export function ChatMessages({
  messages,
  sending,
  chatError,
  scrollRef,
  videos,
  products = new Map<string, ProductCardInfo>(),
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
            <AgentMessageBody text={msg.text} videos={videos} products={products} />
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
