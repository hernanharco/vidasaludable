import React from "react";
import { X, Sparkles, Menu } from "lucide-react";

/**
 * multi-conversation T2 (S3) — id of the menu toggle, referenced by the
 * panel for focus restoration when it closes (same pattern as the admin
 * drawer's hamburger).
 */
export const CHAT_CONVERSATIONS_TOGGLE_ID = "chat-conversations-toggle";

interface ChatHeaderProps {
  onClose: () => void;
  /**
   * multi-conversation T2 (S3) — opens the conversations panel (sidebar on
   * desktop, slide-in drawer on mobile). Omitted outside the chat phase:
   * the gates and the intake questionnaire have no conversation list.
   */
  onToggleConversations?: () => void;
  /** True while the conversations panel is open (drives aria-expanded). */
  conversationsOpen?: boolean;
}

export function ChatHeader({
  onClose,
  onToggleConversations,
  conversationsOpen = false,
}: ChatHeaderProps) {
  return (
    <div className="bg-emerald-900 px-4 py-3 flex items-center justify-between text-white">
      <div className="flex items-center gap-2">
        {onToggleConversations && (
          <button
            type="button"
            id={CHAT_CONVERSATIONS_TOGGLE_ID}
            onClick={onToggleConversations}
            aria-label="Conversaciones"
            aria-expanded={conversationsOpen}
            aria-controls={conversationsOpen ? "chat-conversations" : undefined}
            className="p-2 -ml-2 rounded-full flex items-center justify-center text-emerald-200 hover:text-white transition-colors"
          >
            <Menu className="w-5 h-5" />
          </button>
        )}
        <div className="w-8 h-8 bg-emerald-800 rounded-full flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-emerald-100" />
        </div>
        <div>
          <h1 className="font-medium text-sm">Análisis IA</h1>
          <p className="text-xs text-emerald-200">Listo para analizar</p>
        </div>
      </div>
      <button
        onClick={onClose}
        aria-label="Cerrar chat"
        className="p-3 rounded-full flex items-center justify-center text-emerald-200 hover:text-white transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
