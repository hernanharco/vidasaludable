import React from "react";
import { useNavigate } from "react-router";
import { motion } from "motion/react";
import { Sparkles } from "lucide-react";

/**
 * T3 chat-ui-redesign — the single floating entry point for the AI.
 *
 * Replaces the old ChatWidget launcher: instead of opening an in-page popup,
 * it navigates to the dedicated `/chat` route. The Sparkles icon + "Análisis
 * IA" label signal "an AI that analyzes" — no speech bubble, no human-advisor
 * copy. Visual weight and position match the previous launcher so the
 * landing does not shift.
 */
export function ChatLauncher() {
  const navigate = useNavigate();

  return (
    <motion.button
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={() => navigate("/chat")}
      aria-label="Abrir Análisis IA"
      className="fixed bottom-6 right-6 z-50 h-14 px-5 bg-emerald-900 text-white rounded-full shadow-lg flex items-center justify-center gap-2 hover:bg-emerald-800 transition-colors focus:outline-none focus:ring-4 focus:ring-emerald-900/30"
    >
      <Sparkles className="w-6 h-6" />
      {/* Label is desktop-only: hidden on small screens to keep the pill compact */}
      <span className="hidden sm:inline text-sm font-medium">Análisis IA</span>
    </motion.button>
  );
}
