import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import type {
  AssessmentSymptom,
  AssessmentNutrient,
  AssessmentMapping,
  AssessmentResult,
} from "./api";

type Tab = "symptoms" | "nutrients" | "mappings" | "results";

type SortDir = "asc" | "desc";

function SortableTh({
  label,
  sortKey,
  activeKey,
  activeDir,
  onSort,
  className = "",
}: {
  label: string;
  sortKey: string;
  activeKey: string | null;
  activeDir: SortDir;
  onSort: (key: string) => void;
  className?: string;
}) {
  const active = activeKey === sortKey;
  return (
    <th
      className={`px-4 py-3 font-medium text-stone-600 cursor-pointer select-none hover:text-stone-900 transition-colors ${className}`}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        <span className="text-xs text-stone-400">
          {active ? (activeDir === "asc" ? "▲" : "▼") : "⇅"}
        </span>
      </span>
    </th>
  );
}

function useTableSort<T>(items: T[], defaultKey: string, defaultDir: SortDir = "asc") {
  const [sortKey, setSortKey] = useState<string>(defaultKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultDir);

  const toggleSort = (key: string) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const sorted = [...items].sort((a, b) => {
    const av = (a as Record<string, unknown>)[sortKey];
    const bv = (b as Record<string, unknown>)[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === "number" && typeof bv === "number") {
      return sortDir === "asc" ? av - bv : bv - av;
    }
    const cmp = String(av).localeCompare(String(bv), "es");
    return sortDir === "asc" ? cmp : -cmp;
  });

  return { sorted, sortKey, sortDir, toggleSort };
}

const TABS: { key: Tab; label: string }[] = [
  { key: "symptoms", label: "Síntomas" },
  { key: "nutrients", label: "Nutrientes" },
  { key: "mappings", label: "Mapeos" },
  { key: "results", label: "Resultados" },
];

const NUTRIENT_TYPES = ["vitamin", "mineral", "fatty_acid", "supplement"] as const;

const TYPE_LABELS: Record<string, string> = {
  vitamin: "Vitamina",
  mineral: "Mineral",
  fatty_acid: "Ácido graso",
  supplement: "Suplemento",
};

/**
 * Admin CRUD for the assessment system:
 * symptoms, nutrients, symptom↔nutrient mappings, and completed results.
 */
export function AssessmentAdminPage() {
  const [tab, setTab] = useState<Tab>("symptoms");

  // Shared state
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Symptoms
  const [symptoms, setSymptoms] = useState<AssessmentSymptom[]>([]);
  const [symForm, setSymForm] = useState<{ id: string; nameEs: string }>({ id: "", nameEs: "" });
  const [editingSymId, setEditingSymId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  // Nutrients
  const [nutrients, setNutrients] = useState<AssessmentNutrient[]>([]);
  const [nutForm, setNutForm] = useState<{ id: string; name: string; type: string }>({
    id: "",
    name: "",
    type: "vitamin",
  });
  const [editingNutId, setEditingNutId] = useState<string | null>(null);

  // Mappings
  const [mappings, setMappings] = useState<AssessmentMapping[]>([]);
  const [mapForm, setMapForm] = useState<{ symptomId: string; nutrientId: string; weight: string }>({
    symptomId: "",
    nutrientId: "",
    weight: "1",
  });
  const [editingMapKey, setEditingMapKey] = useState<{
    symptomId: number;
    nutrientId: string;
  } | null>(null);
  const [mapWeight, setMapWeight] = useState<string>("1");

  // Results
  const [results, setResults] = useState<AssessmentResult[]>([]);

  // ─── Sorting
  const symSort = useTableSort(symptoms, "id");
  const nutSort = useTableSort(nutrients, "id");
  const mapSort = useTableSort(mappings, "symptomId");
  const resSort = useTableSort(results, "createdAt", "desc");

  // ─── Loaders ───────────────────────────────────────────────────────

  const loadSymptoms = useCallback(async () => {
    try {
      const data = await api.listAssessmentSymptoms();
      setSymptoms(data.symptoms);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading symptoms");
    }
  }, []);

  const loadNutrients = useCallback(async () => {
    try {
      const data = await api.listAssessmentNutrients();
      setNutrients(data.nutrients);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading nutrients");
    }
  }, []);

  const loadMappings = useCallback(async () => {
    try {
      const data = await api.listAssessmentMappings();
      setMappings(data.mappings);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading mappings");
    }
  }, []);

  const loadResults = useCallback(async () => {
    try {
      const data = await api.listAssessmentResults();
      setResults(data.assessments);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error loading results");
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    await Promise.all([loadSymptoms(), loadNutrients(), loadMappings(), loadResults()]);
    setLoading(false);
  }, [loadSymptoms, loadNutrients, loadMappings, loadResults]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ─── Symptom handlers ──────────────────────────────────────────────

  async function handleSymSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingSymId !== null) {
        await api.updateAssessmentSymptom(editingSymId, { nameEs: symForm.nameEs });
      } else {
        const id = Number(symForm.id);
        if (!Number.isInteger(id) || id < 1) throw new Error("El ID debe ser un número entero positivo");
        await api.createAssessmentSymptom({ id, nameEs: symForm.nameEs });
      }
      setSymForm({ id: "", nameEs: "" });
      setEditingSymId(null);
      await loadSymptoms();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function startEditSym(s: AssessmentSymptom) {
    setEditingSymId(s.id);
    setSymForm({ id: String(s.id), nameEs: s.nameEs });
    setError(null);
  }

  async function handleDeleteSym(id: number) {
    if (!confirm("¿Eliminar este síntoma? Se verificará que no esté en uso.")) return;
    try {
      await api.deleteAssessmentSymptom(id);
      await loadSymptoms();
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  // ─── Nutrient handlers ─────────────────────────────────────────────

  async function handleNutSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (editingNutId !== null) {
        await api.updateAssessmentNutrient(editingNutId, {
          name: nutForm.name,
          type: nutForm.type,
        });
      } else {
        await api.createAssessmentNutrient({
          id: nutForm.id,
          name: nutForm.name,
          type: nutForm.type,
        });
      }
      setNutForm({ id: "", name: "", type: "vitamin" });
      setEditingNutId(null);
      await loadNutrients();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  function startEditNut(n: AssessmentNutrient) {
    setEditingNutId(n.id);
    setNutForm({ id: n.id, name: n.name, type: n.type });
    setError(null);
  }

  async function handleDeleteNut(id: string) {
    if (!confirm("¿Eliminar este nutriente? Se verificará que no esté en uso.")) return;
    try {
      await api.deleteAssessmentNutrient(id);
      await loadNutrients();
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  // ─── Mapping handlers ──────────────────────────────────────────────

  async function handleMapSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const symptomId = Number(mapForm.symptomId);
      const nutrientId = mapForm.nutrientId;
      const weight = Number(mapForm.weight);
      if (!Number.isInteger(symptomId)) throw new Error("Seleccione un síntoma válido");
      if (!nutrientId) throw new Error("Seleccione un nutriente");
      if (weight !== 1 && weight !== 2) throw new Error("El peso debe ser 1 o 2");

      await api.createAssessmentMapping({ symptomId, nutrientId, weight });
      setMapForm({ symptomId: "", nutrientId: "", weight: "1" });
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleMapWeightUpdate() {
    if (!editingMapKey) return;
    const weight = Number(mapWeight);
    if (weight !== 1 && weight !== 2) {
      setError("El peso debe ser 1 o 2");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.updateAssessmentMapping({
        symptomId: editingMapKey.symptomId,
        nutrientId: editingMapKey.nutrientId,
        weight,
      });
      setEditingMapKey(null);
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al actualizar");
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteMap(symptomId: number, nutrientId: string) {
    if (!confirm("¿Eliminar este mapeo?")) return;
    try {
      await api.deleteAssessmentMapping({ symptomId, nutrientId });
      await loadMappings();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  // ─── Render helpers ────────────────────────────────────────────────

  const symptomName = (id: number) =>
    symptoms.find((s) => s.id === id)?.nameEs ?? `#${id}`;

  const nutrientLabel = (id: string) =>
    nutrients.find((n) => n.id === id)?.name ?? id;

  if (loading) return <p className="text-stone-500">Cargando…</p>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-stone-900">Evaluación Preventiva</h1>
        <p className="text-sm text-stone-500 mt-1">
          Gestión de síntomas, nutrientes y mapeos clínicos del cuestionario de prevención.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error}
          <button
            onClick={() => setError(null)}
            className="ml-2 text-red-500 hover:text-red-700 underline"
          >
            cerrar
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setError(null); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-emerald-600 text-emerald-700"
                : "border-transparent text-stone-500 hover:text-stone-700"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ─── Symptoms Tab ─────────────────────────────────────────── */}
      {tab === "symptoms" && (
        <div className="space-y-4">
          <form onSubmit={handleSymSubmit} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <h3 className="text-sm font-medium text-stone-700">
              {editingSymId !== null ? `Editar síntoma #${editingSymId}` : "Nuevo síntoma"}
            </h3>
            <div className="flex gap-3 items-end">
              <label className="text-xs text-stone-600 w-24">
                ID
                <input
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={symForm.id}
                  onChange={(e) => setSymForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="Ej: 1"
                  disabled={editingSymId !== null}
                  required
                />
              </label>
              <label className="text-xs text-stone-600 flex-1">
                Nombre (ES)
                <input
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={symForm.nameEs}
                  onChange={(e) => setSymForm((f) => ({ ...f, nameEs: e.target.value }))}
                  placeholder="Ej: Dolor de cabeza"
                  required
                />
              </label>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Guardando…" : editingSymId !== null ? "Actualizar" : "Crear"}
              </button>
              {editingSymId !== null && (
                <button
                  type="button"
                  onClick={() => { setEditingSymId(null); setSymForm({ id: "", nameEs: "" }); }}
                  className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          {symptoms.length === 0 ? (
            <p className="text-stone-500 text-sm">No hay síntomas cargados.</p>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50">
                    <SortableTh label="ID" sortKey="id" activeKey={symSort.sortKey} activeDir={symSort.sortDir} onSort={symSort.toggleSort} />
                    <SortableTh label="Nombre" sortKey="nameEs" activeKey={symSort.sortKey} activeDir={symSort.sortDir} onSort={symSort.toggleSort} />
                    <th className="text-right px-4 py-3 font-medium text-stone-600">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {symSort.sorted.map((s) => (
                    <tr key={s.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-3 font-mono text-xs">{s.id}</td>
                      <td className="px-4 py-3">{s.nameEs}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => startEditSym(s)}
                          className="text-xs text-stone-500 hover:text-stone-700"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteSym(s.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {symptoms.length} síntomas
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Nutrients Tab ────────────────────────────────────────── */}
      {tab === "nutrients" && (
        <div className="space-y-4">
          <form onSubmit={handleNutSubmit} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <h3 className="text-sm font-medium text-stone-700">
              {editingNutId !== null ? `Editar nutriente: ${editingNutId}` : "Nuevo nutriente"}
            </h3>
            <div className="flex gap-3 items-end flex-wrap">
              <label className="text-xs text-stone-600 w-40">
                ID
                <input
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={nutForm.id}
                  onChange={(e) => setNutForm((f) => ({ ...f, id: e.target.value }))}
                  placeholder="Ej: vitamina_a"
                  disabled={editingNutId !== null}
                  required
                />
              </label>
              <label className="text-xs text-stone-600 flex-1">
                Nombre
                <input
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={nutForm.name}
                  onChange={(e) => setNutForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ej: Vitamina A"
                  required
                />
              </label>
              <label className="text-xs text-stone-600 w-40">
                Tipo
                <select
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={nutForm.type}
                  onChange={(e) => setNutForm((f) => ({ ...f, type: e.target.value }))}
                >
                  {NUTRIENT_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {TYPE_LABELS[t]}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Guardando…" : editingNutId !== null ? "Actualizar" : "Crear"}
              </button>
              {editingNutId !== null && (
                <button
                  type="button"
                  onClick={() => {
                    setEditingNutId(null);
                    setNutForm({ id: "", name: "", type: "vitamin" });
                  }}
                  className="px-4 py-2 text-sm text-stone-500 hover:text-stone-700"
                >
                  Cancelar
                </button>
              )}
            </div>
          </form>

          {nutrients.length === 0 ? (
            <p className="text-stone-500 text-sm">No hay nutrientes cargados.</p>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50">
                    <SortableTh label="ID" sortKey="id" activeKey={nutSort.sortKey} activeDir={nutSort.sortDir} onSort={nutSort.toggleSort} />
                    <SortableTh label="Nombre" sortKey="name" activeKey={nutSort.sortKey} activeDir={nutSort.sortDir} onSort={nutSort.toggleSort} />
                    <SortableTh label="Tipo" sortKey="type" activeKey={nutSort.sortKey} activeDir={nutSort.sortDir} onSort={nutSort.toggleSort} />
                    <th className="text-right px-4 py-3 font-medium text-stone-600">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {nutSort.sorted.map((n) => (
                    <tr key={n.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-3 font-mono text-xs">{n.id}</td>
                      <td className="px-4 py-3">{n.name}</td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                          {TYPE_LABELS[n.type] ?? n.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button
                          onClick={() => startEditNut(n)}
                          className="text-xs text-stone-500 hover:text-stone-700"
                        >
                          Editar
                        </button>
                        <button
                          onClick={() => handleDeleteNut(n.id)}
                          className="text-xs text-red-500 hover:text-red-700"
                        >
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {nutrients.length} nutrientes
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Mappings Tab ─────────────────────────────────────────── */}
      {tab === "mappings" && (
        <div className="space-y-4">
          <form onSubmit={handleMapSubmit} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <h3 className="text-sm font-medium text-stone-700">Nuevo mapeo</h3>
            <div className="flex gap-3 items-end flex-wrap">
              <label className="text-xs text-stone-600 flex-1 min-w-[200px]">
                Síntoma
                <select
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={mapForm.symptomId}
                  onChange={(e) => setMapForm((f) => ({ ...f, symptomId: e.target.value }))}
                  required
                >
                  <option value="">Seleccionar…</option>
                  {symptoms.map((s) => (
                    <option key={s.id} value={s.id}>
                      #{s.id} — {s.nameEs}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-stone-600 flex-1 min-w-[200px]">
                Nutriente
                <select
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={mapForm.nutrientId}
                  onChange={(e) => setMapForm((f) => ({ ...f, nutrientId: e.target.value }))}
                  required
                >
                  <option value="">Seleccionar…</option>
                  {nutrients.map((n) => (
                    <option key={n.id} value={n.id}>
                      {n.name} ({n.id})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-stone-600 w-20">
                Peso
                <select
                  className="mt-1 w-full border border-stone-300 px-3 py-2 text-sm rounded-lg"
                  value={mapForm.weight}
                  onChange={(e) => setMapForm((f) => ({ ...f, weight: e.target.value }))}
                >
                  <option value="1">1 — Moderado</option>
                  <option value="2">2 — Fuerte</option>
                </select>
              </label>
              <button
                type="submit"
                disabled={saving}
                className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? "Guardando…" : "Crear"}
              </button>
            </div>
          </form>

          {mappings.length === 0 ? (
            <p className="text-stone-500 text-sm">No hay mapeos cargados.</p>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50">
                    <SortableTh label="Síntoma" sortKey="symptomName" activeKey={mapSort.sortKey} activeDir={mapSort.sortDir} onSort={mapSort.toggleSort} />
                    <SortableTh label="Nutriente" sortKey="nutrientName" activeKey={mapSort.sortKey} activeDir={mapSort.sortDir} onSort={mapSort.toggleSort} />
                    <SortableTh label="Peso" sortKey="weight" activeKey={mapSort.sortKey} activeDir={mapSort.sortDir} onSort={mapSort.toggleSort} className="text-center" />
                    <th className="text-right px-4 py-3 font-medium text-stone-600">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {mapSort.sorted.map((m) => {
                    const isEditing =
                      editingMapKey?.symptomId === m.symptomId &&
                      editingMapKey?.nutrientId === m.nutrientId;
                    return (
                      <tr key={`${m.symptomId}-${m.nutrientId}`} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="px-4 py-3">
                          <span className="text-xs text-stone-400 mr-1">#{m.symptomId}</span>
                          {m.symptomName}
                        </td>
                        <td className="px-4 py-3">{m.nutrientName}</td>
                        <td className="px-4 py-3 text-center">
                          {isEditing ? (
                            <select
                              value={mapWeight}
                              onChange={(e) => setMapWeight(e.target.value)}
                              className="border border-stone-300 px-2 py-1 text-sm rounded"
                            >
                              <option value="1">1</option>
                              <option value="2">2</option>
                            </select>
                          ) : (
                            <span
                              className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                                m.weight === 2
                                  ? "bg-amber-100 text-amber-700"
                                  : "bg-stone-100 text-stone-600"
                              }`}
                            >
                              {m.weight} — {m.weight === 2 ? "Fuerte" : "Moderado"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {isEditing ? (
                            <>
                              <button
                                onClick={handleMapWeightUpdate}
                                disabled={saving}
                                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                              >
                                Guardar
                              </button>
                              <button
                                onClick={() => setEditingMapKey(null)}
                                className="text-xs text-stone-500 hover:text-stone-700"
                              >
                                Cancelar
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => {
                                  setEditingMapKey({ symptomId: m.symptomId, nutrientId: m.nutrientId });
                                  setMapWeight(String(m.weight));
                                }}
                                className="text-xs text-stone-500 hover:text-stone-700"
                              >
                                Editar peso
                              </button>
                              <button
                                onClick={() => handleDeleteMap(m.symptomId, m.nutrientId)}
                                className="text-xs text-red-500 hover:text-red-700"
                              >
                                Eliminar
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {mappings.length} mapeos
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── Results Tab (read-only) ──────────────────────────────── */}
      {tab === "results" && (
        <div>
          {results.length === 0 ? (
            <div className="bg-stone-50 rounded-xl border border-stone-200 p-8 text-center">
              <p className="text-stone-500">No hay evaluaciones completadas todavía.</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-stone-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-200 bg-stone-50">
                    <SortableTh label="Paciente" sortKey="patientName" activeKey={resSort.sortKey} activeDir={resSort.sortDir} onSort={resSort.toggleSort} />
                    <SortableTh label="Sexo" sortKey="patientSex" activeKey={resSort.sortKey} activeDir={resSort.sortDir} onSort={resSort.toggleSort} />
                    <SortableTh label="Edad" sortKey="patientAge" activeKey={resSort.sortKey} activeDir={resSort.sortDir} onSort={resSort.toggleSort} className="text-center" />
                    <SortableTh label="Estado" sortKey="status" activeKey={resSort.sortKey} activeDir={resSort.sortDir} onSort={resSort.toggleSort} />
                    <SortableTh label="Creada" sortKey="createdAt" activeKey={resSort.sortKey} activeDir={resSort.sortDir} onSort={resSort.toggleSort} />
                    <SortableTh label="Completada" sortKey="completedAt" activeKey={resSort.sortKey} activeDir={resSort.sortDir} onSort={resSort.toggleSort} />
                  </tr>
                </thead>
                <tbody>
                  {resSort.sorted.map((r) => (
                    <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                      <td className="px-4 py-3">{r.patientName}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            r.patientSex === "F"
                              ? "bg-pink-100 text-pink-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          {r.patientSex}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">{r.patientAge}</td>
                      <td className="px-4 py-3">
                        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-xs text-stone-500">{r.createdAt}</td>
                      <td className="px-4 py-3 text-xs text-stone-500">{r.completedAt ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {results.length} evaluaciones completadas
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
