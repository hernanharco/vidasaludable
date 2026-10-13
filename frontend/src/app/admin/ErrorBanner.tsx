import React from "react";
import { AdminError } from "./api";

/**
 * T4 (feature ui-optimization, S5a): before this component, seven admin
 * pages rendered the same amber box titled "Acceso restringido" for ANY
 * failure — a network blip read as an authorization problem — and four of
 * them offered no recovery. `errorMessageFor` rotules honestly: 401/403 is
 * authorization; everything else is a transient server/network failure.
 */
export function errorMessageFor(status?: number): {
  title: string;
  detail: string;
} {
  if (status === 401 || status === 403) {
    return {
      title: "Acceso restringido",
      detail:
        "Tu sesión o tus permisos no alcanzan para ver estos datos. Inicia de nuevo o pide acceso a un administrador.",
    };
  }
  return {
    title: "No pudimos cargar los datos",
    detail:
      "El servidor no respondió correctamente. Puede ser una falla temporal de red o del backend.",
  };
}

export interface ErrorState {
  status?: number;
  detail: string;
  title?: string;
}

/**
 * Normalizes a caught value into banner state, preserving the HTTP status
 * of `AdminError` so the banner can rotule authorization vs transient
 * failures honestly.
 */
export function toErrorState(e: unknown): ErrorState {
  if (e instanceof AdminError) return { status: e.status, detail: e.message };
  return { detail: e instanceof Error ? e.message : "Error de red" };
}

interface ErrorBannerProps {
  /** HTTP status of the failed call, when known. */
  status?: number;
  /** Raw backend detail line (e.g. the AdminError message). */
  detail?: string;
  /** Overrides the derived title (e.g. "No pudimos guardar los cambios"). */
  title?: string;
  /** When provided, renders a "Reintentar" recovery button. */
  onRetry?: () => void;
}

export function ErrorBanner({ status, detail, title, onRetry }: ErrorBannerProps) {
  const derived = errorMessageFor(status);
  const heading = title ?? derived.title;
  return (
    <div
      role="alert"
      className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900"
    >
      <h2 className="font-serif text-xl">{heading}</h2>
      <p className="mt-2 text-sm">{derived.detail}</p>
      {detail && (
        <p className="mt-1 text-xs text-amber-700">
          Respuesta del backend: {detail}
        </p>
      )}
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 px-4 py-2 text-sm font-medium rounded-md bg-amber-900/10 hover:bg-amber-900/20 transition-colors"
        >
          Reintentar
        </button>
      )}
    </div>
  );
}
