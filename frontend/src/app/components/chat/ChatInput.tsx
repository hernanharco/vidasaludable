import React from "react";
import { Send, CheckCircle2 } from "lucide-react";

interface ChatInputProps {
  inputValue: string;
  sending: boolean;
  onInputChange: (value: string) => void;
  onSend: (e: React.FormEvent) => void;
}

export function ChatInput({ inputValue, sending, onInputChange, onSend }: ChatInputProps) {
  return (
    <div className="p-3 bg-white border-t border-stone-200">
      <form onSubmit={onSend} className="flex items-center gap-2">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="flex-1 px-4 py-2 bg-stone-100 rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-emerald-900 transition-shadow"
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || sending}
          className="w-10 h-10 bg-emerald-900 text-white rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-800 transition-colors shrink-0"
        >
          {sending ? (
            <CheckCircle2 className="w-4 h-4 ml-1" />
          ) : (
            <Send className="w-4 h-4 ml-1" />
          )}
        </button>
      </form>
    </div>
  );
}
