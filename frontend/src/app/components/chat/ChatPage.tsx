import React, { useState } from "react";
import { useNavigate } from "react-router";
import { ChatSession } from "./ChatSession";
import { AssessmentWidget } from "../assessment";

/**
 * T2 — Dedicated `/chat` route: a fullscreen Messenger-style page that hosts
 * the shared `ChatSession` (which already renders its own ChatHeader, the
 * scrollable message area and the ChatInput, and fills whatever hosts it).
 *
 * Height strategy (why both classes):
 * - `min-h-[100dvh]` + `supports-[height:100dvh]:h-[100dvh]` — the *dynamic*
 *   viewport shrinks/grows with mobile browser chrome, so the message area
 *   scrolls instead of the page. A plain `100vh` on mobile measures the
 *   *largest* viewport (chrome hidden) and leaves phantom scroll space —
 *   that is exactly what we avoid.
 * - `h-[100vh]` is the explicit fallback for browsers without `dvh`. It must
 *   NOT be a plain sibling of `h-[100dvh]`: Tailwind sorts same-utility
 *   arbitrary values alphabetically (`100dvh` < `100vh`), so the fallback
 *   would win the cascade. The `supports-` variant re-declares the height
 *   AFTER the base rule and only for dvh-capable browsers — old ones skip
 *   the @supports block and keep the `100vh` fallback.
 */
export function ChatPage() {
  // T3 — the header's X leaves the page: the chat surface closes by
  // navigating back to the landing (there is no popup to return to).
  const navigate = useNavigate();
  // T4/T2 — ChatSession emits the `[ASSESSMENT]` marker card inside the
  // conversation; clicking it opens the prevention wizard on this page too.
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  return (
    <div
      className="min-h-[100dvh] h-[100vh] supports-[height:100dvh]:h-[100dvh] flex flex-col bg-stone-50 font-sans text-stone-900 pb-[env(safe-area-inset-bottom)]"
      // iOS safe area: the home indicator overlays the bottom edge, so the
      // container pads itself (`env(safe-area-inset-bottom)`) to keep the
      // chat input clear of it. Declared as a class so it survives in the
      // DOM everywhere; the declaration is a no-op without env() support.
    >
      <ChatSession
        onOpenAssessment={() => setAssessmentOpen(true)}
        onClose={() => navigate("/")}
      />
      <AssessmentWidget open={assessmentOpen} onClose={() => setAssessmentOpen(false)} />
    </div>
  );
}
