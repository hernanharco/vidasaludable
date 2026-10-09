import React from "react";
import { X, Sparkles } from "lucide-react";

interface ChatHeaderProps {
  onClose: () => void;
}

export function ChatHeader({ onClose }: ChatHeaderProps) {
  return (
    <div className="bg-emerald-900 px-4 py-3 flex items-center justify-between text-white">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-emerald-800 rounded-full flex items-center justify-center">
          <Sparkles className="w-4 h-4 text-emerald-100" />
        </div>
        <div>
          <h4 className="font-medium text-sm">Análisis IA</h4>
          <p className="text-xs text-emerald-200">Listo para analizar</p>
        </div>
      </div>
      <button
        onClick={onClose}
        className="text-emerald-200 hover:text-white transition-colors"
      >
        <X className="w-5 h-5" />
      </button>
    </div>
  );
}
