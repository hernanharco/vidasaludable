import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { api, Message } from "./api";
import { ErrorBanner, toErrorState, type ErrorState } from "./ErrorBanner";

export function ConversationDetailPage() {
  const { id } = useParams();
  const [messages, setMessages] = useState<Message[]>([]);
  const [error, setError] = useState<ErrorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    api
      .listMessages(Number(id))
      .then((res) => {
        setMessages(res.messages);
        setError(null);
      })
      .catch((e) => setError(toErrorState(e)))
      .finally(() => setLoading(false));
  }, [id, reload]);

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error) {
    return (
      <ErrorBanner
        status={error.status}
        detail={error.detail}
        title={error.title}
        onRetry={() => setReload((n) => n + 1)}
      />
    );
  }

  return (
    <div className="max-w-3xl">
      <Link to="/admin/conversations" className="text-sm text-emerald-800 hover:underline">
        ← Volver a conversaciones
      </Link>
      <h1 className="mt-2 font-serif text-2xl">Conversación #{id}</h1>
      {messages.length === 0 ? (
        <p className="mt-6 text-stone-500">Sin mensajes.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`p-4 border ${
                m.role === "assistant"
                  ? "bg-emerald-50 border-emerald-200 ml-8"
                  : "bg-white border-stone-200 mr-8"
              }`}
            >
              <div className="flex items-center justify-between text-xs text-stone-500">
                <span className="uppercase tracking-wider">{m.role}</span>
                <span>{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              <p className="mt-2 text-sm whitespace-pre-wrap">{m.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}