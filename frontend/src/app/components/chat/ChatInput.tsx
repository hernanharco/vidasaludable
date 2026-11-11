import React, { useRef } from "react";
import { Send, CheckCircle2, Paperclip, Loader2 } from "lucide-react";
import { toast } from "sonner";

/**
 * T4 tamizaje — client-side upload cap. Mirrors the backend's 8 MB DECODED
 * limit (imageService.MAX_IMAGE_BYTES) so oversized files are rejected with
 * a toast BEFORE any API call.
 */
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

interface ChatInputProps {
  inputValue: string;
  sending: boolean;
  onInputChange: (value: string) => void;
  onSend: (e: React.FormEvent) => void;
  /**
   * T4 tamizaje — uploads the selected image (already read as a dataURL).
   * Resolves `true` on success so the file input can hand back clean.
   * The POST itself lives in ChatSession (it owns every chat fetch and the
   * /ask 401 re-consent plumbing); omitted outside the chat phase → the
   * attach affordance is not rendered at all.
   */
  onUploadImage?: (dataUrl: string) => Promise<boolean>;
  /** T4 — true while an upload is in flight: the attach button is disabled. */
  uploading?: boolean;
}

/** FileReader → dataURL; resolves `null` on read failure. */
function readAsDataURL(file: File): Promise<string | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

export function ChatInput({
  inputValue,
  sending,
  onInputChange,
  onSend,
  onUploadImage,
  uploading = false,
}: ChatInputProps) {
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    // Cleared as soon as the file is captured: the same report stays
    // re-selectable after ANY outcome (success included — the T4 contract
    // is that a successful upload hands back a clean input).
    input.value = "";
    if (!file || !onUploadImage) return;

    // 8MB cap BEFORE reading or calling the API — reject with a toast.
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("La imagen supera el límite de 8 MB. Elige una más pequeña.");
      return;
    }

    const dataUrl = await readAsDataURL(file);
    if (dataUrl == null) {
      toast.error("No pudimos leer el archivo. Inténtalo de nuevo.");
      return;
    }

    try {
      await onUploadImage(dataUrl);
    } catch {
      // The lifted handler reports its own errors; this only guards an
      // unexpectedly rejecting handler injected by another call site.
      toast.error("No se pudo enviar la imagen. Inténtalo de nuevo.");
    }
  };

  return (
    <div className="p-3 bg-white border-t border-stone-200">
      <form onSubmit={onSend} className="flex items-center gap-2">
        {/* T4 tamizaje — attach affordance: chat phase only (the parent
            passes `onUploadImage` solely there; gates/intake never render
            ChatInput at all). */}
        {onUploadImage && (
          <>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              aria-label="Adjuntar imagen"
              className="w-10 h-10 bg-stone-100 text-stone-600 rounded-full flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed hover:bg-stone-200 transition-colors shrink-0"
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              ) : (
                <Paperclip className="w-4 h-4" aria-hidden="true" />
              )}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              tabIndex={-1}
              aria-hidden="true"
              onChange={handleFileChange}
            />
          </>
        )}
        <input
          type="text"
          value={inputValue}
          onChange={(e) => onInputChange(e.target.value)}
          placeholder="Escribe un mensaje..."
          aria-label="Escribir mensaje"
          className="flex-1 px-4 py-2.5 min-h-11 bg-stone-100 rounded-full text-base md:text-sm focus:outline-none focus:ring-1 focus:ring-emerald-900 transition-shadow"
        />
        <button
          type="submit"
          disabled={!inputValue.trim() || sending}
          aria-label={sending ? "Mensaje enviado" : "Enviar mensaje"}
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
