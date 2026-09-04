import { useCallback, useEffect, useState } from "react";
import { api, Guidance, Product } from "./api";

interface GuidanceFormState {
  title: string;
  content: string;
  productReferences: string[];
}

const EMPTY: GuidanceFormState = { title: "", content: "", productReferences: [] };

function parseRefs(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/**
 * "Guías de salud": expert-authored knowledge injected into the agent
 * context. CRUD + enable/disable toggle, with catalog products selectable by
 * reference/name. Editable knowledge — deletion is allowed (unlike the
 * append-only recommendations log).
 */
export function GuidancePage() {
  const [guidance, setGuidance] = useState<Guidance[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<GuidanceFormState | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [g, p] = await Promise.all([api.listGuidance(), api.listProducts()]);
      setGuidance(g.guidance);
      setProducts(p.products);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error de red");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function startEdit(row: Guidance) {
    setEditingId(row.id);
    setEditing({
      title: row.title,
      content: row.content,
      productReferences: parseRefs(row.productReferences),
    });
    setError(null);
  }

  function startCreate() {
    setEditingId(null);
    setEditing(EMPTY);
    setError(null);
  }

  const setField = (field: keyof GuidanceFormState, value: string) =>
    setEditing((prev) => (prev ? { ...prev, [field]: value } : prev));

  function toggleRef(ref: string) {
    setEditing((prev) => {
      if (!prev) return prev;
      const has = prev.productReferences.includes(ref);
      return {
        ...prev,
        productReferences: has
          ? prev.productReferences.filter((r) => r !== ref)
          : [...prev.productReferences, ref],
      };
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setSaving(true);
    try {
      if (editingId == null) {
        await api.createGuidance({
          title: editing.title,
          content: editing.content,
          product_references: editing.productReferences,
        });
      } else {
        await api.updateGuidance(editingId, {
          title: editing.title,
          content: editing.content,
          product_references: editing.productReferences,
        });
      }
      setEditing(null);
      setEditingId(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggle(row: Guidance) {
    try {
      await api.toggleGuidance(row.id, row.enabled === 1 ? 0 : 1);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar estado");
    }
  }

  async function handleDelete(row: Guidance) {
    if (!window.confirm(`¿Eliminar la guía "${row.title}"? Esta acción no se puede deshacer.`)) {
      return;
    }
    try {
      await api.deleteGuidance(row.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al eliminar");
    }
  }

  const productLabel = (ref: string) => {
    const p = products.find((pr) => pr.reference === ref);
    return p ? `${p.reference} — ${p.name}` : `${ref} (no en catálogo)`;
  };

  if (loading) return <p className="text-stone-500">Cargando…</p>;
  if (error && guidance.length === 0) {
    return (
      <div className="max-w-2xl p-6 bg-amber-50 border border-amber-300 text-amber-900">
        <h2 className="font-serif text-xl">Acceso restringido</h2>
        <p className="mt-2 text-sm">Respuesta del backend: {error}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-2xl">Guías de Salud</h1>
          <p className="mt-1 text-sm text-stone-500">
            Conocimiento clínico experto, inyectado en el contexto del
            agente para enriquecer las recomendaciones preventivas.
          </p>
        </div>
        <button
          onClick={startCreate}
          className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800"
        >
          Nueva guía
        </button>
      </div>

      {editing && (
        <form onSubmit={handleSubmit} className="mt-6 p-6 bg-white border border-stone-200 space-y-4">
          <h2 className="font-serif text-lg">
            {editingId == null ? "Nueva guía" : `Editar guía #${editingId}`}
          </h2>
          <label className="block text-sm">
            Título
            <input
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              value={editing.title}
              onChange={(e) => setField("title", e.target.value)}
              placeholder="Ej. Paquete Vitalidad"
              required
            />
          </label>
          <label className="block text-sm">
            Contenido
            <textarea
              className="mt-1 w-full border border-stone-300 px-3 py-2"
              rows={4}
              value={editing.content}
              onChange={(e) => setField("content", e.target.value)}
              placeholder="El conocimiento de la médico sobre esta combinación…"
              required
            />
          </label>
          <fieldset className="block text-sm">
            <legend className="mb-2">Productos relacionados (catálogo)</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto border border-stone-300 p-3">
              {products.map((p) => {
                const checked = editing.productReferences.includes(p.reference);
                return (
                  <label key={p.reference} className="flex items-center gap-2 text-stone-700">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleRef(p.reference)}
                      className="accent-emerald-900"
                    />
                    <span className="font-mono text-xs">{p.reference}</span> {p.name}
                  </label>
                );
              })}
              {products.length === 0 && (
                <p className="col-span-2 text-stone-400 italic">
                  Catálogo vacío — ejecuta el seed de productos para poder referenciarlos.
                </p>
              )}
            </div>
          </fieldset>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 bg-emerald-900 text-stone-50 text-sm hover:bg-emerald-800 disabled:opacity-50"
            >
              {saving ? "Guardando…" : editingId == null ? "Crear" : "Guardar cambios"}
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(null);
                setEditingId(null);
                setError(null);
              }}
              className="px-4 py-2 border border-stone-300 text-stone-600 text-sm"
            >
              Cancelar
            </button>
          </div>
        </form>
      )}

      <div className="mt-6 overflow-x-auto bg-white border border-stone-200">
        <table className="w-full text-sm">
          <thead className="bg-stone-100 text-stone-600 uppercase tracking-wider">
            <tr>
              <th className="px-4 py-3 text-left">Título</th>
              <th className="px-4 py-3 text-left">Contenido</th>
              <th className="px-4 py-3 text-left">Productos</th>
              <th className="px-4 py-3 text-left">Estado</th>
              <th className="px-4 py-3 text-right">Acción</th>
            </tr>
          </thead>
          <tbody>
            {guidance.map((g) => {
              const refs = parseRefs(g.productReferences);
              return (
                <tr key={g.id} className="border-t border-stone-200 align-top">
                  <td className="px-4 py-3 font-medium">{g.title}</td>
                  <td className="px-4 py-3 max-w-md">
                    <p className="line-clamp-3 text-stone-600">{g.content}</p>
                  </td>
                  <td className="px-4 py-3">
                    <ul className="space-y-1">
                      {refs.map((ref) => (
                        <li key={ref} className="font-mono text-xs">
                          {productLabel(ref)}
                        </li>
                      ))}
                      {refs.length === 0 && (
                        <li className="text-stone-400 italic">Sin productos</li>
                      )}
                    </ul>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggle(g)}
                      title={g.enabled === 1 ? "Desactivar guía" : "Activar guía"}
                      className={`px-2 py-1 text-xs ${
                        g.enabled === 1
                          ? "bg-emerald-100 text-emerald-900 hover:bg-emerald-200"
                          : "bg-stone-200 text-stone-500 hover:bg-stone-300"
                      }`}
                    >
                      {g.enabled === 1 ? "Activa" : "Inactiva"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button
                      onClick={() => startEdit(g)}
                      className="text-emerald-800 hover:underline mr-3"
                    >
                      Editar
                    </button>
                    <button onClick={() => handleDelete(g)} className="text-red-700 hover:underline">
                      Eliminar
                    </button>
                  </td>
                </tr>
              );
            })}
            {guidance.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-stone-400">
                  No hay guías. Crea la primera para que el agente la use en sus recomendaciones.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}