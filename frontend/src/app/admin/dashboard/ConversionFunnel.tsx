import { TrendingDown } from "lucide-react";

interface FunnelItem {
  label: string;
  value: number;
}

interface ConversionFunnelProps {
  funnel: FunnelItem[];
}

export function ConversionFunnel({ funnel }: ConversionFunnelProps) {
  const funnelMax = Math.max(funnel[0]?.value ?? 1, 1);

  return (
    <div className="bg-white border border-stone-200 p-5">
      <div className="flex items-center gap-2">
        <TrendingDown className="w-4 h-4 text-emerald-800" />
        <h2 className="text-sm font-medium text-stone-700">Embudo de conversión</h2>
      </div>
      <div className="mt-4 space-y-3">
        {funnel.map((f) => (
          <div key={f.label}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-stone-600">{f.label}</span>
              <span className="font-medium text-stone-800">{f.value}</span>
            </div>
            <div className="mt-1 h-2 bg-stone-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-900 rounded-full"
                style={{ width: `${Math.max((f.value / funnelMax) * 100, f.value > 0 ? 6 : 0)}%` }}
              />
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-stone-400">
        Cuántos registrados llegan a conversar, recibir recomendación y comprar.
      </p>
    </div>
  );
}
