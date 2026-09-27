import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { api, Customer, Product, Recommendation } from "../api";

import { KpiCards } from "./KpiCards";
import { TrendCharts } from "./TrendCharts";
import { ConversionFunnel } from "./ConversionFunnel";
import { TopSymptoms } from "./TopSymptoms";
import { PurchasesChart } from "./PurchasesChart";
import { RecentCustomers } from "./RecentCustomers";
import { RecentActivity } from "./RecentActivity";

interface DashboardData {
  products: Product[];
  customers: Customer[];
  purchases: { id: number; customerId: number; productReference: string; qty: number; purchasedAt: string }[];
  conversations: { id: number; customerId: number; createdAt: string }[];
  recommendations: Recommendation[];
}

/** SQLite datetime "YYYY-MM-DD HH:MM:SS" -> Date */
function parseDT(s: string): Date {
  return new Date(s.replace(" ", "T"));
}

function dayKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function lastNDays(n: number) {
  const today = new Date();
  const out: { key: string; label: string; registros: number; recomendaciones: number }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push({
      key: dayKey(d),
      label: `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`,
      registros: 0,
      recomendaciones: 0,
    });
  }
  return out;
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      api.listProducts(),
      api.listCustomers(),
      api.listPurchases(),
      api.listConversations(),
      api.listRecommendations(),
    ])
      .then(([p, cu, pu, co, r]) => {
        if (!active) return;
        setData({
          products: p.products,
          customers: cu.customers,
          purchases: pu.purchases,
          conversations: co.conversations,
          recommendations: r.recommendations,
        });
        setUpdatedAt(new Date());
      })
      .catch((e: unknown) => {
        if (active) setError(e instanceof Error ? e.message : "Error de red");
      });
    return () => { active = false; };
  }, [reload]);

  const view = useMemo(() => {
    if (!data) return null;

    const byId = new Map(data.customers.map((c) => [c.id, c.name]));
    const productName = new Map(data.products.map((p) => [p.reference, p.name]));

    // 14-day trend buckets
    const trend = lastNDays(14);
    const trendIndex = new Map(trend.map((t) => [t.key, t]));
    data.customers.forEach((c) => {
      const k = dayKey(parseDT(c.registeredAt));
      const bucket = trendIndex.get(k);
      if (bucket) bucket.registros += 1;
    });
    data.recommendations.forEach((r) => {
      const k = dayKey(parseDT(r.createdAt));
      const bucket = trendIndex.get(k);
      if (bucket) bucket.recomendaciones += 1;
    });

    // Top recommended products
    const refCount = new Map<string, number>();
    data.recommendations.forEach((r) => {
      try {
        const refs = JSON.parse(r.productReferences) as string[];
        refs.forEach((ref) => refCount.set(ref, (refCount.get(ref) ?? 0) + 1));
      } catch { /* ignore */ }
    });

    // Conversion funnel
    const chatted = new Set(data.conversations.map((c) => c.customerId));
    const recommended = new Set(data.recommendations.map((r) => r.customerId));
    const purchased = new Set(data.purchases.map((p) => p.customerId));
    const funnel = [
      { label: "Registrados", value: data.customers.length },
      { label: "Con conversación", value: [...chatted].filter((id) => byId.has(id)).length },
      { label: "Con recomendación", value: [...recommended].filter((id) => byId.has(id)).length },
      { label: "Con compra", value: [...purchased].filter((id) => byId.has(id)).length },
    ];

    // Top symptoms
    const symptomCount = new Map<string, number>();
    data.recommendations.forEach((r) => {
      const s = r.symptom.trim().toLowerCase();
      if (!s) return;
      symptomCount.set(s, (symptomCount.get(s) ?? 0) + 1);
    });
    const topSymptoms = [...symptomCount.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count }));

    // Purchases by product
    const qtyByRef = new Map<string, number>();
    data.purchases.forEach((p) => {
      qtyByRef.set(p.productReference, (qtyByRef.get(p.productReference) ?? 0) + p.qty);
    });
    const purchasesByProduct = [...qtyByRef.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([ref, qty]) => ({ name: productName.get(ref) ?? ref, qty }));

    // Recent activity
    const recent = [...data.recommendations]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 6)
      .map((r) => {
        let refs: string[] = [];
        try { refs = JSON.parse(r.productReferences) as string[]; } catch { /* ignore */ }
        return {
          id: r.id,
          customer: byId.get(r.customerId) ?? `Cliente #${r.customerId}`,
          symptom: r.symptom,
          products: refs.map((ref) => productName.get(ref) ?? ref).join(", ") || "—",
          blocked: r.guardBlocked,
          at: r.createdAt.slice(0, 16),
        };
      });

    // Recent customers
    const recentCustomers = [...data.customers]
      .sort((a, b) => b.registeredAt.localeCompare(a.registeredAt))
      .slice(0, 6);

    const blocked = data.recommendations.filter((r) => r.guardBlocked).length;

    return {
      counts: {
        products: data.products.length,
        customers: data.customers.length,
        purchases: data.purchases.length,
        conversations: data.conversations.length,
        recommendations: data.recommendations.length,
        blocked,
      },
      funnel,
      topSymptoms,
      purchasesByProduct,
      trend,
      recent,
      recentCustomers,
    };
  }, [data]);

  if (error) {
    return (
      <div className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900">
        <h2 className="font-serif text-xl">Acceso restringido</h2>
        <p className="mt-2 text-sm">
          El panel /admin solo está disponible en desarrollo
          (<code>NODE_ENV=development</code>). Respuesta del backend: {error}
        </p>
      </div>
    );
  }

  if (!view) {
    return <p className="text-stone-500">Cargando…</p>;
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl">Dashboard</h1>
          <p className="mt-1 text-sm text-stone-500">
            Resumen del CRM interno de vitaminas (recomendador Nutrilite).
            {updatedAt && (
              <span className="ml-1 text-stone-400">
                · Actualizado {updatedAt.toLocaleTimeString()}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {view.counts.blocked > 0 && (
            <div className="flex items-center gap-2 px-4 py-2 bg-amber-100 border border-amber-300 text-amber-900 text-sm rounded-lg">
              <AlertTriangle className="w-4 h-4" />
              {view.counts.blocked} respuesta{view.counts.blocked === 1 ? "" : "s"} bloqueada
              {view.counts.blocked === 1 ? "" : "s"} por el guard legal
            </div>
          )}
          <button
            onClick={() => setReload((n) => n + 1)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-white border border-stone-300 text-sm text-stone-700 hover:border-emerald-800 hover:text-emerald-900 rounded-lg transition-colors"
          >
            <RefreshCw className="w-4 h-4" /> Actualizar
          </button>
        </div>
      </div>

      <KpiCards counts={view.counts} />
      <TrendCharts trend={view.trend} />

      {/* Business insight row */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ConversionFunnel funnel={view.funnel} />
        <TopSymptoms symptoms={view.topSymptoms} />
        <PurchasesChart purchases={view.purchasesByProduct} />
      </div>

      {/* Bottom row */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RecentCustomers customers={view.recentCustomers} />
        <RecentActivity activities={view.recent} />
      </div>
    </div>
  );
}
