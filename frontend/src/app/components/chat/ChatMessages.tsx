import React from "react";
import { AlertCircle, CheckCircle2 } from "lucide-react";

export interface ChatMessage {
  sender: "user" | "agent";
  text: string;
}

interface ChatMessagesProps {
  messages: ChatMessage[];
  sending: boolean;
  chatError: string | null;
  scrollRef: React.RefObject<HTMLDivElement>;
}

export function ChatMessages({ messages, sending, chatError, scrollRef }: ChatMessagesProps) {
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
          {msg.text}
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
