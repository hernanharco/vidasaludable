import { useEffect, useState } from "react";
import { api, Product, Recommendation } from "./api";
import { ProductRefs } from "./ProductRefs";
import { ErrorBanner, toErrorState, type ErrorState } from "./ErrorBanner";

function parseRefs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<ErrorState | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    Promise.all([api.listRecommendations(), api.listProducts()])
      .then(([recs, catalog]) => {
        setRecommendations(recs.recommendations);
        setProducts(catalog.products);
        setError(null);
      })
      .catch((e) => setError(toErrorState(e)))
      .finally(() => setLoading(false));
  }, [reload]);

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
    <div>
      <h1 className="font-serif text-2xl">Recomendaciones</h1>
      <p className="mt-1 text-sm text-stone-500">
        Log de auditoría append-only. Lectura únicamente: no se editan ni eliminan
        registros (integridad legal).
      </p>
      {recommendations.length === 0 ? (
        <p className="mt-6 text-stone-500">Aún no hay recomendaciones registradas.</p>
      ) : (
        <div className="mt-6 space-y-4">
          {recommendations.map((r) => (
            <div key={r.id} className="p-5 bg-white border border-stone-200">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-stone-500">
                <span>#{r.id}</span>
                <span>{new Date(r.createdAt).toLocaleString()}</span>
                <span>Cliente #{r.customerId}</span>
                <span>Conversación #{r.conversationId}</span>
                <span>Consent v{r.consentVersion}</span>
                {r.guardBlocked && (
                  <span className="px-2 py-0.5 bg-red-100 text-red-700 uppercase tracking-wider">
                    guard blocked
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm">
                <span className="font-medium">Síntoma:</span> {r.symptom}
              </p>
              <p className="mt-1 text-sm">
                <span className="font-medium">Productos:</span>{" "}
                <ProductRefs references={parseRefs(r.productReferences)} products={products} />
              </p>
              <p className="mt-1 text-sm text-stone-600">
                <span className="font-medium">Racional:</span> {r.rationale}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}