interface Symptom {
  name: string;
  count: number;
}

interface TopSymptomsProps {
  symptoms: Symptom[];
}

export function TopSymptoms({ symptoms }: TopSymptomsProps) {
  return (
    <div className="bg-white border border-stone-200 p-5">
      <h2 className="text-sm font-medium text-stone-700">Top síntomas consultados</h2>
      {symptoms.length === 0 ? (
        <p className="mt-6 text-sm text-stone-400">Sin síntomas registrados todavía.</p>
      ) : (
        <ul className="mt-4 space-y-2.5">
          {symptoms.map((s) => (
            <li key={s.name} className="flex items-center justify-between gap-2 text-sm">
              <span className="text-stone-600 truncate">"{s.name}"</span>
              <span className="shrink-0 font-medium text-emerald-900">{s.count}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-[11px] text-stone-400">
        Qué motivos de consulta aparecen más en el chat.
      </p>
    </div>
  );
}
