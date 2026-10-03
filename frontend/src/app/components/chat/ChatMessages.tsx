import React from "react";
import { AlertCircle } from "lucide-react";
import { VideoCard } from "./VideoCard";
import type { ChatMessage, VideoCardInfo } from "./types";

export type { ChatMessage };

// Matches a persisted video citation; the captured group is the segment id.
const VIDEO_MARKER = /\[VIDEO:(\d+)\]/;

interface ChatMessagesProps {
  messages: ChatMessage[];
  sending: boolean;
  chatError: string | null;
  scrollRef: React.RefObject<HTMLDivElement>;
  /** Boot-fetched map of ENABLED segment ids → card data. */
  videos: Map<number, VideoCardInfo>;
}

/**
 * Agent message body: splits on `[VIDEO:<id>]` markers. Known ids render a
 * VideoCard between the surrounding text chunks; unknown ids render nothing
 * (the marker token is stripped).
 */
function AgentMessageBody({ text, videos }: { text: string; videos: Map<number, VideoCardInfo> }) {
  // split with a capture group → [chunk, id, chunk, id, ..., chunk]
  const parts = text.split(VIDEO_MARKER);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          return part ? <React.Fragment key={i}>{part}</React.Fragment> : null;
        }
        const video = videos.get(Number(part));
        return video ? <VideoCard key={i} video={video} /> : null;
      })}
    </>
  );
}

export function ChatMessages({ messages, sending, chatError, scrollRef, videos }: ChatMessagesProps) {
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
            <AgentMessageBody text={msg.text} videos={videos} />
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
