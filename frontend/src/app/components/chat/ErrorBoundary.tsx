import React from "react";

/**
 * intake-health-data S6 — the frontend had NO error boundary, so any render
 * error left the chat as a blank screen ("algunos usuarios después de llenar
 * el formulario se queda la pantalla en blanco"). This boundary catches
 * render errors from its children and shows an actionable fallback instead
 * of nothing: retry re-renders the subtree, reload is the second escape
 * hatch. It wraps the whole chat surface (see ChatPage).
 *
 * Props:
 * - `onRecover` (optional): called when the user presses "Reintentar",
 *   BEFORE the children re-render. The host can reset transient state
 *   (ChatPage clears the flag that forces the fallback).
 * - `children`: the subtree to protect.
 */
interface ErrorBoundaryProps {
  children: React.ReactNode;
  onRecover?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    // Any thrown render error flips the boundary to its fallback UI.
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown): void {
    // Kept console-only on purpose: the chat runs on static hosting without
    // an error-reporting endpoint, and a silent blank screen is strictly
    // worse than a logged stack.
    console.error("Chat render error:", error, info);
  }

  private handleRetry = () => {
    this.props.onRecover?.();
    this.setState({ hasError: false });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div
          role="alert"
          className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-center bg-stone-50"
        >
          <p className="text-sm font-medium text-stone-800">
            Algo salió mal al mostrar el chat.
          </p>
          <p className="text-xs text-stone-500 max-w-sm">
            No te preocupes, tus datos no se han perdido. Puedes reintentar
            ahora o recargar la página.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={this.handleRetry}
              className="px-4 py-2 text-sm font-medium rounded-full bg-emerald-900 text-white hover:bg-emerald-800 transition-colors"
            >
              Reintentar
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-4 py-2 text-sm font-medium rounded-full border border-stone-300 text-stone-700 hover:bg-stone-100 transition-colors"
            >
              Recargar la página
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
