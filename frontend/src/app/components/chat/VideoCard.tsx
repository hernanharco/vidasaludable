import React from "react";
import { Play } from "lucide-react";
import type { VideoCardInfo } from "./types";

/**
 * Compact YouTube link card for an approved video segment. Rendered inside
 * agent bubbles wherever a persisted `[VIDEO:<id>]` marker resolves to a known
 * enabled segment; opens the resolved YouTube URL (clip or deep link) in a new
 * tab.
 */
export function VideoCard({ video }: { video: VideoCardInfo }) {
  return (
    <a
      href={video.url}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 mb-1 flex items-start gap-2 rounded-xl border border-stone-200 bg-stone-50 p-2.5 text-left no-underline hover:border-emerald-700 hover:bg-emerald-50 transition-colors"
    >
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
          <span>{video.speaker}</span>
        </span>
      </span>
    </a>
  );
}
