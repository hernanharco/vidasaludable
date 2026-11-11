import React, { useEffect, useRef, useState } from "react";
import { Plus } from "lucide-react";
import type { ChatMessage } from "./ChatMessages";
import { CHAT_CONVERSATIONS_TOGGLE_ID } from "./ChatHeader";

/**
 * multi-conversation T2 (S1/S3) — the conversation list behind the menu
 * button in ChatHeader (Gemini-style).
 *
 * Mounted only while open: ChatSession owns the open state and mounts this
 * panel for the chat phase. Layout follows the repo's mobile-ui convention
 * (AdminLayout's drawer): below `md` it slides in from the left over a
 * tap-to-close backdrop — never a fixed wide sidebar on small screens; at
 * `md+` it renders in flow as a sidebar panel that pushes the chat aside.
 *
 * Drawer behaviour mirrors the admin drawer: Escape closes, focus starts
 * inside the panel, a Tab trap keeps focus in it while open, closing
 * restores focus to the ChatHeader toggle, and the body scroll is locked
 * while open.
 *
 * Data: GET /api/assistant/conversations?customer_id=N on every open (the
 * API's `updated_at` order is preserved as-is — newest activity first).
 * Labels: API `title` → (current thread) first user message excerpt →
 * `snippet` → "Nueva conversación".
 */

/** Client-side title fallback cap — mirrors the backend's TITLE_MAX_CHARS. */
const TITLE_EXCERPT_MAX_CHARS = 50;

interface ConversationListItem {
  id: number;
  customer_id: number;
  title: string | null;
  updated_at: string;
  created_at: string;
  snippet: string | null;
}

interface ConversationSidebarProps {
  customerId: number;
  /** The active thread — highlighted (`aria-current`) in the list. */
  currentConversationId: number | null;
  /** Live messages of the active thread — source of the title fallback. */
  currentMessages: ChatMessage[];
  /** Closes the panel (menu toggle, Escape, backdrop, after an action). */
  onClose: () => void;
  /** Opens an existing conversation (ChatSession swaps id + loads history). */
  onSelect: (conversationId: number) => void;
  /** POSTs an empty conversation; resolves `false` on failure. */
  onNewConversation: () => Promise<boolean>;
}

/**
 * First user message of the live thread — trimmed, whitespace collapsed
 * and capped — the sensible fallback while the API title is still null
 * (T2 item 4: the title is derived server-side from this same message).
 */
function firstUserExcerpt(messages: ChatMessage[]): string | null {
  const first = messages.find((m) => m.sender === "user");
  if (!first) return null;
  const text = first.text.trim().replace(/\s+/g, " ");
  if (text === "") return null;
  return text.length > TITLE_EXCERPT_MAX_CHARS
    ? `${text.slice(0, TITLE_EXCERPT_MAX_CHARS)}…`
    : text;
}

/** API title → current-thread excerpt → snippet → "Nueva conversación". */
function labelFor(
  item: ConversationListItem,
  currentConversationId: number | null,
  currentMessages: ChatMessage[],
): string {
  if (item.title != null && item.title.trim() !== "") return item.title;
  if (item.id === currentConversationId) {
    const excerpt = firstUserExcerpt(currentMessages);
    if (excerpt != null) return excerpt;
  }
  if (item.snippet != null && item.snippet.trim() !== "") return item.snippet;
  return "Nueva conversación";
}

/** Keep only the fields the list renders; malformed entries are dropped. */
function sanitize(data: unknown, customerId: number): ConversationListItem[] {
  if (data == null || typeof data !== "object" || !Array.isArray((data as { conversations?: unknown }).conversations)) {
    return [];
  }
  const out: ConversationListItem[] = [];
  for (const entry of (data as { conversations: unknown[] }).conversations) {
    if (entry == null || typeof entry !== "object") continue;
    const c = entry as Partial<ConversationListItem>;
    if (typeof c.id !== "number") continue;
    out.push({
      id: c.id,
      customer_id: typeof c.customer_id === "number" ? c.customer_id : customerId,
      title: typeof c.title === "string" ? c.title : null,
      updated_at: typeof c.updated_at === "string" ? c.updated_at : "",
      created_at: typeof c.created_at === "string" ? c.created_at : "",
      snippet: typeof c.snippet === "string" ? c.snippet : null,
    });
  }
  return out;
}

export function ConversationSidebar({
  customerId,
  currentConversationId,
  currentMessages,
  onClose,
  onSelect,
  onNewConversation,
}: ConversationSidebarProps) {
  const asideRef = useRef<HTMLElement>(null);
  const [items, setItems] = useState<ConversationListItem[] | null>(null);
  const [listFailed, setListFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  // Off-canvas on mount, then flipped so the transition actually slides in
  // (a mounted-at-final-position panel would pop in without animation).
  const [shown, setShown] = useState(false);

  // The list is fetched on every open — the component mounts per open.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/assistant/conversations?customer_id=${customerId}`);
        if (!res.ok) throw new Error("conversation list failed");
        const data = await res.json();
        if (cancelled) return;
        setItems(sanitize(data, customerId));
        setListFailed(false);
      } catch {
        if (!cancelled) {
          setItems([]);
          setListFailed(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  // Keep the latest onClose for the mount-scoped listeners below without
  // re-running them on every ChatSession render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Drawer lifecycle: slide-in, Escape, Tab trap, body scroll lock and
  // focus restore to the ChatHeader toggle (AdminLayout drawer parity).
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true));
    document.body.style.overflow = "hidden";
    const aside = asideRef.current;
    const focusables = () =>
      Array.from(
        aside?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
    focusables()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab" && aside) {
        const nodes = focusables();
        if (nodes.length === 0) return;
        const first = nodes[0]!;
        const last = nodes[nodes.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (!active || !aside.contains(active)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && active === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && active === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = "";
      document.getElementById(CHAT_CONVERSATIONS_TOGGLE_ID)?.focus();
    };
  }, []);

  const handleCreate = async () => {
    if (creating) return;
    setCreating(true);
    setCreateFailed(false);
    const ok = await onNewConversation();
    // On success ChatSession closes the panel (this component unmounts);
    // only a failure keeps state to report inline.
    if (!ok) {
      setCreating(false);
      setCreateFailed(true);
    }
  };

  return (
    <>
      {/* Backdrop — mobile drawer only (md:hidden): tapping it closes. */}
      <div
        className="fixed inset-0 z-30 bg-black/40 md:hidden"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        id="chat-conversations"
        ref={asideRef}
        aria-label="Conversaciones"
        className={`fixed inset-y-0 left-0 z-40 w-72 max-w-[85vw] shrink-0 flex flex-col bg-emerald-950 text-stone-100 border-r border-emerald-900 transition-transform duration-200 ease-out shadow-xl md:static md:z-auto md:shadow-none ${
          shown ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <h2 className="px-4 pt-4 pb-2 text-sm font-semibold text-emerald-100">Conversaciones</h2>
        <button
          type="button"
          onClick={handleCreate}
          disabled={creating}
          className="mx-3 mb-2 flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-emerald-50 bg-emerald-800 hover:bg-emerald-700 disabled:opacity-60 transition-colors"
        >
          <Plus className="w-4 h-4" aria-hidden="true" />
          Nueva conversación
        </button>
        {createFailed && (
          <p role="alert" className="px-4 pb-2 text-xs text-amber-200">
            No se pudo crear la conversación. Inténtalo de nuevo.
          </p>
        )}
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {items == null && (
            <p className="px-2 py-2 text-xs text-emerald-200/70">Cargando…</p>
          )}
          {items != null && items.length === 0 && !listFailed && (
            <p className="px-2 py-2 text-xs text-emerald-200/70">Aún no hay conversaciones.</p>
          )}
          {listFailed && (
            <p role="alert" className="px-2 py-2 text-xs text-amber-200">
              No pudimos cargar tus conversaciones.
            </p>
          )}
          {items != null && items.length > 0 && (
            <ul className="space-y-1" role="list">
              {items.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onSelect(item.id)}
                    aria-current={item.id === currentConversationId ? "true" : undefined}
                    className={`w-full text-left rounded-lg px-3 py-2 text-sm transition-colors ${
                      item.id === currentConversationId
                        ? "bg-emerald-900 text-white"
                        : "text-emerald-100 hover:bg-emerald-900/60"
                    }`}
                  >
                    <span className="block truncate">
                      {labelFor(item, currentConversationId, currentMessages)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </aside>
    </>
  );
}
