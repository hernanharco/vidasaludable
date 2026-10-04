import React from "react";
import { Play } from "lucide-react";
import { formatTime } from "../../lib/format";
import type { VideoCardInfo } from "./types";

/**
 * Compact YouTube link card for an approved video segment. Rendered inside
 * agent bubbles wherever a persisted `[VIDEO:<id>]` marker resolves to a known
 * enabled segment; opens the resolved YouTube URL (clip or deep link) in a new
 * tab. Only `https://` URLs render as links (scheme guard, defense in depth):
 * anything else renders the same inert card layout without an href, so a
 * hypothetical hostile URL (e.g. `javascript:`) can never execute.
 */
export function VideoCard({ video }: { video: VideoCardInfo }) {
  // Scheme guard: only https URLs become anchor targets; everything else
  // (javascript:, data:, …) renders the identical card layout as a div.
  const href =
    typeof video.url === "string" && video.url.startsWith("https://")
      ? video.url
      : null;
  const body = (
    <>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-900 text-white">
        <Play className="h-4 w-4" fill="currentColor" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-stone-800">{video.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-1 text-[11px] text-stone-500">
          {video.condition ? (
            <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-800">
              {video.condition}
            </span>
          ) : null}
          {typeof video.startS === "number" && typeof video.endS === "number" ? (
            <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-[10px] font-medium text-stone-700">
              {formatTime(video.startS)} – {formatTime(video.endS)}
            </span>
          ) : null}
          <span>{video.speaker}</span>
        </span>
      </span>
    </>
  );
  if (!href) {
    // Inert fallback: same layout, no anchor, no href.
    return (
      <div className="mt-2 mb-1 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-left">
        {body}
      </div>
    );
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 mb-1 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-left no-underline hover:border-emerald-700 hover:bg-emerald-50 transition-colors"
    >
      {body}
    </a>
  );
}
