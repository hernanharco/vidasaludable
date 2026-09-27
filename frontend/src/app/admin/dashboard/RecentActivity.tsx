import { Activity, AlertTriangle } from "lucide-react";

interface ActivityItem {
  id: number;
  customer: string;
  symptom: string;
  products: string;
  blocked: boolean;
  at: string;
}

interface RecentActivityProps {
  activities: ActivityItem[];
}

export function RecentActivity({ activities }: RecentActivityProps) {
  return (
    <div className="bg-white border border-stone-200 p-5">
      <div className="flex items-center gap-2">
        <Activity className="w-4 h-4 text-emerald-800" />
        <h2 className="text-sm font-medium text-stone-700">Actividad reciente</h2>
      </div>
      {activities.length === 0 ? (
        <p className="mt-6 text-sm text-stone-400">
          Aún no hay recomendaciones. Cuando un cliente chatee con el asistente, verás aquí la
          actividad.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-stone-100">
          {activities.map((r) => (
            <li key={r.id} className="py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-stone-800">{r.customer}</span>
                <span className="text-xs text-stone-400">{r.at}</span>
              </div>
              <p className="mt-0.5 text-xs text-stone-500 italic">"{r.symptom}"</p>
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-emerald-900">{r.products}</span>
                {r.blocked && (
                  <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-medium">
                    <AlertTriangle className="w-3 h-3" /> guard
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
