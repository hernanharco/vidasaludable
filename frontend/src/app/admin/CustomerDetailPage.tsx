import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  api,
  type Conversation,
  type Customer,
  type CustomerSummary,
  type Purchase,
  type Recommendation,
} from "./api";
import { ErrorBanner, toErrorState, type ErrorState } from "./ErrorBanner";

// T3/T4 (advisor-summary) — per-customer "ficha": profile header, the
// on-demand AI executive summary (S1–S3), and the compact extras (S4)
// assembled client-side from the list endpoints (there is no single-customer
// endpoint besides the summary).

function parseRefs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * Renders stored summary text without a markdown dependency: "## " lines
 * become styled headings, everything else keeps its literal whitespace.
 */
function SummaryContent({ content }: { content: string }) {
  return (
    <div className="mt-3 text-sm leading-relaxed text-stone-700">
      {content.split("\n").map((line, i) => {
        if (line.startsWith("## ")) {
          return (
            <h3
              key={i}
              className="mt-4 font-serif text-base font-semibold text-stone-900 first:mt-0"
            >
              {line.slice(3)}
            </h3>
          );
        }
        if (line.trim() === "") {
          return <div key={i} className="h-3" aria-hidden="true" />;
        }
        return (
          <p key={i} className="whitespace-pre-wrap">
            {line}
          </p>
        );
      })}
    </div>
  );
}

const PRIMARY_BUTTON =
  "px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed";

export function CustomerDetailPage() {
  const { id } = useParams();
  const customerId = Number(id);

  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [loadError, setLoadError] = useState<ErrorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<ErrorState | null>(null);
  const [summaryReload, setSummaryReload] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<ErrorState | null>(null);

  const [extras, setExtras] = useState<{
    recommendations: Recommendation[];
    purchases: Purchase[];
    conversations: Conversation[];
  } | null>(null);
  const [extrasError, setExtrasError] = useState<ErrorState | null>(null);
  const [extrasReload, setExtrasReload] = useState(0);

  // There is no single-customer endpoint: load the list and pick ours.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listCustomers()
      .then((res) => {
        if (cancelled) return;
        setCustomers(res.customers);
        setLoadError(null);
      })
      .catch((e) => {
        if (!cancelled) setLoadError(toErrorState(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setSummaryLoading(true);
    api
      .getCustomerSummary(customerId)
      .then((res) => {
        if (cancelled) return;
        setSummary(res.summary);
        setSummaryError(null);
      })
      .catch((e) => {
        if (!cancelled) setSummaryError(toErrorState(e));
      })
      .finally(() => {
        if (!cancelled) setSummaryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, customerId, summaryReload]);

  // S4 — the extras come from the global list endpoints, filtered here.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([
      api.listRecommendations(),
      api.listPurchases(),
      api.listConversations(),
    ])
      .then(([recs, purchases, conversations]) => {
        if (cancelled) return;
        setExtras({
          recommendations: recs.recommendations.filter(
            (r) => r.customerId === customerId,
          ),
          purchases: purchases.purchases.filter((p) => p.customerId === customerId),
          conversations: conversations.conversations.filter(
            (c) => c.customerId === customerId,
          ),
        });
        setExtrasError(null);
      })
      .catch((e) => {
        if (!cancelled) setExtrasError(toErrorState(e));
      });
    return () => {
      cancelled = true;
    };
  }, [id, customerId, extrasReload]);

  // S3 — demand-driven generation: POST replaces the stored summary.
  const generate = async () => {
    setGenerating(true);
    setGenerateError(null);
    try {
      const res = await api.generateCustomerSummary(customerId);
      setSummary(res.summary);
    } catch (e) {
      setGenerateError(toErrorState(e));
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (loadError) {
    return (
      <ErrorBanner
        status={loadError.status}
        detail={loadError.detail}
        title={loadError.title}
        onRetry={() => setReload((n) => n + 1)}
      />
    );
  }

  const customer = customers?.find((c) => c.id === customerId);
  if (!customer) {
    return (
      <div className="max-w-3xl">
        <Link
          to="/admin/customers"
          className="text-sm text-emerald-800 hover:underline"
        >
          ← Volver a clientes
        </Link>
        <div className="mt-6 p-6 bg-white border border-stone-200">
          <h1 className="font-serif text-xl">Cliente no encontrado</h1>
          <p className="mt-2 text-sm text-stone-500">
            No hay ningún cliente con id {id}. Puede haber sido eliminado.
          </p>
        </div>
      </div>
    );
  }

  const generatingLabel = "Generando… (puede tardar unos segundos)";

  return (
    <div className="max-w-3xl">
      <Link to="/admin/customers" className="text-sm text-emerald-800 hover:underline">
        ← Volver a clientes
      </Link>

      {/* Profile header */}
      <h1 className="mt-2 font-serif text-2xl">{customer.name}</h1>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-stone-600">
        <span>{customer.email}</span>
        <span>{customer.phone}</span>
        <span className="text-stone-500">
          Registrado el {new Date(customer.registeredAt).toLocaleString()}
        </span>
      </div>

      {/* Summary block (S1–S3) */}
      <section className="mt-6 p-5 bg-white border border-stone-200">
        {summaryLoading ? (
          <p className="text-sm text-stone-500">Cargando resumen…</p>
        ) : summaryError ? (
          <ErrorBanner
            status={summaryError.status}
            detail={summaryError.detail}
            title={summaryError.title}
            onRetry={() => setSummaryReload((n) => n + 1)}
          />
        ) : summary ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-lg">Resumen de asesoría</h2>
                <p className="text-xs text-stone-500">
                  Generado el {new Date(summary.generatedAt).toLocaleString()}
                  {summary.model ? ` · ${summary.model}` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={generate}
                disabled={generating}
                className={PRIMARY_BUTTON}
              >
                {generating ? generatingLabel : "Regenerar"}
              </button>
            </div>
            <SummaryContent content={summary.content} />
          </>
        ) : (
          <>
            <h2 className="font-serif text-lg">Resumen ejecutivo (IA)</h2>
            <p className="mt-2 text-sm text-stone-600">
              Un resumen generado con IA de toda la historia del cliente: qué
              consulta, dolores y objeciones que menciona, qué se le recomendó y
              el siguiente paso sugerido. Se genera bajo demanda y queda guardado
              hasta que lo regeneres.
            </p>
            <button
              type="button"
              onClick={generate}
              disabled={generating}
              className={`mt-4 ${PRIMARY_BUTTON}`}
            >
              {generating ? generatingLabel : "Generar resumen"}
            </button>
          </>
        )}
        {generateError && !generating && (
          <div className="mt-4">
            <ErrorBanner
              status={generateError.status}
              detail={generateError.detail}
              title="No pudimos generar el resumen"
            />
          </div>
        )}
      </section>

      {/* Ficha extras (S4) — compact sections, filtered client-side */}
      {extrasError ? (
        <div className="mt-6">
          <ErrorBanner
            status={extrasError.status}
            detail={extrasError.detail}
            title={extrasError.title}
            onRetry={() => setExtrasReload((n) => n + 1)}
          />
        </div>
      ) : !extras ? (
        <p className="mt-6 text-sm text-stone-500">Cargando ficha…</p>
      ) : (
        <div className="mt-6 space-y-6">
          <section>
            <h2 className="font-serif text-lg">Recomendaciones</h2>
            {extras.recommendations.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">
                Sin recomendaciones registradas.
              </p>
            ) : (
              <ul className="mt-2 border border-stone-200 divide-y divide-stone-100">
                {extras.recommendations.map((r) => (
                  <li key={r.id} className="px-4 py-2 text-sm bg-white">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span>
                        <span className="font-medium">{r.symptom}</span> ·
                        Productos:{" "}
                        {parseRefs(r.productReferences).join(", ") || "—"}
                      </span>
                      <span className="text-xs text-stone-500">
                        {new Date(r.createdAt).toLocaleString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-serif text-lg">Compras</h2>
            {extras.purchases.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Sin compras registradas.</p>
            ) : (
              <ul className="mt-2 border border-stone-200 divide-y divide-stone-100">
                {extras.purchases.map((p) => (
                  <li key={p.id} className="px-4 py-2 text-sm bg-white">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                      <span>
                        <span className="font-medium">{p.productReference}</span>{" "}
                        · Cantidad: {p.qty}
                      </span>
                      <span className="text-xs text-stone-500">
                        {new Date(p.purchasedAt).toLocaleString()}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section>
            <h2 className="font-serif text-lg">Conversaciones</h2>
            {extras.conversations.length === 0 ? (
              <p className="mt-2 text-sm text-stone-500">Sin conversaciones.</p>
            ) : (
              <ul className="mt-2 border border-stone-200 divide-y divide-stone-100">
                {extras.conversations.map((c) => (
                  <li
                    key={c.id}
                    className="px-4 py-2 text-sm bg-white flex flex-wrap items-baseline justify-between gap-x-4"
                  >
                    <Link
                      to={`/admin/conversations/${c.id}`}
                      className="text-emerald-800 hover:underline"
                    >
                      Conversación #{c.id}
                    </Link>
                    <span className="text-xs text-stone-500">
                      {new Date(c.createdAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
