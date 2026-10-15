import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api } from "./api";
import { DataTable, type DataTableColumn } from "./DataTable";
import type {
  AssessmentSymptom,
  AssessmentNutrient,
  AssessmentMapping,
  AssessmentResult,
} from "./api";
import { ConfirmActionDialog } from "./ConfirmActionDialog";

type Tab = "symptoms" | "nutrients" | "mappings" | "results";

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
  const [confirmSymId, setConfirmSymId] = useState<number | null>(null);
  const [confirmNutId, setConfirmNutId] = useState<string | null>(null);
  const [confirmMap, setConfirmMap] = useState<{
    symptomId: number;
    nutrientId: string;
  } | null>(null);

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
    try {
      await api.deleteAssessmentSymptom(id);
      await loadSymptoms();
      await loadMappings();
      toast.success("Síntoma eliminado");
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
    try {
      await api.deleteAssessmentNutrient(id);
      await loadNutrients();
      await loadMappings();
      toast.success("Nutriente eliminado");
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
    try {
      await api.deleteAssessmentMapping({ symptomId, nutrientId });
      await loadMappings();
      toast.success("Mapeo eliminado");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  // ─── Render helpers ────────────────────────────────────────────────

  const symptomName = (id: number) =>
    symptoms.find((s) => s.id === id)?.nameEs ?? `#${id}`;

  const nutrientLabel = (id: string) =>
    nutrients.find((n) => n.id === id)?.name ?? id;

  // ─── DataTable columns (S4: shared DataTable replaces the local
  // mouse-only useTableSort/SortableTh; sort is now keyboard-accessible) ──

  const symptomColumns: DataTableColumn<AssessmentSymptom>[] = [
    {
      key: "id",
      header: "ID",
      sortable: true,
      cellClassName: "font-mono text-xs",
      render: (s) => s.id,
    },
    { key: "nameEs", header: "Nombre", sortable: true, truncate: true, render: (s) => s.nameEs },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cellClassName: "space-x-2",
      render: (s) => (
        <>
          <button
            onClick={() => startEditSym(s)}
            className="text-xs text-stone-500 hover:text-stone-700"
          >
            Editar
          </button>
          <button
            onClick={() => setConfirmSymId(s.id)}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Eliminar
          </button>
        </>
      ),
    },
  ];

  const nutrientColumns: DataTableColumn<AssessmentNutrient>[] = [
    {
      key: "id",
      header: "ID",
      sortable: true,
      cellClassName: "font-mono text-xs",
      render: (n) => n.id,
    },
    { key: "name", header: "Nombre", sortable: true, truncate: true, render: (n) => n.name },
    {
      key: "type",
      header: "Tipo",
      sortable: true,
      render: (n) => (
        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
          {TYPE_LABELS[n.type] ?? n.type}
        </span>
      ),
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cellClassName: "space-x-2",
      render: (n) => (
        <>
          <button
            onClick={() => startEditNut(n)}
            className="text-xs text-stone-500 hover:text-stone-700"
          >
            Editar
          </button>
          <button
            onClick={() => setConfirmNutId(n.id)}
            className="text-xs text-red-500 hover:text-red-700"
          >
            Eliminar
          </button>
        </>
      ),
    },
  ];

  const mappingColumns: DataTableColumn<AssessmentMapping>[] = [
    {
      key: "symptomName",
      header: "Síntoma",
      sortable: true,
      render: (m) => (
        <>
          <span className="text-xs text-stone-400 mr-1">#{m.symptomId}</span>
          {m.symptomName}
        </>
      ),
    },
    {
      key: "nutrientName",
      header: "Nutriente",
      sortable: true,
      render: (m) => m.nutrientName,
    },
    {
      key: "weight",
      header: "Peso",
      align: "center",
      sortable: true,
      render: (m) => {
        const isEditing =
          editingMapKey?.symptomId === m.symptomId &&
          editingMapKey?.nutrientId === m.nutrientId;
        return isEditing ? (
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
              m.weight === 2 ? "bg-amber-100 text-amber-700" : "bg-stone-100 text-stone-600"
            }`}
          >
            {m.weight} — {m.weight === 2 ? "Fuerte" : "Moderado"}
          </span>
        );
      },
    },
    {
      key: "acciones",
      header: "Acciones",
      align: "right",
      cellClassName: "space-x-2",
      render: (m) => {
        const isEditing =
          editingMapKey?.symptomId === m.symptomId &&
          editingMapKey?.nutrientId === m.nutrientId;
        return isEditing ? (
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
              onClick={() => setConfirmMap({ symptomId: m.symptomId, nutrientId: m.nutrientId })}
              className="text-xs text-red-500 hover:text-red-700"
            >
              Eliminar
            </button>
          </>
        );
      },
    },
  ];

  const resultColumns: DataTableColumn<AssessmentResult>[] = [
    {
      key: "patientName",
      header: "Paciente",
      sortable: true,
      render: (r) => r.patientName,
    },
    {
      key: "patientSex",
      header: "Sexo",
      sortable: true,
      render: (r) => (
        <span
          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
            r.patientSex === "F" ? "bg-pink-100 text-pink-700" : "bg-blue-100 text-blue-700"
          }`}
        >
          {r.patientSex}
        </span>
      ),
    },
    {
      key: "patientAge",
      header: "Edad",
      align: "center",
      sortable: true,
      render: (r) => r.patientAge,
    },
    {
      key: "status",
      header: "Estado",
      sortable: true,
      render: (r) => (
        <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
          {r.status}
        </span>
      ),
    },
    {
      key: "createdAt",
      header: "Creada",
      sortable: true,
      cellClassName: "text-xs text-stone-500",
      render: (r) => r.createdAt,
    },
    {
      key: "completedAt",
      header: "Completada",
      sortable: true,
      cellClassName: "text-xs text-stone-500",
      render: (r) => r.completedAt ?? "—",
    },
  ];

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
            <h2 className="text-sm font-medium text-stone-700">
              {editingSymId !== null ? `Editar síntoma #${editingSymId}` : "Nuevo síntoma"}
            </h2>
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

          <DataTable
            columns={symptomColumns}
            rows={symptoms}
            getRowKey={(s) => String(s.id)}
            emptyMessage="No hay síntomas cargados."
            searchable
            searchText={(s) => `${s.nameEs} ${s.id}`}
            initialSort={{ key: "id", dir: "asc" }}
            containerClassName="bg-white rounded-xl border border-stone-200"
            footer={
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {symptoms.length} síntomas
              </div>
            }
          />
        </div>
      )}

      {/* ─── Nutrients Tab ────────────────────────────────────────── */}
      {tab === "nutrients" && (
        <div className="space-y-4">
          <form onSubmit={handleNutSubmit} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <h2 className="text-sm font-medium text-stone-700">
              {editingNutId !== null ? `Editar nutriente: ${editingNutId}` : "Nuevo nutriente"}
            </h2>
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

          <DataTable
            columns={nutrientColumns}
            rows={nutrients}
            getRowKey={(n) => n.id}
            emptyMessage="No hay nutrientes cargados."
            searchable
            searchText={(n) => `${n.name} ${n.id}`}
            initialSort={{ key: "id", dir: "asc" }}
            containerClassName="bg-white rounded-xl border border-stone-200"
            footer={
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {nutrients.length} nutrientes
              </div>
            }
          />
        </div>
      )}

      {/* ─── Mappings Tab ─────────────────────────────────────────── */}
      {tab === "mappings" && (
        <div className="space-y-4">
          <form onSubmit={handleMapSubmit} className="bg-white rounded-xl border border-stone-200 p-4 space-y-3">
            <h2 className="text-sm font-medium text-stone-700">Nuevo mapeo</h2>
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

          <DataTable
            columns={mappingColumns}
            rows={mappings}
            getRowKey={(m) => `${m.symptomId}-${m.nutrientId}`}
            emptyMessage="No hay mapeos cargados."
            // The rows used to open sorted by symptomId (no header marked);
            // the shared DataTable reproduces exactly that initial order.
            initialSort={{ key: "symptomId", dir: "asc" }}
            containerClassName="bg-white rounded-xl border border-stone-200"
            footer={
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {mappings.length} mapeos
              </div>
            }
          />
        </div>
      )}

      {/* ─── Results Tab (read-only) ──────────────────────────────── */}
      {tab === "results" && (
        <div>
          <DataTable
            columns={resultColumns}
            rows={results}
            getRowKey={(r) => r.id}
            emptyMessage="No hay evaluaciones completadas todavía."
            initialSort={{ key: "createdAt", dir: "desc" }}
            containerClassName="bg-white rounded-xl border border-stone-200"
            footer={
              <div className="px-4 py-2 text-xs text-stone-400 border-t border-stone-100">
                {results.length} evaluaciones completadas
              </div>
            }
          />
        </div>
      )}
      <ConfirmActionDialog
        open={confirmSymId !== null}
        title="¿Eliminar este síntoma? Se verificará que no esté en uso."
        confirmLabel="Eliminar"
        onConfirm={() => {
          const id = confirmSymId;
          setConfirmSymId(null);
          if (id !== null) void handleDeleteSym(id);
        }}
        onCancel={() => setConfirmSymId(null)}
      />
      <ConfirmActionDialog
        open={confirmNutId !== null}
        title="¿Eliminar este nutriente? Se verificará que no esté en uso."
        confirmLabel="Eliminar"
        onConfirm={() => {
          const id = confirmNutId;
          setConfirmNutId(null);
          if (id !== null) void handleDeleteNut(id);
        }}
        onCancel={() => setConfirmNutId(null)}
      />
      <ConfirmActionDialog
        open={confirmMap !== null}
        title="¿Eliminar este mapeo?"
        confirmLabel="Eliminar"
        onConfirm={() => {
          const map = confirmMap;
          setConfirmMap(null);
          if (map) void handleDeleteMap(map.symptomId, map.nutrientId);
        }}
        onCancel={() => setConfirmMap(null)}
      />
    </div>
  );
}
